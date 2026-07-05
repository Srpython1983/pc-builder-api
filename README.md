# PC Builder API

Backend completo para el PC Builder. Construido con Node.js + Express + PostgreSQL.
**100% gratuito — sin APIs de pago.**

---

## Requisitos

- Node.js 18 o superior
- PostgreSQL 14 o superior

---

## Instalación paso a paso

### 1. Instalar dependencias

```bash
cd pc-builder-api
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env` con tus datos de PostgreSQL:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=pc_builder
DB_USER=postgres
DB_PASSWORD=tu_password
JWT_SECRET=una_clave_muy_larga_y_segura_aqui
PORT=3000
```

### 3. Crear la base de datos

```bash
# En PostgreSQL
psql -U postgres -c "CREATE DATABASE pc_builder;"

# Ejecutar el esquema completo (archivo SQL del proyecto)
psql -U postgres -d pc_builder -f pc_builder_database.sql
```

### 4. Iniciar el servidor

```bash
# Desarrollo (se reinicia automáticamente con nodemon)
npm run dev

# Producción
npm start
```

El servidor estará en `http://localhost:3000`

---

## Endpoints de la API

### Autenticación

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/registro` | Crear cuenta |
| POST | `/api/auth/login` | Iniciar sesión |
| GET  | `/api/auth/me` | Perfil del usuario (requiere token) |

### Componentes

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/api/componentes` | Listar con filtros |
| GET  | `/api/componentes/:id` | Detalle + historial de precios |
| GET  | `/api/componentes/:id/compatibles?categoria=cpu` | Componentes compatibles |
| POST | `/api/componentes` | Crear (solo admin) |
| PATCH| `/api/componentes/:id` | Actualizar (solo admin) |

**Filtros disponibles en GET /api/componentes:**
```
?categoria=gpu
?marca=nvidia
?precio_max=300
?precio_min=100
?socket=AM5
?tipo_ram=DDR5
?q=rtx+4070
```

### Recomendador

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/recomendador/auto` | Build automática por descripción |
| POST | `/api/recomendador/filtrar-compatibles` | Modo manual: filtra compatibles |
| POST | `/api/recomendador/verificar` | Verifica compatibilidad de una build |

**Ejemplo modo automático:**
```json
POST /api/recomendador/auto
{
  "descripcion": "quiero jugar Cyberpunk a 1440p sin gastar mucho",
  "presupuesto": 900
}
```

**Respuesta:**
```json
{
  "perfil_detectado": { "uso": "gaming", "nivel": "alto", "resolucion": "1440p" },
  "explicacion": "Build balanceada para gaming...",
  "total_real": 847,
  "presupuesto_ingresado": 900,
  "ahorro": 53,
  "componentes": [ ... ],
  "compatible": true,
  "advertencias": []
}
```

**Ejemplo modo manual (filtrar compatibles):**
```json
POST /api/recomendador/filtrar-compatibles
{
  "categoria_objetivo": "cpu",
  "elegidos": {
    "motherboard": "uuid-de-la-placa-elegida"
  }
}
```

### Builds

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/api/builds` | Mis builds (requiere token) |
| GET    | `/api/builds/publicas` | Builds públicas de todos |
| GET    | `/api/builds/:id` | Detalle de una build |
| POST   | `/api/builds` | Crear build |
| PATCH  | `/api/builds/:id` | Actualizar build |
| DELETE | `/api/builds/:id` | Eliminar build |

**Ejemplo crear build:**
```json
POST /api/builds
Authorization: Bearer <token>
{
  "nombre": "Mi PC gamer",
  "uso_principal": "gaming",
  "presupuesto_meta": 900,
  "modo": "manual",
  "es_publica": true,
  "componentes": {
    "motherboard": "uuid-mb",
    "cpu": "uuid-cpu",
    "ram": "uuid-ram",
    "gpu": "uuid-gpu",
    "storage": "uuid-ssd",
    "psu": "uuid-psu",
    "case": "uuid-case"
  }
}
```

### Precios

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/api/precios/:componenteId` | Precios actuales por tienda |
| GET  | `/api/precios/:componenteId/historial` | Historial para gráfico |
| POST | `/api/precios` | Registrar precio (scraper, admin) |
| POST | `/api/precios/batch` | Registrar múltiples precios (scraper) |

---

## Estructura de carpetas

```
pc-builder-api/
├── src/
│   ├── index.js                    ← Servidor principal
│   ├── db/
│   │   └── pool.js                 ← Conexión PostgreSQL
│   ├── middleware/
│   │   └── auth.js                 ← Verificación JWT
│   ├── routes/
│   │   ├── auth.routes.js          ← Login / registro
│   │   ├── componentes.routes.js   ← Catálogo de piezas
│   │   ├── recomendador.routes.js  ← Motor de recomendación
│   │   ├── builds.routes.js        ← Guardar / compartir builds
│   │   └── precios.routes.js       ← Precios y historial
│   └── services/
│       ├── ia.service.js           ← Lógica de recomendación (sin APIs externas)
│       └── compatibilidad.service.js ← Reglas de compatibilidad
├── .env.example
├── package.json
└── README.md
```

---

## Siguiente paso: Scraper de precios

El scraper corre independiente y llama a `POST /api/precios/batch` con un token de admin.
Para obtener el token de admin:

1. Registra un usuario normal via `/api/auth/registro`
2. En PostgreSQL cambia su rol: `UPDATE usuarios SET rol = 'admin' WHERE email = 'tu@email.com';`
3. Haz login y usa ese token en el scraper

---

## Tecnologías usadas

- **Express** — servidor HTTP
- **PostgreSQL** — base de datos
- **bcryptjs** — hash de passwords
- **jsonwebtoken** — autenticación JWT
- **helmet** — seguridad HTTP
- **express-rate-limit** — protección contra abuso
- **cors** — control de acceso cross-origin

**Sin APIs de pago. Sin servicios externos de IA. 100% open source.**
