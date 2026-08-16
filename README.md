# NoRug Research Studio

Plataforma SaaS de investigación multiárea que transforma fuentes verificables en informes, guiones y contenido audiovisual mediante inteligencia artificial, automatización y supervisión humana.

## Estado

**V0.1 — prototipo funcional de experiencia de usuario.**

Esta versión permite validar el flujo de trabajo y la interfaz. Las integraciones externas, persistencia, facturación y procesamiento audiovisual todavía están simulados.

## Funcionalidades

- Área de investigación configurable.
- Pipeline visual de 17 pasos agrupado en cinco fases.
- Puntos de aprobación humana antes del guion y la publicación.
- Centro de evidencias con fuente, clasificación y nivel de confianza.
- Paneles de fuentes, actividad y controles editoriales.
- Interfaz responsive con identidad NoRug.es.
- Arquitectura preparada para proveedores de IA intercambiables.

## Principios

- Evidencia antes que narrativa.
- Fuentes primarias y trazabilidad por afirmación.
- Separación entre contenido verificado, probable, hipotético y no demostrado.
- Supervisión humana en decisiones editoriales críticas.
- Minimización del lock-in de proveedores.
- Respeto por copyright, atribución y licencias.

## Stack de la V0.1

- React 19
- Next.js 16
- TypeScript
- Tailwind CSS 4
- Vinext / Vite
- Cloudflare Workers compatible

## Ejecución local

Requisitos:

- Node.js 22.13 o superior.
- npm.
- Linux, WSL2 o un entorno compatible con los scripts Bash incluidos.

```bash
npm ci
npm run dev
```

Para generar la versión de producción:

```bash
npm run build
```

## Roadmap

- Backend multiusuario y autenticación.
- PostgreSQL, colas de trabajo y almacenamiento de objetos.
- Conectores para YouTube, Twitch, RSS, web, documentos y APIs.
- Whisper para transcripción y FFmpeg para procesamiento audiovisual.
- RAG con búsqueda semántica y deduplicación histórica.
- Registro de procedencia y hashes SHA-256 por evidencia.
- Adaptadores para modelos OpenAI, Anthropic, Google y modelos locales.
- Facturación por suscripción y consumo.
- Exportación de informes, guiones, podcasts y paquetes de edición.

## Seguridad y límites

No introduzcas claves API en el repositorio. Utiliza variables de entorno y un gestor de secretos. El contenido generado por IA debe revisarse antes de publicarse y no constituye evidencia primaria.

## Licencia

Copyright © 2026 NoRug.es. Todos los derechos reservados.

La licencia comercial y de contribución se definirá antes de la primera versión pública estable.
