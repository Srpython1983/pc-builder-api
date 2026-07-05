// src/routes/recomendador.routes.js
// Modo automático: el usuario describe qué quiere y la API devuelve la build completa
// Modo manual:     filtra componentes compatibles con los ya elegidos

const express = require('express')
const db      = require('../db/pool')
const { autenticarOpcional } = require('../middleware/auth')
const iaService  = require('../services/ia.service')
const compatService = require('../services/compatibilidad.service')

const router = express.Router()

// ─────────────────────────────────────────────────────────
// POST /api/recomendador/auto
// Recibe descripción + presupuesto → devuelve build completa
// ─────────────────────────────────────────────────────────
router.post('/auto', autenticarOpcional, async (req, res) => {
  try {
    const { descripcion, presupuesto } = req.body

    if (!descripcion || !presupuesto)
      return res.status(400).json({ error: 'descripcion y presupuesto son requeridos' })

    if (presupuesto < 100 || presupuesto > 50000)
      return res.status(400).json({ error: 'Presupuesto debe estar entre $100 y $50,000 USD' })

    // Paso 1: Interpretar qué tipo de PC quiere el usuario
    const perfil = iaService.interpretarRequerimientos(descripcion, presupuesto)

    // Paso 2: Buscar los mejores componentes compatibles en la BD
    const { build, totalReal, presupuestoPorCategoria } = await iaService.generarBuildOptima(
      perfil,
      presupuesto
    )

    // Paso 3: Generar explicación en texto
    const explicacion = iaService.generarExplicacion(build, perfil, totalReal)

    // Paso 4: Verificar compatibilidad final de toda la build
    const advertencias = verificarCompatibilidadBuild(build)

    // Formatear respuesta
    const componentesArray = Object.entries(build)
      .filter(([, v]) => v)
      .map(([categoria, comp]) => ({
        categoria,
        ...comp,
        presupuesto_asignado: presupuestoPorCategoria[categoria]
      }))

    res.json({
      perfil_detectado: perfil,
      explicacion,
      total_real: totalReal,
      presupuesto_ingresado: presupuesto,
      ahorro: presupuesto - totalReal,
      componentes: componentesArray,
      advertencias,
      compatible: advertencias.filter(a => a.es_error).length === 0
    })

  } catch (err) {
    console.error('Error en recomendador auto:', err)
    res.status(500).json({ error: 'Error generando recomendación' })
  }
})

// ─────────────────────────────────────────────────────────
// POST /api/recomendador/filtrar-compatibles
// Modo manual: dado lo que ya eligió el usuario,
// devuelve qué componentes son compatibles para la siguiente categoría
//
// Body: {
//   categoria_objetivo: 'cpu',
//   elegidos: { motherboard: 'uuid', cpu: 'uuid', ... }
// }
// ─────────────────────────────────────────────────────────
router.post('/filtrar-compatibles', async (req, res) => {
  try {
    const { categoria_objetivo, elegidos = {} } = req.body

    if (!categoria_objetivo)
      return res.status(400).json({ error: 'categoria_objetivo es requerido' })

    const categoriaValidas = ['cpu','motherboard','ram','gpu','storage','psu','cooler','case']
    if (!categoriaValidas.includes(categoria_objetivo))
      return res.status(400).json({ error: `categoria_objetivo debe ser uno de: ${categoriaValidas.join(', ')}` })

    // Obtener specs de los componentes ya elegidos
    const idsElegidos = Object.values(elegidos).filter(Boolean)
    let componentesElegidos = {}

    if (idsElegidos.length > 0) {
      const { rows } = await db.query(
        `SELECT c.id, cat.slug as categoria, c.socket, c.tipo_ram,
                c.form_factor, c.tdp_watts, c.wattaje, c.pcie_version
         FROM components c
         JOIN categorias cat ON cat.id = c.categoria_id
         WHERE c.id = ANY($1::uuid[])`,
        [idsElegidos]
      )
      for (const comp of rows) {
        componentesElegidos[comp.categoria] = comp
      }
    }

    // Obtener todos los candidatos de la categoría objetivo
    const { rows: candidatos } = await db.query(
      `SELECT c.id, c.nombre, c.marca, c.modelo,
              c.socket, c.tipo_ram, c.form_factor,
              c.tdp_watts, c.wattaje, c.pcie_version, c.especificaciones, c.imagen_url,
              p.precio_usd, p.tienda, p.url_producto, p.en_oferta, p.disponible
       FROM components c
       JOIN categorias cat ON cat.id = c.categoria_id AND cat.slug = $1
       LEFT JOIN precios_actuales p ON p.componente_id = c.id
       WHERE c.activo = true
       ORDER BY p.precio_usd ASC NULLS LAST`,
      [categoria_objetivo]
    )

    // Filtrar por compatibilidad
    const compatibles = []
    const incompatibles = []

    for (const candidato of candidatos) {
      const ok = iaService.esCompatibleConBuild(
        candidato,
        categoria_objetivo,
        componentesElegidos
      )

      const razon = generarRazonCompatibilidad(candidato, categoria_objetivo, componentesElegidos)

      if (ok) {
        compatibles.push({ ...candidato, compatible: true, razon })
      } else {
        incompatibles.push({ ...candidato, compatible: false, razon })
      }
    }

    res.json({
      categoria: categoria_objetivo,
      total_compatibles: compatibles.length,
      total_incompatibles: incompatibles.length,
      compatibles,
      incompatibles  // útil para mostrar por qué no son compatibles
    })

  } catch (err) {
    console.error('Error filtrando compatibles:', err)
    res.status(500).json({ error: 'Error filtrando componentes compatibles' })
  }
})

