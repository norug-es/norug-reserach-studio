# NoRug Research Studio v0.6.2

MVP SaaS para organizar investigaciones multiárea con trazabilidad desde la fuente hasta la aprobación editorial. Funciona con **Next.js puro y PostgreSQL**; no utiliza Vite, Vinext, Wrangler ni Cloudflare Workers.

## Qué funciona realmente

- Usuarios persistentes y sesiones opacas revocables; la cookie `HttpOnly` nunca contiene identidad ni permisos.
- Vista de dispositivos, cierre individual o global de sesiones y cambio de contraseña autenticado.
- Rate limiting persistente en login, recuperación, restablecimiento, invitaciones y cambio de contraseña.
- Protección de todas las mutaciones mediante validación de `Origin` y auditoría de eventos de seguridad.
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
- Docker Compose con aplicación, PostgreSQL, Redis, MinIO, ClamAV, worker y healthchecks.
- CI con PostgreSQL 18, prueba negativa RLS, lint, pruebas y build.
- Backup PostgreSQL con checksum y restauración de prueba en una base aislada.
- Almacenamiento privado S3-compatible: MinIO local y compatibilidad con S3/R2 en producción.
- Carga controlada de documentos, audio y vídeo, deduplicada por SHA-256.
- Cola Redis/BullMQ con worker independiente, reintentos exponenciales y estado `dead_letter`.
- Outbox PostgreSQL transaccional para no perder trabajos cuando Redis no está disponible.
- Verificación del contenido almacenado por tamaño y hash antes de marcarlo como listo.
- Inspección de firma binaria real y validación estricta de archivos de texto UTF-8.
- Escaneo ClamAV previo al procesamiento, cuarentena persistente y descarga bloqueada.
- Extracción de PDF, DOCX, TXT, Markdown y CSV con texto normalizado y hash independiente.
- Fragmentación reproducible del texto para preparar búsqueda semántica y RAG.
- Transcripción local de audio y vídeo con `faster-whisper`, detección de idioma y timestamps.
- Segmentos y palabras temporizadas persistidos en PostgreSQL con RLS forzada.
- Ejecución Whisper por CPU y perfil CUDA opcional mediante Docker Compose.
- Reconciliación automática de objetos incompletos y actualización visual durante trabajos activos.

Los conectores externos, IA generativa, OCR, facturación y producción audiovisual permanecen en el roadmap. El estado completo está en [Docs/Topics-Check-list.md](Docs/Topics-Check-list.md).

## Requisitos

- Node.js 22.13 o superior.
- npm 10 o superior.
- Docker Desktop para levantar PostgreSQL, Redis, MinIO, ClamAV, Whisper y el worker localmente.
- Para CUDA: GPU NVIDIA, controlador compatible y NVIDIA Container Toolkit/soporte GPU de Docker Desktop.

## Inicio rápido con Docker

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Abre `http://localhost:3034`.

Docker espera a que PostgreSQL esté sano antes de iniciar la aplicación. Las migraciones y los datos de demostración se aplican automáticamente de forma idempotente.

La v0.5 utiliza un usuario PostgreSQL de aplicación sin privilegios `SUPERUSER` ni `BYPASSRLS`. No cambies `DATABASE_URL` por el usuario administrador: anularía el aislamiento RLS.

## Desarrollo en VS Code

Levanta las dependencias y el worker:

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d postgres redis minio clamav transcriber ingestion-worker
npm run db:migrate
npm run dev
```

Identidad inicial de desarrollo:

```text
Email: admin@norug.es
Contraseña: norug-demo
```

La contraseña se almacena mediante `scrypt` dentro de PostgreSQL. Antes de producción cambia `AUTH_SECRET`, `IDENTITY_WEBHOOK_SECRET` y las dos contraseñas PostgreSQL. OIDC continúa pendiente: Auth.js v5 sigue distribuido como beta, por lo que esta versión evita introducirlo como dependencia crítica y conserva una frontera de identidad reemplazable.

Al aplicar la migración 5, las cookies firmadas de versiones anteriores dejan de ser válidas: cada usuario debe iniciar sesión una vez para crear su sesión persistente revocable.

La migración 6 añade `stored_objects`, `processing_jobs` y el outbox. Los dos primeros aplican RLS forzada. MinIO queda disponible en `http://localhost:9000` y su consola en `http://localhost:9001`.

La migración 7 añade dictámenes antimalware, documentos extraídos y fragmentos con RLS forzada. Los objetos aceptados por v0.6.0 se devuelven automáticamente a la cola para recibir su primer escaneo ClamAV; mientras tanto no se consideran nuevamente listos.

La migración 8 añade transcripciones y segmentos audiovisuales con RLS forzada. Al arrancar el worker v0.6.2, la reconciliación crea de forma idempotente los trabajos de escaneo, extracción o transcripción que falten.

## Actualizar desde v0.6.1

Detén primero el worker anterior para que no consuma trabajos de la nueva versión:

