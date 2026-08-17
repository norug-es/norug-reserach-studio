# NoRug Research Studio v0.5.3

MVP SaaS para organizar investigaciones multiárea con trazabilidad desde la fuente hasta la aprobación editorial. Funciona con **Next.js puro y PostgreSQL**; no utiliza Vite, Vinext, Wrangler ni Cloudflare Workers.

## Qué funciona realmente

- Usuarios persistentes y sesión firmada con cookie `HttpOnly`.
- Workspaces con roles `owner`, `admin`, `editor`, `reviewer` y `viewer`.
- Administración visual de miembros, cambio de roles y expulsión protegida del `owner`.
- Revalidación de membresía y rol en PostgreSQL en cada petición autenticada.
- Invitaciones con token de un solo uso, caducidad, aceptación y revocación.
- Recuperación de contraseña con token de 30 minutos y política de contraseña fuerte.
- Entrega de eventos de identidad mediante webhook firmado, compatible con n8n.
- Aislamiento de proyectos y evidencias mediante `tenant_id` y PostgreSQL RLS.
- Investigaciones configurables por área, idioma y formato de salida.
- PostgreSQL 18 con pool de conexiones, migraciones versionadas y bloqueo concurrente.
- Transacciones atómicas para proyectos, fuentes, evidencias y aprobaciones.
- Evidencias vinculadas a su fuente, clasificación de confianza y hash SHA-256.
- Pipeline de 17 pasos, pausa, reanudación y controles humanos.
- Registro de actividad y exportación del manifiesto de evidencias.
- API REST protegida por sesión.
- Endpoints separados de vida (`/api/live`) y disponibilidad (`/api/health`).
- Docker Compose con aplicación, PostgreSQL y healthchecks.

Los conectores externos, IA generativa, Whisper, FFmpeg, colas, facturación y producción audiovisual permanecen en el roadmap. El estado completo está en [Docs/Topics-Check-list.md](Docs/Topics-Check-list.md).

## Requisitos

- Node.js 22.13 o superior.
- npm 10 o superior.
- Docker Desktop para levantar PostgreSQL localmente.

## Inicio rápido con Docker

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Abre `http://localhost:3034`.

Docker espera a que PostgreSQL esté sano antes de iniciar la aplicación. Las migraciones y los datos de demostración se aplican automáticamente de forma idempotente.

La v0.5 utiliza un usuario PostgreSQL de aplicación sin privilegios `SUPERUSER` ni `BYPASSRLS`. No cambies `DATABASE_URL` por el usuario administrador: anularía el aislamiento RLS.

## Desarrollo en VS Code

Levanta solo PostgreSQL:

```powershell
Copy-Item .env.example .env
docker compose up -d postgres
npm install
npm run db:migrate
npm run dev
```

Identidad inicial de desarrollo:

```text
Email: admin@norug.es
Contraseña: norug-demo
```

La contraseña se almacena mediante `scrypt` dentro de PostgreSQL. Antes de producción cambia `AUTH_SECRET`, `IDENTITY_WEBHOOK_SECRET` y las dos contraseñas PostgreSQL. OIDC continúa pendiente: Auth.js v5 sigue distribuido como beta, por lo que esta versión evita introducirlo como dependencia crítica y conserva una frontera de identidad reemplazable.

## Reparación al actualizar desde v0.5.1–v0.5.2

La v0.5.3 corrige tres fallos de integración: el type-check incluía código antiguo guardado bajo `data/`, podía faltar la importación que revalida el workspace y `.env`/`.env.local` podían utilizar credenciales diferentes. También endurece la reparación del rol PostgreSQL cuando las primeras migraciones se ejecutaron accidentalmente con el administrador.

Detén `npm run dev` y ejecuta:

```powershell
docker compose exec postgres sh /docker-entrypoint-initdb.d/10-app-user.sh
```

Comprueba que `.env` —y `.env.local` si existe— utilicen el rol de aplicación:

```dotenv
DATABASE_URL=postgresql://norug_app:change-this-app-password@localhost:5432/norug_research
```

`DATABASE_URL` no debe utilizar `POSTGRES_USER=norug`: ese usuario administra el contenedor y omite la protección RLS. Después ejecuta `npm run test:db`; el resultado esperado es una prueba superada con `rlsEnforced=true`.

`npm run db:env-check` detecta diferencias entre `.env`, `.env.local` y una variable `DATABASE_URL` heredada de PowerShell sin mostrar la contraseña.

## Actualizar desde v0.4.1

La v0.5 usa el volumen `postgres-v05-data` para no sobrescribir el volumen anterior. Si solo utilizabas los datos de demostración, inicia normalmente la nueva versión. Si tienes investigaciones reales, no elimines el volumen v0.4.1: realiza un `pg_dump` y una restauración controlada antes de retirarlo.

## Importar datos de la v0.3

Si ya tienes `data/research-studio.db`, conserva una copia de seguridad y ejecuta:

```powershell
$env:SQLITE_PATH="./data/research-studio.db"
npm run db:import-sqlite
```

El importador conserva identificadores, fechas, relaciones y hashes. Puede ejecutarse nuevamente: utiliza operaciones idempotentes dentro de una única transacción PostgreSQL.

