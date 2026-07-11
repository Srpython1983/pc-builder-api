// src/db/pool.js
const { Pool } = require('pg')

// En Railway usa DATABASE_URL directamente
// En local usa las variables individuales del .env
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : new Pool({
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME     || 'pc_builder',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })

pool.connect((err, client, release) => {
  if (err) {
    console.error('Error conectando a PostgreSQL:', err.message)
    process.exit(1)
  }
  console.log('PostgreSQL conectado correctamente')
  release()
})

const query = (text, params) => pool.query(text, params)
const getClient = () => pool.connect()

module.exports = { query, getClient, pool }