```powershell
docker compose stop ingestion-worker research-studio
npm install
docker compose up -d postgres redis minio clamav
docker compose build transcriber ingestion-worker research-studio
npm run db:migrate
docker compose up -d transcriber
npm run test:transcriber
docker compose up -d ingestion-worker research-studio
npm run test:db
npm run ingestion:health-check
npm test
docker compose ps
```

El primer trabajo puede tardar porque `faster-whisper` descarga el modelo configurado al volumen `whisper-models-v062`. El worker nuevo repara automáticamente objetos que no tengan dictamen, extracción o transcripción persistida.

## Actualizar desde v0.6.0

Conserva los volúmenes existentes y añade las variables nuevas de `.env.example` a tu `.env`. Después ejecuta:

```powershell
docker compose stop ingestion-worker research-studio
npm install
docker compose up -d postgres redis minio clamav
docker compose build transcriber ingestion-worker research-studio
npm run db:migrate
npm run test:db
npm run test:clamav
docker compose up -d transcriber
npm run test:transcriber
docker compose up -d ingestion-worker research-studio
npm run ingestion:health-check
npm test
docker compose ps
```

El primer arranque de ClamAV puede tardar mientras prepara su base de firmas. No publiques el puerto 3310: el Compose solo lo enlaza a `127.0.0.1` para las pruebas del host y el worker utiliza la red privada de Docker.

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

## Almacenamiento y cola

| Variable | Uso |
|---|---|
| `S3_ENDPOINT` | Endpoint interno S3-compatible usado por aplicación y worker |
| `S3_PUBLIC_ENDPOINT` | Endpoint HTTPS alcanzable por el navegador para descargas firmadas |
| `S3_BUCKET` | Bucket privado de investigaciones |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Credenciales del bucket |
| `S3_FORCE_PATH_STYLE` | Necesario para MinIO; normalmente `false` en AWS S3 |
| `S3_AUTO_CREATE_BUCKET` | Solo desarrollo; en producción el bucket se aprovisiona previamente |
| `UPLOAD_MAX_BYTES` | Límite por archivo; 52.428.800 bytes por defecto |
| `REDIS_URL` | Redis de BullMQ; usa `rediss://` fuera de red privada/local |
| `WORKER_CONCURRENCY` | Trabajos concurrentes por instancia del worker |
| `REDIS_CONNECT_TIMEOUT_MS` | Tiempo máximo de conexión inicial a Redis |
| `CLAMAV_HOST` / `CLAMAV_PORT` | Daemon privado de análisis antimalware |
| `CLAMAV_TIMEOUT_MS` | Tiempo máximo por escaneo |
| `EXTRACTED_TEXT_MAX_CHARS` | Límite defensivo del texto extraído |
| `TRANSCRIBER_URL` | Endpoint privado del servicio Whisper |
| `TRANSCRIBER_API_KEY` | Credencial interna independiente entre worker y transcriptor |
| `TRANSCRIBER_TIMEOUT_MS` | Tiempo máximo de una transcripción |
| `TRANSCRIBER_MAX_BYTES` | Límite aceptado por el servicio de transcripción |
| `WHISPER_MODEL` | Modelo: `tiny`, `base`, `small`, `medium`, `large-v3`, etc. |
| `WHISPER_LANGUAGE` | Idioma ISO o `auto` para detección automática |
| `WHISPER_DEVICE` / `WHISPER_COMPUTE_TYPE` | `cpu/int8` o `cuda/float16` |

## Identidad e invitaciones

| Variable | Uso |
|---|---|
| `APP_URL` | Origen público usado para construir enlaces de invitación y recuperación |
| `AUTH_SECRET` | Secreto para derivar identificadores privados de seguridad; utiliza al menos 32 caracteres aleatorios |
| `AUTH_COOKIE_SECURE` | Cookie solo HTTPS; en producción debe ser `true` |
| `IDENTITY_WEBHOOK_URL` | Endpoint de entrega de email o automatización, por ejemplo un webhook de n8n |
| `IDENTITY_WEBHOOK_SECRET` | Firma HMAC independiente de los eventos de identidad |

El webhook recibe JSON con `type`, `email`, `url`, `workspace` cuando corresponda y `occurredAt`. La cabecera `x-norug-signature` contiene `sha256=<HMAC hexadecimal>` calculado sobre el cuerpo exacto. En desarrollo, si no hay webhook, la interfaz muestra el enlace de prueba; en producción no expone tokens en la respuesta.

Antes de desplegar, valida las variables críticas:

```powershell
npm run env:production-check
```

El comando exige HTTPS, cookie segura, secretos independientes, rol PostgreSQL no administrativo, TLS para servicios remotos y parámetros válidos de ClamAV y Whisper.

## Backup y restauración comprobada

Con PostgreSQL de Docker en ejecución:

```powershell
npm run backup:db
npm run backup:verify -- -BackupPath .\backups\norug-research-AAAAMMDD-HHMMSS.dump
```

