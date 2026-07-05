// src/services/ia.service.js
// Recomendación de builds SIN APIs externas ni de pago.
// Lógica propia basada en palabras clave y reglas de distribución.

const db = require('../db/pool')

// ─────────────────────────────────────────────
// PALABRAS CLAVE para detectar el uso
// ─────────────────────────────────────────────
const PALABRAS_CLAVE = {
  gaming:       ['gaming','jugar','juegos','game','fps','minecraft','fortnite','cyberpunk','valorant','gta','warzone','steam','1080p','1440p','4k','frames','hz','rtx','rx'],
  diseño:       ['diseño','photoshop','illustrator','premiere','after effects','video','edición','render','3d','blender','maya','figma','animación'],
  ia:           ['ia','inteligencia artificial','machine learning','ml','pytorch','tensorflow','entrenar','modelo','cuda','vram','llm','stable diffusion'],
  programacion: ['programar','programación','código','desarrollo','developer','compilar','docker','virtual','backend','frontend','node','python','java','vs code'],
  trabajo:      ['trabajo','oficina','word','excel','powerpoint','zoom','teams','correo','navegador','reuniones','empresa','documentos','ofimática'],
  hogar:        ['hogar','casa','navegar','internet','youtube','netflix','streaming','básico','familia','películas','casual','barato'],
}

const DISTRIBUCION_PRESUPUESTO = {
  gaming:       { motherboard:.15, cpu:.20, ram:.10, gpu:.35, storage:.08, psu:.07, cooler:.02, case:.03 },
  diseño:       { motherboard:.12, cpu:.25, ram:.20, gpu:.25, storage:.10, psu:.05, cooler:.02, case:.01 },
  ia:           { motherboard:.12, cpu:.20, ram:.18, gpu:.32, storage:.08, psu:.07, cooler:.02, case:.01 },
  programacion: { motherboard:.18, cpu:.28, ram:.22, gpu:.06, storage:.15, psu:.06, cooler:.03, case:.02 },
  trabajo:      { motherboard:.20, cpu:.25, ram:.20, gpu:.05, storage:.15, psu:.07, cooler:.05, case:.03 },
  hogar:        { motherboard:.20, cpu:.22, ram:.18, gpu:.05, storage:.18, psu:.08, cooler:.05, case:.04 },
}

const ORDEN_SELECCION = {
  gaming:       ['motherboard','cpu','gpu','ram','storage','psu','cooler','case'],
  diseño:       ['motherboard','cpu','ram','gpu','storage','psu','cooler','case'],
  ia:           ['motherboard','cpu','ram','gpu','storage','psu','cooler','case'],
  programacion: ['motherboard','cpu','ram','storage','gpu','psu','cooler','case'],
  trabajo:      ['motherboard','cpu','ram','storage','psu','cooler','case'],
  hogar:        ['motherboard','cpu','ram','storage','psu','cooler','case'],
}

// ─────────────────────────────────────────────
// 1. INTERPRETAR QUÉ QUIERE EL USUARIO
// ─────────────────────────────────────────────
const interpretarRequerimientos = (descripcion, presupuesto) => {
  const texto = descripcion.toLowerCase()

  const puntajes = {}
  for (const [uso, palabras] of Object.entries(PALABRAS_CLAVE)) {
    puntajes[uso] = palabras.filter(p => texto.includes(p)).length
  }

  // El uso con más coincidencias gana; empate → trabajo
  const uso = Object.entries(puntajes)
    .sort((a, b) => b[1] - a[1])[0][0]

  let nivel
  if (presupuesto < 400)       nivel = 'basico'
  else if (presupuesto < 800)  nivel = 'medio'
  else if (presupuesto < 1500) nivel = 'alto'
  else                         nivel = 'extremo'

  let resolucion = '1080p'
  if (texto.includes('4k'))                           resolucion = '4k'
  else if (texto.includes('1440p') || texto.includes('2k')) resolucion = '1440p'

  return { uso, nivel, resolucion }
}

// ─────────────────────────────────────────────
// 2. GENERAR BUILD ÓPTIMA
// ─────────────────────────────────────────────
const generarBuildOptima = async (perfil, presupuesto) => {
  const dist  = DISTRIBUCION_PRESUPUESTO[perfil.uso] || DISTRIBUCION_PRESUPUESTO.trabajo
  const orden = ORDEN_SELECCION[perfil.uso] || ORDEN_SELECCION.trabajo

  const presupuestoPorCategoria = {}
  for (const [cat, pct] of Object.entries(dist)) {
    presupuestoPorCategoria[cat] = Math.round(presupuesto * pct)
  }

  const build = {}
  let totalReal = 0

  for (const categoria of orden) {
    const maxCategoria = presupuestoPorCategoria[categoria]
    if (!maxCategoria) continue

    const componente = await seleccionarMejorComponente(categoria, maxCategoria, build)
    if (componente) {
      build[categoria] = componente
      totalReal += parseFloat(componente.precio_usd) || 0
    }
  }

  return { build, totalReal, presupuestoPorCategoria }
}

