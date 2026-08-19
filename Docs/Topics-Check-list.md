# Checklist validado — NoRug Research Studio

Versión revisada: **v0.6.2 Audiovisual Transcription**  
Base analizada: paquete local **v0.6.2**  
Leyenda: `[x]` implementado · `[-]` parcial · `[ ]` pendiente

## Configuración

- [x] Crear investigaciones independientes.
- [x] Definir libremente el área de investigación.
- [x] Seleccionar idioma y formato de salida.
- [x] Configurar controles de aprobación humana.
- [x] Gestionar workspaces, equipos, usuarios, roles y permisos mediante API y administración visual.
- [x] Aislar proyectos, fuentes, evidencias, aprobaciones y actividad mediante `tenant_id` y PostgreSQL RLS.

## Captura de fuentes

- [x] Registrar manualmente fuentes con tipo, título y URL.
- [ ] Monitorizar canales de YouTube.
- [ ] Incorporar vídeos o directos de Twitch.
- [ ] Recopilar noticias, páginas web y RSS.
- [x] Importar y extraer PDF, DOCX, TXT, Markdown y CSV con hash del texto.
- [ ] Conectar APIs y fuentes personalizadas.
- [ ] Filtrar fuentes por fechas, temas y relevancia.
- [ ] Permitir que el humano seleccione qué materiales procesar.

## Procesamiento

- [-] Almacenar vídeo y audio con metadatos e integridad; conectores de descarga pendientes.
- [x] Transcribir automáticamente audio y vídeo con faster-whisper.
- [x] Utilizar CPU por defecto y GPU/CUDA mediante perfil opcional.
- [x] Generar marcas de tiempo por segmento y palabra.
- [x] Normalizar y fragmentar el contenido documental obtenido.
- [x] Ejecutar tareas concurrentes mediante worker independiente y BullMQ/Redis.
- [x] Implementar outbox, reintentos exponenciales, idempotencia y estado `dead_letter`.

## Investigación y verificación

- [x] Clasificar afirmaciones por nivel de confianza.
- [x] Diferenciar entre verificado, probable, hipotético y no demostrado.
- [x] Vincular cada afirmación con su fuente.
- [x] Generar hashes SHA-256 para las evidencias.
- [x] Exportar manifiesto firmado por hash incluyendo la custodia de objetos binarios.
- [ ] Cruzar información entre varias fuentes.
- [ ] Detectar contradicciones.
- [ ] Priorizar fuentes primarias.
- [ ] Eliminar duplicados y noticias ya utilizadas.
- [ ] Detectar afirmaciones sin respaldo.
- [ ] Aplicar controles forenses SWAT cuando corresponda.

## Generación editorial

- [ ] Crear un informe técnico consolidado.
- [ ] Generar guiones para vídeo o podcast.
- [ ] Adaptar lenguaje, duración, público y estilo.
- [ ] Incorporar instrucciones editoriales de cada marca.
- [ ] Crear newsletters y artículos.
- [ ] Generar capítulos, títulos, descripciones y etiquetas SEO.
- [ ] Mantener citas, referencias y atribuciones.

## Producción audiovisual

- [ ] Generar narración mediante proveedores TTS.
- [ ] Crear presentaciones y escenas visuales.
- [ ] Sincronizar voz, gráficos y recursos audiovisuales.
- [ ] Seleccionar clips mediante búsqueda semántica.
- [ ] Mezclar voz, música y efectos.
- [ ] Generar subtítulos.
- [ ] Construir una línea de tiempo editable.
- [ ] Exportar vídeo, audio y proyecto de edición.

## Supervisión humana

- [x] Mostrar puntos de control dentro del pipeline.
- [x] Permitir pausar y reanudar una investigación.
- [x] Acceder al centro de evidencias.
- [x] Registrar quién aprobó o rechazó una decisión.
- [ ] Aprobar o rechazar fuentes individuales.
- [ ] Editar el informe y el guion.
- [ ] Resolver contradicciones.
- [ ] Autorizar la publicación final.

## SaaS y operación