El primer comando genera un dump en formato custom y su checksum SHA-256. El segundo restaura el dump en `norug_research_restore_check`, comprueba migraciones y proyectos, y elimina esa base temporal. Nunca restaura sobre `norug_research`.

Este backup cubre PostgreSQL, no los objetos de S3/MinIO. En producción debes aplicar versionado y una política de réplica o backup independiente al bucket.

## Ingesta y worker

Formatos iniciales: PDF, DOCX, TXT, Markdown, CSV, MP3, WAV, M4A, MP4, WEBM y MOV. El límite por defecto es 50 MB y se configura con `UPLOAD_MAX_BYTES`.

```powershell
docker compose up -d postgres redis minio clamav transcriber ingestion-worker
npm run db:migrate
npm run ingestion:health-check
npm run test:clamav
npm run test:transcriber
npm run dev
```

Para ejecutar el worker directamente fuera de Docker:

```powershell
npm run worker:dev
```

Los comandos `npm run test:clamav`, `npm run test:transcriber` y `npm run ingestion:health-check` se ejecutan desde el host. Por ello, `.env` debe conservar `REDIS_URL=redis://localhost:6379`, `CLAMAV_HOST=localhost` y `TRANSCRIBER_URL=http://127.0.0.1:8088`. Compose sustituye automáticamente esos valores por `redis`, `clamav` y `http://transcriber:8080` dentro de los contenedores; esos nombres privados no resuelven desde PowerShell.

La v0.6.2 ejecuta `upload → firma → ClamAV → extracción|transcripción → ready`. Un resultado infectado termina en `quarantined` y no obtiene URL de descarga. Los documentos producen texto y fragmentos; audio y vídeo producen texto, segmentos, palabras y timestamps. Los PDF basados únicamente en imágenes continúan señalados para OCR.

CPU es el perfil predeterminado. Para utilizar CUDA:

```powershell
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build transcriber ingestion-worker
```

Comprueba primero `nvidia-smi`. Si Docker no reconoce la GPU, utiliza CPU; configurar `WHISPER_DEVICE=cuda` sin runtime NVIDIA hará fallar el transcriptor.

ClamAV reduce riesgo, pero no demuestra que un archivo sea inocuo. La firma `clean` significa que el motor y las firmas instaladas no detectaron una amenaza conocida en ese momento.

## Validación

```powershell
npm run lint
npm run test:structure
npm run test:identity
npm run test:security
npm run test:ingestion
npm run test:clamav
npm run test:transcriber
npm run typecheck:worker
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
| `POST` | `/api/account/password` | Cambiar contraseña y revocar todas las sesiones |
| `DELETE` | `/api/account/sessions` | Revocar todas las demás sesiones |
| `DELETE` | `/api/account/sessions/:id` | Revocar una sesión propia |
| `POST` | `/api/invitations/accept` | Aceptar invitación y crear la sesión |
| `GET/POST` | `/api/projects/:id/uploads` | Listar o cargar objetos de investigación |
| `GET` | `/api/objects/:id/download` | Descarga privada mediante URL temporal firmada |
| `GET` | `/api/objects/:id/transcription` | Texto completo y segmentos temporizados del objeto |
| `POST` | `/api/jobs/:id/retry` | Reintentar un trabajo fallido o en dead-letter |
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
lib/sessions.ts      sesiones opacas persistentes y revocación
lib/security.ts      origen, rate limiting y auditoría de seguridad
lib/storage.ts       cliente S3-compatible y URLs temporales
lib/ingestion.ts     objetos, jobs, outbox e idempotencia
lib/queue.ts         conexión BullMQ/Redis
lib/clamav.ts        protocolo privado PING, VERSION e INSTREAM
lib/file-inspection.ts firmas binarias y política UTF-8
lib/extraction.ts    extracción, normalización y fragmentación
lib/transcriber.ts   cliente privado Whisper y validación de segmentos
docker/transcriber/  servicio faster-whisper CPU/CUDA
scripts/migrate.ts   migración manual
scripts/ingestion-worker.ts worker independiente
scripts/*postgres*   backup y restauración aislada
tests/               checklist estructural e integración PostgreSQL
```

## Producción

La compilación genera `.next/standalone`. Publica el servicio detrás de Caddy, Nginx o Traefik con HTTPS y deja `AUTH_COOKIE_SECURE=true`. El número total de conexiones es `DATABASE_POOL_MAX × instancias`; ajústalo al límite del servidor o incorpora PgBouncer al escalar horizontalmente.

`AUTH_COOKIE_SECURE=false` solo debe utilizarse durante desarrollo HTTP local. La v0.6.2 incluye transcripción local, pero todavía no incorpora OCR ni conectores audiovisuales externos. Antes de producción todavía hay que seleccionar OIDC, conectar un gestor de secretos, proteger servicios internos y programar backups coordinados de base de datos, objetos y modelos.

Copyright © 2026 NoRug.es. Todos los derechos reservados.
