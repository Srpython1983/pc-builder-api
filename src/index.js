// src/index.js
// Punto de entrada principal del servidor

require('dotenv').config()

const express    = require('express')
const cors       = require('cors')
const helmet     = require('helmet')
const rateLimit  = require('express-rate-limit')

// Rutas
const authRoutes          = require('./routes/auth.routes')
const componentesRoutes   = require('./routes/componentes.routes')
const recomendadorRoutes  = require('./routes/recomendador.routes')
const buildsRoutes        = require('./routes/builds.routes')
const preciosRoutes       = require('./routes/precios.routes')

const app  = express()
const PORT = process.env.PORT || 3000

// ─────────────────────────────────────────────
// MIDDLEWARES GLOBALES
// ─────────────────────────────────────────────

// Seguridad HTTP básica (headers)
app.use(helmet())

// CORS: permite peticiones desde el frontend
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:3001',
    'http://localhost:4173',
  ],
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
}))

// Parsear JSON
app.use(express.json({ limit: '1mb' }))

// Rate limiting global: máximo 100 requests por IP cada 15 minutos
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intenta en unos minutos' },
})
app.use(limiter)

// Rate limiting más estricto para el recomendador (evita abuso)
const limiterRecomendador = rateLimit({
  windowMs: 60 * 1000,   // 1 minuto
  max: 10,
  message: { error: 'Límite de recomendaciones alcanzado, espera un momento' },
})

// ─────────────────────────────────────────────
// RUTAS
// ─────────────────────────────────────────────
app.use('/api/auth',         authRoutes)
app.use('/api/componentes',  componentesRoutes)
app.use('/api/recomendador', limiterRecomendador, recomendadorRoutes)
app.use('/api/builds',       buildsRoutes)
app.use('/api/precios',      preciosRoutes)

// Health check — útil para saber si el servidor está vivo
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    entorno: process.env.NODE_ENV || 'development',
  })
})

// 404 para rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ error: `Ruta ${req.method} ${req.path} no encontrada` })
})

// Manejador global de errores
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err)
  res.status(500).json({ error: 'Error interno del servidor' })
})

// ─────────────────────────────────────────────
// INICIAR SERVIDOR
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n PC Builder API corriendo en http://localhost:${PORT}`)
  console.log(` Entorno: ${process.env.NODE_ENV || 'development'}`)
  console.log(`\n Endpoints disponibles:`)
  console.log(`   POST /api/auth/registro`)
  console.log(`   POST /api/auth/login`)
  console.log(`   GET  /api/componentes`)
  console.log(`   POST /api/recomendador/auto`)
  console.log(`   POST /api/recomendador/filtrar-compatibles`)
  console.log(`   POST /api/recomendador/verificar`)
  console.log(`   GET  /api/builds`)
  console.log(`   POST /api/builds`)
  console.log(`   GET  /api/health\n`)
})

module.exports = app