// ─────────────────────────────────────────────────────────
// POST /api/recomendador/verificar
// Verifica la compatibilidad de una lista de componentes
// antes de guardar la build
//
// Body: { componentes: { motherboard: 'uuid', cpu: 'uuid', ... } }
// ─────────────────────────────────────────────────────────
router.post('/verificar', async (req, res) => {
  try {
    const { componentes } = req.body
    if (!componentes || typeof componentes !== 'object')
      return res.status(400).json({ error: 'componentes es requerido' })

    const ids = Object.values(componentes).filter(Boolean)
    if (!ids.length)
      return res.status(400).json({ error: 'No hay componentes para verificar' })

    // Obtener specs completas
    const { rows } = await db.query(
      `SELECT c.id, cat.slug as categoria, c.nombre, c.socket, c.tipo_ram,
              c.form_factor, c.tdp_watts, c.wattaje, c.pcie_version
       FROM components c
       JOIN categorias cat ON cat.id = c.categoria_id
       WHERE c.id = ANY($1::uuid[])`,
      [ids]
    )

    const byCategoria = {}
    for (const r of rows) byCategoria[r.categoria] = r

    const problemas = verificarCompatibilidadBuild(byCategoria)
    const wattajeRecomendado = calcularWattajeRecomendado(byCategoria)

    res.json({
      compatible: problemas.filter(p => p.es_error).length === 0,
      problemas,
      advertencias: problemas.filter(p => !p.es_error),
      errores: problemas.filter(p => p.es_error),
      wattaje_recomendado: wattajeRecomendado
    })

  } catch (err) {
    console.error('Error verificando compatibilidad:', err)
    res.status(500).json({ error: 'Error verificando compatibilidad' })
  }
})

// ─────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────
const verificarCompatibilidadBuild = (build) => {
  const problemas = []
  const mb  = build.motherboard
  const cpu = build.cpu
  const ram = build.ram
  const gpu = build.gpu
  const psu = build.psu
  const gabinete = build.case

  if (cpu && mb && cpu.socket !== mb.socket) {
    problemas.push({
      es_error: true,
      tipo: 'socket_mismatch',
      mensaje: `CPU socket ${cpu.socket} no es compatible con placa madre socket ${mb.socket}`
    })
  }

  if (ram && mb && ram.tipo_ram !== mb.tipo_ram) {
    problemas.push({
      es_error: true,
      tipo: 'ram_type_mismatch',
      mensaje: `RAM ${ram.tipo_ram} no es compatible con la placa madre que usa ${mb.tipo_ram}`
    })
  }

  if (psu && cpu && gpu) {
    const minWatts = (cpu.tdp_watts || 65) + (gpu.tdp_watts || 150) + 100
    if ((psu.wattaje || 0) < minWatts) {
      problemas.push({
        es_error: false,  // advertencia, no bloquea
        tipo: 'psu_wattage_low',
        mensaje: `PSU de ${psu.wattaje}W puede ser insuficiente. Se recomiendan al menos ${minWatts}W`
      })
    }
  }

  if (gabinete && mb) {
    const soporta = { ATX:['ATX','mATX','ITX'], mATX:['mATX','ITX'], ITX:['ITX'] }
    const lista = soporta[gabinete.form_factor] || []
    if (!lista.includes(mb.form_factor)) {
      problemas.push({
        es_error: true,
        tipo: 'form_factor_mismatch',
        mensaje: `El gabinete ${gabinete.form_factor} no soporta la placa madre ${mb.form_factor}`
      })
    }
  }

  return problemas
}

const calcularWattajeRecomendado = (build) => {
  const tdpCpu = build.cpu?.tdp_watts || 0
  const tdpGpu = build.gpu?.tdp_watts || 0
  return tdpCpu + tdpGpu + 100
}

const generarRazonCompatibilidad = (candidato, categoria, elegidos) => {
  const mb  = elegidos.motherboard
  const cpu = elegidos.cpu
  const gpu = elegidos.gpu

  if (categoria === 'cpu' && mb)
    return candidato.socket === mb.socket
      ? `Socket ${candidato.socket} compatible con tu placa madre`
      : `Socket ${candidato.socket} incompatible — tu placa madre usa ${mb.socket}`

  if (categoria === 'ram' && mb)
    return candidato.tipo_ram === mb.tipo_ram
      ? `${candidato.tipo_ram} compatible con tu placa madre`
      : `${candidato.tipo_ram} incompatible — tu placa madre usa ${mb.tipo_ram}`

  if (categoria === 'psu' && cpu) {
    const min = (cpu.tdp_watts || 65) + (gpu?.tdp_watts || 150) + 100
    return (candidato.wattaje || 0) >= min
      ? `${candidato.wattaje}W suficiente para tu configuración`
      : `${candidato.wattaje}W insuficiente — necesitas al menos ${min}W`
  }

  return 'Compatible'
}

module.exports = router
