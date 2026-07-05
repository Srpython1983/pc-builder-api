// src/routes/builds.routes.js
const express = require('express')
const db      = require('../db/pool')
const { autenticar, autenticarOpcional } = require('../middleware/auth')

const router = express.Router()

// Genera un slug corto para compartir: ej. "abc12x"
const generarSlug = () => Math.random().toString(36).substring(2, 8)

// ─────────────────────────────────────────────────────────
// GET /api/builds  — builds del usuario logueado
// ─────────────────────────────────────────────────────────
router.get('/', autenticar, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT b.id, b.nombre, b.descripcion, b.uso_principal,
              b.presupuesto_meta, b.total_calculado, b.modo,
              b.es_publica, b.slug_compartir, b.vistas,
              b.creado_en, b.actualizado_en,
              COUNT(bc.id) AS total_componentes
       FROM builds b
       LEFT JOIN build_componentes bc ON bc.build_id = b.id
       WHERE b.usuario_id = $1
       GROUP BY b.id
       ORDER BY b.actualizado_en DESC`,
      [req.usuario.id]
    )
    res.json({ total: rows.length, builds: rows })
  } catch (err) {
    console.error('Error listando builds:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// ─────────────────────────────────────────────────────────
// GET /api/builds/publicas  — builds públicas de todos
// ─────────────────────────────────────────────────────────
router.get('/publicas', async (req, res) => {
  try {
    const { uso, limite = 20 } = req.query

    let sql = `
      SELECT b.id, b.nombre, b.descripcion, b.uso_principal,
             b.total_calculado, b.modo, b.slug_compartir, b.vistas,
             b.creado_en, u.nombre AS autor,
             COUNT(bc.id) AS total_componentes
      FROM builds b
      JOIN usuarios u ON u.id = b.usuario_id
      LEFT JOIN build_componentes bc ON bc.build_id = b.id
      WHERE b.es_publica = true
    `
    const params = []
    if (uso) {
      sql += ` AND b.uso_principal = $1`
      params.push(uso)
    }
    sql += ` GROUP BY b.id, u.nombre ORDER BY b.vistas DESC LIMIT $${params.length + 1}`
    params.push(parseInt(limite))

    const { rows } = await db.query(sql, params)
    res.json({ total: rows.length, builds: rows })
  } catch (err) {
    console.error('Error listando builds públicas:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// ─────────────────────────────────────────────────────────
// GET /api/builds/:id  — detalle de una build
// ─────────────────────────────────────────────────────────
router.get('/:id', autenticarOpcional, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT b.*, u.nombre AS autor
       FROM builds b
       LEFT JOIN usuarios u ON u.id = b.usuario_id
       WHERE b.id = $1`,
      [req.params.id]
    )

    if (!rows.length)
      return res.status(404).json({ error: 'Build no encontrada' })

    const build = rows[0]

    // Solo el dueño puede ver builds privadas
    if (!build.es_publica) {
      if (!req.usuario || req.usuario.id !== build.usuario_id)
        return res.status(403).json({ error: 'Build privada' })
    }

    // Obtener componentes de la build con precios actuales
    const { rows: componentes } = await db.query(
      `SELECT bc.categoria_slug, bc.precio_al_guardar, bc.tienda_al_guardar,
              c.id, c.nombre, c.marca, c.modelo,
              c.socket, c.tipo_ram, c.form_factor, c.especificaciones, c.imagen_url,
              p.precio_usd AS precio_actual, p.tienda AS tienda_actual, p.url_producto
       FROM build_componentes bc
       JOIN components c ON c.id = bc.componente_id
       LEFT JOIN precios_actuales p ON p.componente_id = c.id
       WHERE bc.build_id = $1
       ORDER BY bc.categoria_slug`,
      [req.params.id]
    )

    // Incrementar contador de vistas si es pública
    if (build.es_publica) {
      await db.query('UPDATE builds SET vistas = vistas + 1 WHERE id = $1', [req.params.id])
    }

    res.json({ ...build, componentes })
  } catch (err) {
    console.error('Error obteniendo build:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// ─────────────────────────────────────────────────────────
// GET /api/builds/compartida/:slug  — ver por slug público
// ─────────────────────────────────────────────────────────
router.get('/compartida/:slug', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id FROM builds WHERE slug_compartir = $1`,
      [req.params.slug]
    )
    if (!rows.length)
      return res.status(404).json({ error: 'Build no encontrada' })

    // Redirigir al endpoint de detalle
    req.params.id = rows[0].id
    return router.handle(req, res)
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// ─────────────────────────────────────────────────────────
// POST /api/builds  — crear nueva build
// ─────────────────────────────────────────────────────────
router.post('/', autenticar, async (req, res) => {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const {
      nombre, descripcion, uso_principal,
      presupuesto_meta, modo = 'manual',
      es_publica = false, componentes = {}
    } = req.body

    // Calcular total
    const ids = Object.values(componentes).filter(Boolean)
    let total_calculado = 0
    let preciosPorId = {}

    if (ids.length > 0) {
      const { rows: precios } = await client.query(
        `SELECT componente_id, precio_usd, tienda
         FROM precios_actuales
         WHERE componente_id = ANY($1::uuid[])`,
        [ids]
      )
      for (const p of precios) {
        preciosPorId[p.componente_id] = p
        total_calculado += parseFloat(p.precio_usd) || 0
      }
    }

    // Generar slug único para compartir
    let slug = generarSlug()
    const { rows: slugExiste } = await client.query(
      'SELECT id FROM builds WHERE slug_compartir = $1', [slug]
    )
    if (slugExiste.length) slug = generarSlug() + generarSlug()

    // Insertar build
    const { rows: buildRows } = await client.query(
      `INSERT INTO builds
        (usuario_id, nombre, descripcion, uso_principal,
         presupuesto_meta, total_calculado, modo, es_publica, slug_compartir)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        req.usuario.id, nombre || 'Mi PC',
        descripcion || null, uso_principal || null,
        presupuesto_meta || null, total_calculado,
        modo, es_publica, slug
      ]
    )

    const build = buildRows[0]

    // Insertar componentes
    for (const [categoria_slug, componente_id] of Object.entries(componentes)) {
      if (!componente_id) continue
      const precio = preciosPorId[componente_id]
      await client.query(
        `INSERT INTO build_componentes
          (build_id, componente_id, categoria_slug, precio_al_guardar, tienda_al_guardar)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          build.id, componente_id, categoria_slug,
          precio?.precio_usd || null,
          precio?.tienda || null
        ]
      )
    }

    await client.query('COMMIT')
    res.status(201).json({ ...build, total_componentes: ids.length })

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Error creando build:', err)
    res.status(500).json({ error: 'Error creando la build' })
  } finally {
    client.release()
  }
})

// ─────────────────────────────────────────────────────────
// PATCH /api/builds/:id  — actualizar build
// ─────────────────────────────────────────────────────────
router.patch('/:id', autenticar, async (req, res) => {
  try {
    // Verificar que la build pertenece al usuario
    const { rows: check } = await db.query(
      'SELECT id FROM builds WHERE id = $1 AND usuario_id = $2',
      [req.params.id, req.usuario.id]
    )
    if (!check.length)
      return res.status(404).json({ error: 'Build no encontrada o no autorizada' })

    const campos = ['nombre','descripcion','uso_principal','presupuesto_meta','es_publica','modo']
    const sets = [], params = []
    let i = 1

    for (const campo of campos) {
      if (req.body[campo] !== undefined) {
        sets.push(`${campo} = $${i++}`)
        params.push(req.body[campo])
      }
    }

    if (!sets.length)
      return res.status(400).json({ error: 'No hay campos para actualizar' })

    sets.push(`actualizado_en = now()`)
    params.push(req.params.id)

    const { rows } = await db.query(
      `UPDATE builds SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    )

    res.json(rows[0])
  } catch (err) {
    console.error('Error actualizando build:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// ─────────────────────────────────────────────────────────
// DELETE /api/builds/:id
// ─────────────────────────────────────────────────────────
router.delete('/:id', autenticar, async (req, res) => {
  try {
    const { rows } = await db.query(
      'DELETE FROM builds WHERE id = $1 AND usuario_id = $2 RETURNING id',
      [req.params.id, req.usuario.id]
    )
    if (!rows.length)
      return res.status(404).json({ error: 'Build no encontrada o no autorizada' })

    res.json({ mensaje: 'Build eliminada correctamente' })
  } catch (err) {
    console.error('Error eliminando build:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

module.exports = router