// ─────────────────────────────────────────────
// 3. SELECCIONAR MEJOR COMPONENTE
// ─────────────────────────────────────────────
const seleccionarMejorComponente = async (categoria, presupuestoMax, elegidos) => {
  const { rows } = await db.query(
    `SELECT c.id, c.nombre, c.marca, c.modelo,
            c.socket, c.tipo_ram, c.form_factor,
            c.tdp_watts, c.wattaje, c.pcie_version, c.especificaciones,
            p.precio_usd, p.tienda, p.url_producto, p.en_oferta
     FROM components c
     JOIN categorias cat ON cat.id = c.categoria_id AND cat.slug = $1
     JOIN precios_actuales p ON p.componente_id = c.id
     WHERE c.activo = true
       AND p.precio_usd <= $2
       AND p.disponible = true
     ORDER BY p.precio_usd DESC
     LIMIT 30`,
    [categoria, presupuestoMax * 1.15]
  )

  if (!rows.length) return null

  const compatibles = rows.filter(c => esCompatibleConBuild(c, categoria, elegidos))

  if (!compatibles.length) {
    // Fallback: buscar el más barato disponible que sea compatible
    const { rows: fallback } = await db.query(
      `SELECT c.id, c.nombre, c.marca, c.modelo,
              c.socket, c.tipo_ram, c.form_factor,
              c.tdp_watts, c.wattaje, c.pcie_version, c.especificaciones,
              p.precio_usd, p.tienda, p.url_producto, p.en_oferta
       FROM components c
       JOIN categorias cat ON cat.id = c.categoria_id AND cat.slug = $1
       JOIN precios_actuales p ON p.componente_id = c.id
       WHERE c.activo = true AND p.disponible = true
       ORDER BY p.precio_usd ASC LIMIT 10`,
      [categoria]
    )
    return fallback.find(c => esCompatibleConBuild(c, categoria, elegidos)) || null
  }

  return compatibles[0]
}

// ─────────────────────────────────────────────
// 4. COMPATIBILIDAD
// ─────────────────────────────────────────────
const esCompatibleConBuild = (candidato, categoria, elegidos) => {
  const mb  = elegidos.motherboard
  const cpu = elegidos.cpu
  const gpu = elegidos.gpu

  if (categoria === 'cpu' && mb && candidato.socket !== mb.socket) return false
  if (categoria === 'ram' && mb && candidato.tipo_ram !== mb.tipo_ram) return false
  if (categoria === 'motherboard' && cpu && candidato.socket !== cpu.socket) return false

  if (categoria === 'psu') {
    const minWatts = (cpu?.tdp_watts || 65) + (gpu?.tdp_watts || 150) + 100
    if ((candidato.wattaje || 0) < minWatts) return false
  }

  if (categoria === 'case' && mb) {
    const soporta = { ATX:['ATX','mATX','ITX'], mATX:['mATX','ITX'], ITX:['ITX'] }
    if (!(soporta[candidato.form_factor] || []).includes(mb.form_factor)) return false
  }

  return true
}

// ─────────────────────────────────────────────
// 5. EXPLICACIÓN (sin IA externa, plantillas propias)
// ─────────────────────────────────────────────
const generarExplicacion = (build, perfil, totalReal) => {
  const cpu = build.cpu?.nombre || 'el procesador'
  const gpu = build.gpu?.nombre || 'la tarjeta gráfica'
  const ramGb = build.ram?.especificaciones?.capacidad_gb
  const ram = ramGb ? `${ramGb}GB de RAM` : 'la memoria RAM'

  const plantillas = {
    gaming:       `Build balanceada para gaming. ${cpu} + ${gpu} te dan fluidez en juegos actuales. Los ${ram} evitan cuellos de botella. Todo por $${totalReal} USD.`,
    diseño:       `Orientada a creatividad: ${cpu} acelera renders, los ${ram} permiten archivos pesados sin problemas. El ${gpu} suma para renders 3D y efectos.`,
    ia:           `Pensada para ML/IA: el ${gpu} es la pieza clave para entrenar modelos. ${cpu} y ${ram} manejan grandes datasets sin cuellos de botella.`,
    programacion: `Ideal para desarrollo: los ${ram} corren contenedores y VMs sin problemas, y el ${cpu} compila rápido. Rendimiento real a $${totalReal} USD.`,
    trabajo:      `Eficiente para productividad: ${cpu} y ${ram} manejan múltiples apps, videollamadas y documentos pesados sin esfuerzo.`,
    hogar:        `Perfecta para uso diario: navegar, streaming y videollamadas fluidos. El SSD hace que todo cargue rápido. Excelente relación precio/rendimiento.`,
  }

  return plantillas[perfil.uso] || plantillas.trabajo
}

module.exports = {
  interpretarRequerimientos,
  generarBuildOptima,
  generarExplicacion,
  esCompatibleConBuild,
}
