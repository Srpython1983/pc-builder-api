// src/middleware/auth.js
// Verifica el token JWT en cada request protegido

const jwt = require('jsonwebtoken')

const autenticar = (req, res, next) => {
  const header = req.headers.authorization

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' })
  }

  const token = header.split(' ')[1]

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.usuario = payload   // { id, email, rol }
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

// Middleware opcional: no bloquea si no hay token, pero lo adjunta si existe
const autenticarOpcional = (req, res, next) => {
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) {
    try {
      req.usuario = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET)
    } catch (_) {}
  }
  next()
}

// Solo permite rol admin
const soloAdmin = (req, res, next) => {
  if (req.usuario?.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado' })
  }
  next()
}

module.exports = { autenticar, autenticarOpcional, soloAdmin }
