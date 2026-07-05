// src/routes/componentes.routes.js
const express = require('express')
const db      = require('../db/pool')
const { autenticar, soloAdmin } = require('../middleware/auth')

const router = express.Router()

// GET /api/componentes
// Lista componentes con filtros opcionales: categoria, marca, presupuesto_max
router.get('/', async (req, res) => {
  try {
    const { categoria, marca, precio_max, precio_min, socket, tipo_ram, q } = req.query

    let sql = `
      SELECT c.id, c.nombre, c.marca, c.modelo,
             c.socket, c.tipo_ram, c.form_factor,
             c.tdp_watts, c.wattaje, c.pcie_version,
             c.especificaciones, c.imagen_url,
             cat.nombre AS categoria_nombre, cat.slug AS categoria_slug,
             p.precio_usd, p.tienda, p.url_producto, p.en_oferta
      FROM components c
      JOIN categorias cat ON cat.id = c.categoria_id
      LEFT JOIN precios_actuales p ON p.componente_id = c.id
      WHERE c.activo = true
    `
    const params = []
    let i = 1

    if (categoria) {
      sql += ` AND cat.slug = $${i++}`
      params.push(categoria)
    }
    if (marca) {
      sql += ` AND LOWER(c.marca) = LOWER($${i++})`
      params.push(marca)
    }
    if (precio_max) {
      sql += ` AND p.precio_usd <= $${i++}`
      params.push(parseFloat(precio_max))
    }
    if (precio_min) {
      sql += ` AND p.precio_usd >= $${i++}`
      params.push(parseFloat(precio_min))
    }
    if (socket) {
      sql += ` AND c.socket = $${i++}`
      params.push(socket)
    }
    if (tipo_ram) {
      sql += ` AND c.tipo_ram = $${i++}`
      params.push(tipo_ram)
    }
    if (q) {
      sql += ` AND (LOWER(c.nombre) LIKE $${i} OR LOWER(c.marca) LIKE $${i} OR LOWER(c.modelo) LIKE $${i})`
      params.push(`%${q.toLowerCase()}%`)
      i++
    }

    sql += ' ORDER BY p.precio_usd ASC NULLS LAST'

    const { rows } = await db.query(sql, params)
    res.json({ total: rows.length, componentes: rows })

  } catch (err) {
    console.error('Error listando componentes:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /api/componentes/:id
// Detalle de un componente con historial de precios
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.*, cat.nombre AS categoria_nombre, cat.slug AS categoria_slug
       FROM components c
       JOIN categorias cat ON cat.id = c.categoria_id
       WHERE c.id = $1 AND c.activo = true`,
      [req.params.id]
    )

    if (!rows.length)
      return res.status(404).json({ error: 'Componente no encontrado' })

    // Precios en todas las tiendas disponibles
    const { rows: precios } = await db.query(
      `SELECT tienda, precio_usd, precio_local, moneda_local,
              url_producto, en_oferta, precio_original, actualizado_en
       FROM precios
       WHERE componente_id = $1 AND disponible = true
       ORDER BY precio_usd ASC`,
      [req.params.id]
    )

    // Historial de precios (últimos 30 días)
    const { rows: historial } = await db.query(
      `SELECT fecha, precio_usd, tienda
       FROM precio_historial
       WHERE componente_id = $1
         AND fecha >= CURRENT_DATE - INTERVAL '30 days'
       ORDER BY fecha ASC`,
      [req.params.id]
    )

    res.json({ ...rows[0], precios_tiendas: precios, historial_precios: historial })

  } catch (err) {
    console.error('Error obteniendo componente:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /api/componentes/:id/compatibles?categoria=cpu
// Dado un componente, devuelve qué otros componentes son compatibles con él
router.get('/:id/compatibles', async (req, res) => {
  try {
    const { categoria } = req.query
    if (!categoria)
      return res.status(400).json({ error: 'Parámetro categoria requerido' })

    // Obtener el componente base
    const { rows: base } = await db.query(
      'SELECT * FROM components WHERE id = $1', [req.params.id]
    )
    if (!base.length)
      return res.status(404).json({ error: 'Componente no encontrado' })

    const comp = base[0]

    // Buscar compatibles según la categoría pedida
    let condicion = ''
    const params = [categoria]
    let i = 2

    // Reglas de compatibilidad
    if (categoria === 'cpu' && comp.socket) {
      condicion = `AND c.socket = $${i++}`
      params.push(comp.socket)
    } else if (categoria === 'ram' && comp.tipo_ram) {
      condicion = `AND c.tipo_ram = $${i++}`
      params.push(comp.tipo_ram)
    } else if (categoria === 'motherboard') {
      if (comp.socket) {
        condicion = `AND c.socket = $${i++}`
        params.push(comp.socket)
      }
    } else if (categoria === 'psu') {
      // PSU debe tener wattaje suficiente para este componente
      const tdp = comp.tdp_watts || 0
      condicion = `AND c.wattaje >= $${i++}`
      params.push(tdp + 100)
    }

    const { rows } = await db.query(
      `SELECT c.id, c.nombre, c.marca, c.modelo,
              c.socket, c.tipo_ram, c.form_factor,
              c.tdp_watts, c.wattaje, c.especificaciones,
              p.precio_usd, p.tienda, p.url_producto
       FROM components c
       JOIN categorias cat ON cat.id = c.categoria_id AND cat.slug = $1
       LEFT JOIN precios_actuales p ON p.componente_id = c.id
       WHERE c.activo = true ${condicion}
       ORDER BY p.precio_usd ASC NULLS LAST`,
      params
    )

    res.json({ total: rows.length, compatibles: rows })

  } catch (err) {
    console.error('Error buscando compatibles:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /api/componentes  — solo admin
router.post('/', autenticar, soloAdmin, async (req, res) => {
  try {
    const {
      categoria_slug, nombre, marca, modelo,
      socket, tipo_ram, form_factor,
      tdp_watts, wattaje, pcie_version,
      especificaciones, imagen_url
    } = req.body

    if (!categoria_slug || !nombre || !marca || !modelo)
      return res.status(400).json({ error: 'categoria_slug, nombre, marca y modelo son requeridos' })

    const { rows: cat } = await db.query(
      'SELECT id FROM categorias WHERE slug = $1', [categoria_slug]
    )
    if (!cat.length)
      return res.status(400).json({ error: 'Categoría no encontrada' })

    const { rows } = await db.query(
      `INSERT INTO components
        (categoria_id, nombre, marca, modelo, socket, tipo_ram, form_factor,
         tdp_watts, wattaje, pcie_version, especificaciones, imagen_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        cat[0].id, nombre, marca, modelo,
        socket || null, tipo_ram || null, form_factor || null,
        tdp_watts || null, wattaje || null, pcie_version || null,
        especificaciones ? JSON.stringify(especificaciones) : '{}',
        imagen_url || null
      ]
    )

    res.status(201).json(rows[0])

  } catch (err) {
    console.error('Error creando componente:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PATCH /api/componentes/:id  — solo admin
router.patch('/:id', autenticar, soloAdmin, async (req, res) => {
  try {
    const campos = ['nombre','marca','modelo','socket','tipo_ram','form_factor',
                    'tdp_watts','wattaje','pcie_version','especificaciones','imagen_url','activo']

    const sets = []
    const params = []
    let i = 1

    for (const campo of campos) {
      if (req.body[campo] !== undefined) {
        sets.push(`${campo} = $${i++}`)
        params.push(campo === 'especificaciones'
          ? JSON.stringify(req.body[campo])
          : req.body[campo]
        )
      }
    }

    if (!sets.length)
      return res.status(400).json({ error: 'No hay campos para actualizar' })

    sets.push(`actualizado_en = now()`)
    params.push(req.params.id)

    const { rows } = await db.query(
      `UPDATE components SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    )

    if (!rows.length)
      return res.status(404).json({ error: 'Componente no encontrado' })

    res.json(rows[0])

  } catch (err) {
    console.error('Error actualizando componente:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

module.exports = router
