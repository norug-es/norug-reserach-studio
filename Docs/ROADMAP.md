# Roadmap de producto — NoRug Research Studio

Estado base: **v0.6.4 Media Signature Hotfix**  
Objetivo: evolucionar el MVP hacia un SaaS multiárea, multiusuario y auditable que automatice la investigación, la verificación editorial y la producción de contenidos sin eliminar el control humano.

## Principios de ejecución

1. Seguridad y aislamiento antes que conectores o IA.
2. Toda afirmación debe conservar fuente, contexto, clasificación y evidencia.
3. Los procesos costosos se ejecutan de forma asíncrona, idempotente y observable.
4. La IA propone; los puntos críticos requieren una decisión humana registrada.
5. Cada versión debe incluir migración, pruebas, documentación y ruta de reversión.

## Secuencia de versiones

| Versión | Objetivo | Dependencia principal | Criterio de salida |
|---|---|---|---|
| v0.5 | Base SaaS multi-tenant | PostgreSQL y sesiones | Datos aislados, roles y pruebas RLS |
| v0.6 | Ingesta y procesamiento | v0.5 | Archivos, colas y conectores operativos |
| v0.7 | Inteligencia de investigación | v0.6 | Afirmaciones, citas, contradicciones y RAG |
| v0.8 | Generación editorial | v0.7 | Informe, guion y aprobación editorial |
| v0.9 | Producción audiovisual | v0.8 | Audio, vídeo, subtítulos y timeline editable |
| v1.0 | Operación comercial | v0.5–v0.9 | Facturación, observabilidad, backups y SLO |

## v0.5 — Base SaaS segura

### Entregas

- **v0.5.0 Multi-tenant Foundation:** usuarios, workspaces, roles, sesión con tenant activo y RLS forzada.
- **v0.5.1 Identity & Teams:** administración visual, cambio de roles, invitaciones de un solo uso, recuperación de contraseña y webhook de identidad firmado.
- **v0.5.2 Hotfix:** type-check limitado al código activo, revalidación de workspace corregida y reparación idempotente del rol PostgreSQL sin privilegios.
- **v0.5.3 Hotfix:** entorno PostgreSQL unificado entre Next.js, migraciones y pruebas; diagnóstico previo sin exposición de secretos y exclusiones coherentes de código histórico.
- **v0.5.4 Production Hardening:** sesiones opacas revocables, cambio de contraseña, rate limiting persistente, validación de origen, auditoría de seguridad, CI PostgreSQL y herramientas de backup/restauración.
- **Pendiente para declarar v0.5 estable:** OIDC con proveedor estable, prueba RLS y restauración ejecutadas en infraestructura de destino, programación de backups y gestión externa de secretos.

### Alcance

- Usuarios persistentes y sesiones asociadas a una identidad.
- Workspaces y membresías.
- Roles `owner`, `admin`, `editor`, `reviewer` y `viewer`.
- `tenant_id` obligatorio en proyectos, fuentes, evidencias, aprobaciones y actividad.
- Políticas PostgreSQL Row Level Security.
- Cambio de workspace sin mezclar datos.
- Invitaciones y gestión básica de miembros.
- Migración de la información existente a un workspace inicial.

### Criterios de salida

- Un usuario solo puede consultar workspaces a los que pertenece.
- Un tenant no puede leer ni modificar registros de otro tenant, incluso mediante SQL accidental sin contexto.
- Los permisos se comprueban tanto en la API como en PostgreSQL.
- La migración conserva todos los datos de v0.4.1.
- Existen pruebas positivas y negativas de aislamiento.
- La recuperación de contraseña y el ciclo de invitaciones están cerrados en v0.5.1.
- Las sesiones revocables y los controles de abuso quedan cerrados en v0.5.4.
- La autenticación OIDC queda cerrada antes de declarar v0.5 estable. Auth.js v5 continúa como beta, por lo que no se incorpora todavía como dependencia central; la decisión se revisará junto con el proveedor OIDC.

## v0.6 — Ingesta y procesamiento

