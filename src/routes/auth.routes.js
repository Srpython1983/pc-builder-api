// src/routes/auth.routes.js
const express  = require('express')
const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const db       = require('../db/pool')
const { autenticar } = require('../middleware/auth')

const router = express.Router()

// POST /api/auth/registro
router.post('/registro', async (req, res) => {
  try {
    const { nombre, email, password } = req.body

    if (!nombre || !email || !password)
      return res.status(400).json({ error: 'Nombre, email y password son requeridos' })

    if (password.length < 6)
      return res.status(400).json({ error: 'El password debe tener al menos 6 caracteres' })

    // Verificar si el email ya existe
    const { rows: existe } = await db.query(
      'SELECT id FROM usuarios WHERE email = $1', [email]
    )
    if (existe.length)
      return res.status(409).json({ error: 'Este email ya está registrado' })

    const hash = await bcrypt.hash(password, 12)

    const { rows } = await db.query(
      `INSERT INTO usuarios (nombre, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, nombre, email, creado_en`,
      [nombre, email, hash]
    )

    const usuario = rows[0]
    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    )

    res.status(201).json({ token, usuario })

  } catch (err) {
    console.error('Error en registro:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password)
      return res.status(400).json({ error: 'Email y password requeridos' })

    const { rows } = await db.query(
      'SELECT id, nombre, email, password_hash, rol FROM usuarios WHERE email = $1 AND activo = true',
      [email]
    )

    if (!rows.length)
      return res.status(401).json({ error: 'Credenciales incorrectas' })

    const usuario = rows[0]
    const passwordOk = await bcrypt.compare(password, usuario.password_hash)

    if (!passwordOk)
      return res.status(401).json({ error: 'Credenciales incorrectas' })

    // Actualizar último acceso
    await db.query(
      'UPDATE usuarios SET ultimo_acceso = now() WHERE id = $1',
      [usuario.id]
    )

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: usuario.rol },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    )

    const { password_hash, ...usuarioSinPassword } = usuario
    res.json({ token, usuario: usuarioSinPassword })

  } catch (err) {
    console.error('Error en login:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /api/auth/me  — obtener perfil del usuario logueado
router.get('/me', autenticar, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, nombre, email, rol, creado_en, ultimo_acceso FROM usuarios WHERE id = $1',
      [req.usuario.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' })
    res.json(rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

module.exports = router
