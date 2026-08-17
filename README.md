# NoRug Research Studio v0.3

MVP SaaS local para organizar investigaciones multiárea con trazabilidad desde la fuente hasta la aprobación editorial. Esta versión funciona con **Next.js puro** y no contiene Vite, Vinext, Wrangler ni Cloudflare Workers.

## Qué funciona realmente

- Acceso local mediante cookie de sesión firmada.
- Proyectos con área de investigación, idioma, salida y estado.
- Persistencia SQLite mediante el módulo nativo `node:sqlite`.
- Registro de fuentes web, vídeo, RSS, documentos, APIs y redes sociales.
- Centro de evidencias con clasificación, confianza y hash SHA-256.
- Pipeline visual de 17 pasos agrupado en cinco fases.
- Pausa y reanudación persistente del pipeline.
- Aprobaciones o rechazos humanos con registro del revisor.
- Registro de actividad auditable.
- Exportación del manifiesto de evidencias en JSON.
- API REST protegida por sesión.
- Endpoint de salud y compilación standalone para Docker/VPS.

Los conectores externos, IA generativa, Whisper, FFmpeg, colas, facturación y montaje audiovisual permanecen en el roadmap. La interfaz no pretende simular que esos servicios ya están conectados.

## Requisitos

- Node.js 22.13 o superior.
- npm 10 o superior.
- Windows, macOS o Linux.

## Ejecutar en VS Code (Windows)

Abre la carpeta del proyecto en VS Code y ejecuta:

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Abre `http://localhost:3000`.

Credenciales iniciales:

```text
Email: admin@norug.es
Contraseña: norug-demo
```

Antes de usarlo fuera de local cambia `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `AUTH_SECRET` en `.env.local`.

## Validación

```powershell
npm run lint
npm run test:structure
npm run build
npm start
```

La base de datos se crea automáticamente en `data/research-studio.db` y carga una investigación demostrativa la primera vez.

## API

| Método | Ruta | Función |
|---|---|---|
| `GET` | `/api/health` | Estado de Next.js y SQLite |
| `POST` | `/api/auth/login` | Crear sesión local |
| `POST` | `/api/auth/logout` | Cerrar sesión |
| `GET/POST` | `/api/projects` | Listar y crear investigaciones |
| `GET/PATCH` | `/api/projects/:id` | Snapshot y estado del proyecto |
| `GET/POST` | `/api/projects/:id/sources` | Fuentes |
| `GET/POST` | `/api/projects/:id/evidence` | Evidencias y hashes |
| `GET/POST` | `/api/projects/:id/approvals` | Control humano |
| `GET` | `/api/export/evidence?projectId=:id` | Manifiesto JSON |

## Estructura

```text
app/          páginas y Route Handlers
components/   interfaz interactiva
lib/          sesión, SQLite, repositorio y tipos
data/         base SQLite local, ignorada por Git
tests/        controles estructurales
```

## Producción

La configuración genera `.next/standalone`. Para una instalación SaaS real deben reemplazarse las credenciales locales por un proveedor de identidad, mover SQLite a PostgreSQL cuando exista concurrencia multiinstancia y usar un gestor de secretos.

### Proxy inverso y TLS

En producción, publica la aplicación detrás de un proxy inverso (por ejemplo, Nginx, Caddy o Traefik) que termine TLS:

1. Configura un dominio y un certificado TLS válido en el proxy.
2. Haz que el proxy atienda `https://tu-dominio.example` y reenvíe las peticiones a `http://127.0.0.1:3034`.
3. Reenvía, como mínimo, los encabezados `Host`, `X-Forwarded-For` y `X-Forwarded-Proto`.
4. Mantén el puerto `3034` cerrado al exterior (o enlazado únicamente a `127.0.0.1`) y accede al servicio por el dominio HTTPS.

Con `NODE_ENV=production`, `sessionCookieOptions.secure` es `true` de forma predeterminada. El navegador solo devuelve una cookie marcada como `Secure` mediante HTTPS; por ello, el acceso directo a `http://host:3034` puede mostrar el inicio de sesión como correcto, pero **no conservará la sesión** en las peticiones posteriores.

Para una instalación local que deba funcionar explícitamente solo con HTTP, define:

```dotenv
AUTH_COOKIE_SECURE=false
```

`AUTH_COOKIE_SECURE` solo admite `true` o `false`; cualquier otro valor detiene la aplicación con un error de configuración. Omitirla mantiene el comportamiento seguro recomendado: `true` en producción y `false` durante el desarrollo. Desactivar esta protección permite que la cookie viaje sin cifrar, por lo que no debe usarse en una red no confiable ni en un despliegue público.

Copyright © 2026 NoRug.es. Todos los derechos reservados.
