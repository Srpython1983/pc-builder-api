// src/services/compatibilidad.service.js
// Lógica central: verifica si un conjunto de componentes son compatibles entre sí

const db = require('../db/pool')

/**
 * Verifica la compatibilidad de una build completa.
 * Llama a la función SQL verificar_compatibilidad() que ya tiene toda la lógica.
 *
 * @param {string} buildId - UUID de la build
 * @returns {Array} - lista de { tipo_regla, descripcion, es_error }
 */
const verificarBuild = async (buildId) => {
  const { rows } = await db.query(
    'SELECT * FROM verificar_compatibilidad($1)',
    [buildId]
  )
  return rows
}

/**
 * Filtra componentes compatibles con los ya elegidos.
 * Usado en el builder manual: cuando el usuario elige una placa madre,
 * este servicio devuelve solo los CPUs que funcionan con esa placa.
 *
 * @param {string} categoriaObjetivo - 'cpu', 'ram', 'gpu', etc.
 * @param {Object} componentesElegidos - { motherboard: id, cpu: id, ... }
 * @returns {Array} - componentes compatibles con precios
 */
const filtrarCompatibles = async (categoriaObjetivo, componentesElegidos) => {
  // Obtener specs de todos los componentes ya elegidos
  const idsElegidos = Object.values(componentesElegidos).filter(Boolean)
  let elegidos = []

  if (idsElegidos.length > 0) {
    const { rows } = await db.query(
      `SELECT id, categoria_id, cat.slug as categoria, socket, tipo_ram, form_factor,
              tdp_watts, wattaje, pcie_version, especificaciones
       FROM components c
       JOIN categorias cat ON cat.id = c.categoria_id
       WHERE c.id = ANY($1::uuid[])`,
      [idsElegidos]
    )
    elegidos = rows
  }

  // Obtener TODOS los componentes de la categoría objetivo con su precio actual
  const { rows: candidatos } = await db.query(
    `SELECT c.id, c.nombre, c.marca, c.modelo, c.socket, c.tipo_ram,
            c.form_factor, c.tdp_watts, c.wattaje, c.pcie_version,
            c.especificaciones, c.imagen_url,
            p.precio_usd, p.tienda, p.url_producto, p.en_oferta
     FROM components c
     JOIN categorias cat ON cat.id = c.categoria_id AND cat.slug = $1
     LEFT JOIN precios_actuales p ON p.componente_id = c.id
     WHERE c.activo = true
     ORDER BY p.precio_usd ASC NULLS LAST`,
    [categoriaObjetivo]
  )

  // Aplicar reglas de compatibilidad en JavaScript
  const compatibles = candidatos.filter(candidato =>
    esCompatible(candidato, categoriaObjetivo, elegidos)
  )

  return compatibles.map(c => ({
    ...c,
    compatible: true,
    razon_compatibilidad: generarEtiquetaCompatibilidad(c, categoriaObjetivo, elegidos)
  }))
}

/**
 * Verifica si UN candidato es compatible con los componentes ya elegidos.
 */
const esCompatible = (candidato, categoria, elegidos) => {
  const mb  = elegidos.find(e => e.categoria === 'motherboard')
  const cpu = elegidos.find(e => e.categoria === 'cpu')
  const gpu = elegidos.find(e => e.categoria === 'gpu')
  const psu = elegidos.find(e => e.categoria === 'psu')

  switch (categoria) {
    case 'cpu':
      // CPU debe tener el mismo socket que la placa madre
      if (mb && candidato.socket !== mb.socket) return false
      break

    case 'ram':
      // RAM debe tener el mismo tipo DDR que la placa madre
      if (mb && candidato.tipo_ram !== mb.tipo_ram) return false
      break

    case 'motherboard':
      // Placa madre debe coincidir en socket con CPU elegido
      if (cpu && candidato.socket !== cpu.socket) return false
      // Y en tipo RAM con la RAM elegida
      if (elegidos.find(e => e.categoria === 'ram') &&
          candidato.tipo_ram !== elegidos.find(e => e.categoria === 'ram').tipo_ram) return false
      break

    case 'psu':
      // PSU debe tener suficiente wattaje
      const tdpCpu = cpu?.tdp_watts || 0
      const tdpGpu = gpu?.tdp_watts || 0
      const necesario = tdpCpu + tdpGpu + 100
      if (candidato.wattaje < necesario) return false
      break

    case 'case':
      // Gabinete debe soportar el form factor de la placa madre
      if (mb) {
        const soportados = formFactorsSoportados(candidato.form_factor)
        if (!soportados.includes(mb.form_factor)) return false
      }
      break
  }

  return true
}

/**
 * Un gabinete ATX soporta ATX, mATX e ITX.
 * Un gabinete mATX solo soporta mATX e ITX.
 * Un gabinete ITX solo soporta ITX.
 */
const formFactorsSoportados = (formFactorGabinete) => {
  const jerarquia = {
    'ATX':  ['ATX', 'mATX', 'ITX'],
    'mATX': ['mATX', 'ITX'],
    'ITX':  ['ITX'],
  }
  return jerarquia[formFactorGabinete] || []
}

const generarEtiquetaCompatibilidad = (comp, categoria, elegidos) => {
  const mb = elegidos.find(e => e.categoria === 'motherboard')
  if (categoria === 'cpu' && mb) return `Compatible con socket ${mb.socket}`
  if (categoria === 'ram' && mb) return `Compatible con ${mb.tipo_ram}`
  return 'Compatible'
}

/**
 * Calcula el wattaje mínimo recomendado para una build.
 */
const calcularWattajeRecomendado = async (componentesIds) => {
  if (!componentesIds.length) return 0

  const { rows } = await db.query(
    `SELECT categoria_slug, SUM(c.tdp_watts) as tdp_total
     FROM build_componentes bc
     JOIN components c ON c.id = bc.componente_id
     WHERE bc.build_id = ANY($1::uuid[])
       AND c.tdp_watts IS NOT NULL
     GROUP BY categoria_slug`,
    [componentesIds]
  )

  const totalTdp = rows.reduce((sum, r) => sum + (parseInt(r.tdp_total) || 0), 0)
  return totalTdp + 100  // +100W de buffer
}

module.exports = {
  verificarBuild,
  filtrarCompatibles,
  calcularWattajeRecomendado,
}