- **v0.6.0 Ingestion Foundation:** MinIO/S3, Redis/BullMQ, worker independiente, outbox transaccional, RLS, deduplicación SHA-256, carga privada y descarga temporal.
- **v0.6.1 Secure Extraction:** firma binaria, ClamAV, cuarentena, migración 7, extracción PDF/DOCX/texto y fragmentos trazables.
- **v0.6.2 Audiovisual Transcription:** faster-whisper privado, migración 8, idioma, timestamps, palabras, CPU/CUDA y reconciliación automática.
- **v0.6.3 Live Transcription & Media Streaming:** progreso NDJSON y ETA en frontend, logs de avance, streaming autenticado con rangos y soporte de ingesta MPEG/MPG.
- **v0.6.4 Media Signature Hotfix:** reconoce MP3 con sufijo `.mpeg`/`.mpg`, persiste el MIME audiovisual real y diferencia errores de firma de errores ClamAV.
- [x] S3, R2 o MinIO para objetos binarios.
- [x] Redis y BullMQ para tareas asíncronas.
- [x] Estados de trabajo, reintentos, idempotencia y dead-letter queue.
- [x] Carga de PDF, DOCX, TXT, audio y vídeo.
- [x] Verificación de tamaño y SHA-256 desde el worker.
- [x] Inspección antimalware y cuarentena efectiva.
- [x] Extracción de texto de PDF, DOCX, TXT, Markdown y CSV.
- [x] Whisper con timestamps, detección de idioma y segmentos persistentes.
- [x] Progreso de transcripción visible en vivo, con fase, timeline procesada y ETA aproximada.
- [x] Reproducción same-origin mediante HTTP Range y compatibilidad de ingesta MPEG/MPG.
- [x] Perfil CPU por defecto y CUDA opcional mediante Compose.
- Conectores YouTube, RSS/web y APIs personalizadas.
- Selección y aprobación humana de fuentes.

## v0.7 — Inteligencia de investigación

- Extracción de afirmaciones y citas por fuente.
- Priorización de fuentes primarias.
- Cruce de información y detección de contradicciones.
- Detección de afirmaciones sin respaldo.
- Deduplicación semántica y comparación con investigaciones históricas.
- RAG por workspace con aislamiento estricto.
- Controles forenses SWAT configurables por área.

## v0.8 — Generación editorial

- Informe técnico consolidado con citas.
- Guiones para vídeo y podcast.
- Artículos, newsletters y resúmenes ejecutivos.
- Perfiles editoriales por marca, idioma, público y duración.
- Capítulos, títulos, descripción y etiquetas SEO.
- Editor humano, historial de cambios y aprobación final.

## v0.9 — Producción audiovisual

- TTS con proveedores intercambiables.
- Presentaciones y escenas visuales.
- Selección semántica de clips autorizados.
- Subtítulos y sincronización por timestamps.
- Mezcla de voz, música y efectos mediante FFmpeg.
- Timeline editable y exportación de vídeo, audio y proyecto.

## v1.0 — SaaS operable y comercial

- Planes, suscripciones, límites y facturación.
- Medición de tokens, almacenamiento, GPU y costes por proveedor.
- Webhooks firmados e integración con n8n.
- Logs estructurados, métricas, trazas y alertas.
- Backups automáticos y restauración probada.
- Gestión externa de secretos.
- Rate limiting, auditoría de seguridad y SLO documentados.

## Orden inmediato de implementación

1. Validar la migración 8 y una transcripción real CPU/CUDA en la infraestructura de destino.
2. Añadir OCR aislado para PDF sin capa de texto.
3. Añadir conectores YouTube/RSS/web con aprobación humana.
4. Incorporar métricas operativas del worker, ClamAV y Whisper.
5. Seleccionar OIDC y gestor externo de secretos antes del despliegue público.

## Condiciones que bloquean el avance

- No se inicia v0.6 si RLS no tiene pruebas negativas.
- No se procesan archivos sin almacenamiento de objetos y política de retención.
- No se generan textos finales sin citas trazables y aprobación humana.
- No se habilita facturación sin medición verificable del consumo.
