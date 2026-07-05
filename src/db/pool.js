// src/db/pool.js
// Conexión central a PostgreSQL usando un pool (reutiliza conexiones)

const { Pool } = require('pg')

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'pc_builder',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20,               // máximo 20 conexiones simultáneas
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

// Verificar conexión al iniciar
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error conectando a PostgreSQL:', err.message)
    process.exit(1)
  }
  console.log('PostgreSQL conectado correctamente')
  release()
})

// Helper: ejecutar una query
const query = (text, params) => pool.query(text, params)

// Helper: obtener un cliente para transacciones
const getClient = () => pool.connect()

module.exports = { query, getClient, pool }