- [x] Dashboard responsive.
- [x] Visualización del progreso y actividad.
- [x] Métricas de fuentes y evidencias.
- [x] Persistencia en PostgreSQL.
- [x] Pool de conexiones configurable.
- [x] Migraciones versionadas, idempotentes y protegidas con advisory lock.
- [x] Importador transaccional e idempotente desde SQLite v0.3.
- [x] Transacciones atómicas en operaciones críticas.
- [x] API REST protegida por sesión.
- [x] Identidades persistentes en PostgreSQL con contraseña `scrypt`.
- [x] Workspaces y cambio de tenant desde la sesión.
- [x] Roles `owner`, `admin`, `editor`, `reviewer` y `viewer` aplicados en la API.
- [x] Aceptación y revocación de invitaciones con token de un solo uso y caducidad.
- [x] Recuperación de contraseña con token temporal y política de contraseña fuerte.
- [x] Sesiones opacas persistentes, caducidad, listado por dispositivo y revocación individual o global.
- [x] Cambio de contraseña autenticado y cierre automático de todas las sesiones.
- [x] Rate limiting persistente en los flujos de identidad sensibles.
- [x] Validación de origen en todas las mutaciones contra CSRF de origen cruzado.
- [x] Auditoría de accesos, credenciales, sesiones, invitaciones y administración del workspace.
- [x] Administración visual de miembros y cambio de roles, protegiendo al `owner`.
- [x] Usuario PostgreSQL de aplicación sin `SUPERUSER` ni `BYPASSRLS` en Docker.
- [x] Registro persistente de actividad.
- [x] Exportación del manifiesto de evidencias.
- [x] Liveness y readiness con diagnóstico PostgreSQL.
- [x] Almacenamiento privado en S3/R2/MinIO con descarga temporal firmada.
- [x] Deduplicación por SHA-256 y verificación de integridad desde el worker.
- [x] Análisis ClamAV, firma binaria, cuarentena y bloqueo de descarga antes de extraer contenido.
- [x] Transcripciones y segmentos audiovisuales persistentes con RLS, hashes e idioma detectado.
- [x] Reconciliación idempotente de objetos incompletos y refresco automático de trabajos activos.
- [ ] Control de consumo y costes por proveedor.
- [ ] Suscripciones y facturación.
- [-] Webhooks e integración con n8n; identidad implementada, eventos de investigación pendientes.
- [ ] Logs estructurados, métricas y trazas distribuidas.
- [-] Backup con checksum y restauración aislada implementados; falta programarlos y probarlos en destino.
- [x] CI con PostgreSQL 18, prueba RLS, pruebas unitarias, lint y build.

## Siguientes pasos priorizados

### P0 — Base SaaS segura

1. Seleccionar e incorporar un proveedor OIDC estable; Auth.js v5 continúa como beta.
2. Ejecutar las pruebas negativas RLS contra la infraestructura de destino.
3. Ejecutar la restauración de prueba en destino y programar backups con retención.
4. Conectar un gestor externo de secretos.

### P1 — Ingesta y procesamiento

1. OCR aislado para documentos sin capa textual.
2. Conectores YouTube, RSS/web y aprobación de fuentes.
3. Métricas de latencia, uso CPU/GPU y políticas de retención.
4. División de medios largos, diarización y selección humana de idioma cuando sea necesario.

### P2 — Inteligencia editorial

1. Extracción de afirmaciones y citas por fuente.
2. Cruce, contradicciones, deduplicación y RAG histórico.
3. Informe técnico y guion con aprobación humana.
4. Webhooks n8n, observabilidad y control de costes.

## Criterio de salida de v0.5 foundation

- [x] El código ya no importa `node:sqlite`.
- [x] `DATABASE_URL` es obligatorio.
- [x] Docker Compose incluye PostgreSQL y espera su healthcheck.
- [x] El esquema se aplica sin duplicar datos.
- [x] Las operaciones compuestas usan una sola transacción.
- [x] Existe una ruta de migración para los datos SQLite existentes.
- [x] El endpoint `/api/health` comprueba PostgreSQL.
- [x] Existe prueba de integración ejecutable con `npm run test:db`.
- [x] Todas las entidades de investigación incluyen `tenant_id` obligatorio.
- [x] PostgreSQL RLS utiliza el contexto transaccional `app.tenant_id`.
- [x] Docker crea un rol de aplicación `NOSUPERUSER NOBYPASSRLS`.
- [x] La sesión persistente referencia usuario y workspace activo; el rol se revalida en PostgreSQL.
- [x] Las mutaciones aplican una matriz de permisos por rol.
- [ ] Ejecutar `npm run test:db` contra la infraestructura PostgreSQL de destino antes del despliegue final.
- [x] Completar recuperación de contraseña y ciclo de invitaciones.
- [-] Herramientas de backup/restauración listas; falta ejecución programada y validación en destino.
- [ ] Completar OIDC, prueba RLS de destino y gestión externa de secretos antes de producción.
