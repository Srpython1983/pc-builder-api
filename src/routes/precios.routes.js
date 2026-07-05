// src/routes/precios.routes.js
// Registro de precios y consulta de historial
// El scraper usa estas rutas para guardar precios actualizados

const express = require('express')
const db      = require('../db/pool')
const { autenticar, soloAdmin } = require('../middleware/auth')

const router = express.Router()

// GET /api/precios/:componenteId
// Todos los precios actuales de un componente en distintas tiendas
router.get('/:componenteId', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT tienda, precio_usd, precio_local, moneda_local,
              url_producto, en_oferta, precio_original, disponible, actualizado_en
       FROM precios
       WHERE componente_id = $1
       ORDER BY precio_usd ASC`,
      [req.params.componenteId]
    )
    res.json({ precios: rows })
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /api/precios/:componenteId/historial
// Historial de precios para graficar tendencias (últimos 90 días)
router.get('/:componenteId/historial', async (req, res) => {
  try {
    const dias = parseInt(req.query.dias || '90')
    const { rows } = await db.query(
      `SELECT fecha, MIN(precio_usd) AS precio_min, MAX(precio_usd) AS precio_max,
              AVG(precio_usd)::DECIMAL(10,2) AS precio_promedio
       FROM precio_historial
       WHERE componente_id = $1
         AND fecha >= CURRENT_DATE - ($2 || ' days')::INTERVAL
       GROUP BY fecha
       ORDER BY fecha ASC`,
      [req.params.componenteId, dias]
    )
    res.json({ historial: rows })
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /api/precios  — el scraper registra precios nuevos (requiere admin)
router.post('/', autenticar, soloAdmin, async (req, res) => {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const {
      componente_id, tienda, precio_usd,
      precio_local, moneda_local,
      url_producto, disponible = true,
      en_oferta = false, precio_original, pais = 'US'
    } = req.body

    if (!componente_id || !tienda || !precio_usd)
      return res.status(400).json({ error: 'componente_id, tienda y precio_usd son requeridos' })

    // Verificar que el componente existe
    const { rows: comp } = await client.query(
      'SELECT id FROM components WHERE id = $1', [componente_id]
    )
    if (!comp.length)
      return res.status(404).json({ error: 'Componente no encontrado' })

    // Upsert: si ya existe un precio para este componente+tienda, actualizar
    const { rows } = await client.query(
      `INSERT INTO precios
        (componente_id, tienda, pais, precio_usd, precio_local, moneda_local,
         url_producto, disponible, en_oferta, precio_original, actualizado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
       ON CONFLICT (componente_id, tienda)
       DO UPDATE SET
         precio_usd     = EXCLUDED.precio_usd,
         precio_local   = EXCLUDED.precio_local,
         moneda_local   = EXCLUDED.moneda_local,
         url_producto   = EXCLUDED.url_producto,
         disponible     = EXCLUDED.disponible,
         en_oferta      = EXCLUDED.en_oferta,
         precio_original= EXCLUDED.precio_original,
         actualizado_en = now()
       RETURNING *`,
      [
        componente_id, tienda, pais, precio_usd,
        precio_local || null, moneda_local || null,
        url_producto || null, disponible, en_oferta,
        precio_original || null
      ]
    )

    // Guardar en historial (una entrada por día por componente+tienda)
    await client.query(
      `INSERT INTO precio_historial (componente_id, tienda, precio_usd, fecha)
       VALUES ($1, $2, $3, CURRENT_DATE)
       ON CONFLICT DO NOTHING`,
      [componente_id, tienda, precio_usd]
    )

    await client.query('COMMIT')
    res.status(201).json(rows[0])

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Error registrando precio:', err)
    res.status(500).json({ error: 'Error registrando precio' })
  } finally {
    client.release()
  }
})

// POST /api/precios/batch  — el scraper manda múltiples precios de una vez
router.post('/batch', autenticar, soloAdmin, async (req, res) => {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const { precios } = req.body
    if (!Array.isArray(precios) || !precios.length)
      return res.status(400).json({ error: 'precios debe ser un array no vacío' })

    let insertados = 0
    let errores = []

    for (const p of precios) {
      try {
        await client.query(
          `INSERT INTO precios
            (componente_id, tienda, pais, precio_usd, precio_local, moneda_local,
             url_producto, disponible, en_oferta, precio_original, actualizado_en)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
           ON CONFLICT (componente_id, tienda)
           DO UPDATE SET
             precio_usd = EXCLUDED.precio_usd,
             disponible = EXCLUDED.disponible,
             en_oferta  = EXCLUDED.en_oferta,
             actualizado_en = now()`,
          [
            p.componente_id, p.tienda, p.pais || 'US',
            p.precio_usd, p.precio_local || null, p.moneda_local || null,
            p.url_producto || null, p.disponible !== false,
            p.en_oferta || false, p.precio_original || null
          ]
        )

        await client.query(
          `INSERT INTO precio_historial (componente_id, tienda, precio_usd, fecha)
           VALUES ($1, $2, $3, CURRENT_DATE)
           ON CONFLICT DO NOTHING`,
          [p.componente_id, p.tienda, p.precio_usd]
        )

        insertados++
      } catch (e) {
        errores.push({ componente_id: p.componente_id, tienda: p.tienda, error: e.message })
      }
    }

    await client.query('COMMIT')
    res.json({ insertados, errores, total: precios.length })

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Error en batch de precios:', err)
    res.status(500).json({ error: 'Error procesando batch de precios' })
  } finally {
    client.release()
  }
})

module.exports = router