## Variables PostgreSQL

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Cadena PostgreSQL obligatoria |
| `POSTGRES_APP_USER` | Usuario de aplicación sin privilegios de bypass RLS |
| `POSTGRES_APP_PASSWORD` | Contraseña del usuario de aplicación |
| `DATABASE_SSL` | Activa TLS hacia un proveedor gestionado |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Valida el certificado del servidor |
| `DATABASE_POOL_MAX` | Máximo de conexiones por instancia |
| `DATABASE_IDLE_TIMEOUT_MS` | Cierre de conexiones ociosas |
| `DATABASE_CONNECT_TIMEOUT_MS` | Tiempo máximo de conexión |

Para Supabase, Neon, RDS u otro PostgreSQL gestionado, utiliza su `DATABASE_URL`, activa `DATABASE_SSL=true` cuando corresponda y no expongas credenciales en Git.

## Identidad e invitaciones

| Variable | Uso |
|---|---|
| `APP_URL` | Origen público usado para construir enlaces de invitación y recuperación |
| `AUTH_SECRET` | Firma de la sesión local; utiliza al menos 32 caracteres aleatorios |
| `AUTH_COOKIE_SECURE` | Cookie solo HTTPS; en producción debe ser `true` |
| `IDENTITY_WEBHOOK_URL` | Endpoint de entrega de email o automatización, por ejemplo un webhook de n8n |
| `IDENTITY_WEBHOOK_SECRET` | Firma HMAC independiente de los eventos de identidad |

El webhook recibe JSON con `type`, `email`, `url`, `workspace` cuando corresponda y `occurredAt`. La cabecera `x-norug-signature` contiene `sha256=<HMAC hexadecimal>` calculado sobre el cuerpo exacto. En desarrollo, si no hay webhook, la interfaz muestra el enlace de prueba; en producción no expone tokens en la respuesta.

## Validación

```powershell
npm run lint
npm run test:structure
npm run test:identity
npm run build
npm run test:db
```

`test:db` requiere `DATABASE_URL` y comprueba conexión, migración y datos iniciales.

## API

| Método | Ruta | Función |
|---|---|---|
| `GET` | `/api/live` | Liveness sin dependencia de PostgreSQL |
| `GET` | `/api/health` | Readiness, versión PostgreSQL, migración y latencia |
| `POST` | `/api/auth/login` | Crear sesión local |
| `POST` | `/api/auth/logout` | Cerrar sesión |
| `POST` | `/api/auth/password/forgot` | Solicitar recuperación sin revelar si el usuario existe |
| `POST` | `/api/auth/password/reset` | Consumir token y establecer una nueva contraseña |
| `POST` | `/api/invitations/accept` | Aceptar invitación y crear la sesión |
| `GET/POST` | `/api/projects` | Listar y crear investigaciones |
| `GET/POST` | `/api/workspaces` | Listar y crear workspaces |
| `POST` | `/api/workspaces/switch` | Cambiar el workspace de la sesión |
| `GET/POST` | `/api/workspaces/members` | Miembros e invitaciones del workspace activo |
| `PATCH/DELETE` | `/api/workspaces/members/:userId` | Cambiar rol o retirar un miembro |
| `DELETE` | `/api/workspaces/invitations/:id` | Revocar una invitación pendiente |
| `GET/PATCH` | `/api/projects/:id` | Snapshot y estado del proyecto |
| `GET/POST` | `/api/projects/:id/sources` | Fuentes |
| `GET/POST` | `/api/projects/:id/evidence` | Evidencias y hashes |
| `GET/POST` | `/api/projects/:id/approvals` | Decisiones humanas |
| `GET` | `/api/export/evidence?projectId=:id` | Manifiesto JSON |

## Estructura

```text
app/                 páginas y Route Handlers
components/          interfaz interactiva
lib/db.ts            pool, salud y transacciones
lib/migrations.ts    esquema y datos iniciales versionados
lib/repository.ts    operaciones PostgreSQL
lib/workspaces.ts    usuarios, workspaces, membresías e invitaciones
lib/identity.ts      recuperación y entrega de eventos firmados
lib/passwords.ts     política, hash y verificación de contraseñas
lib/permissions.ts   matriz de permisos por rol
scripts/migrate.ts   migración manual
tests/               checklist estructural e integración PostgreSQL
```

## Producción

La compilación genera `.next/standalone`. Publica el servicio detrás de Caddy, Nginx o Traefik con HTTPS y deja `AUTH_COOKIE_SECURE=true`. El número total de conexiones es `DATABASE_POOL_MAX × instancias`; ajústalo al límite del servidor o incorpora PgBouncer al escalar horizontalmente.

`AUTH_COOKIE_SECURE=false` solo debe utilizarse durante desarrollo HTTP local. La v0.5.3 completa recuperación de contraseña y ciclo de invitaciones e incorpora los hotfixes de compilación, entorno y rol PostgreSQL. Antes de producción todavía hay que seleccionar e integrar un proveedor OIDC estable, ejecutar las pruebas RLS contra la infraestructura de destino y disponer de backups/restauración verificados.

Copyright © 2026 NoRug.es. Todos los derechos reservados.
