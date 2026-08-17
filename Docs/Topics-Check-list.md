# Checklist validado — NoRug Research Studio

Versión revisada: **v0.5.0 Multi-tenant Foundation**  
Base analizada: `main@7bc16f10743ae3ecac3cad2b2c8e40e79ef075c0`  
Leyenda: `[x]` implementado · `[-]` parcial · `[ ]` pendiente

## Configuración

- [x] Crear investigaciones independientes.
- [x] Definir libremente el área de investigación.
- [x] Seleccionar idioma y formato de salida.
- [x] Configurar controles de aprobación humana.
- [-] Gestionar workspaces, equipos, usuarios, roles y permisos; núcleo y APIs implementados, falta completar invitaciones y administración visual.
- [x] Aislar proyectos, fuentes, evidencias, aprobaciones y actividad mediante `tenant_id` y PostgreSQL RLS.

## Captura de fuentes

- [x] Registrar manualmente fuentes con tipo, título y URL.
- [ ] Monitorizar canales de YouTube.
- [ ] Incorporar vídeos o directos de Twitch.
- [ ] Recopilar noticias, páginas web y RSS.
- [ ] Importar PDF, DOCX, TXT y otros documentos.
- [ ] Conectar APIs y fuentes personalizadas.
- [ ] Filtrar fuentes por fechas, temas y relevancia.
- [ ] Permitir que el humano seleccione qué materiales procesar.

## Procesamiento

- [ ] Descargar vídeo, audio y metadatos.
- [ ] Transcribir automáticamente con Whisper.
- [ ] Utilizar GPU/CUDA cuando esté disponible.
- [ ] Generar marcas de tiempo precisas.
- [ ] Normalizar los datos obtenidos.
- [ ] Ejecutar tareas concurrentes mediante workers y colas.
- [ ] Implementar reintentos, idempotencia y cola de errores.

## Investigación y verificación

- [x] Clasificar afirmaciones por nivel de confianza.
- [x] Diferenciar entre verificado, probable, hipotético y no demostrado.
- [x] Vincular cada afirmación con su fuente.
- [x] Generar hashes SHA-256 para las evidencias.
- [-] Exportar manifiesto firmado por hash; falta custodia de artefactos binarios.
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
- [x] Usuario PostgreSQL de aplicación sin `SUPERUSER` ni `BYPASSRLS` en Docker.
- [x] Registro persistente de actividad.
- [x] Exportación del manifiesto de evidencias.
- [x] Liveness y readiness con diagnóstico PostgreSQL.
- [ ] Almacenamiento de archivos en S3/R2/MinIO.
- [ ] Control de consumo y costes por proveedor.
- [ ] Suscripciones y facturación.
- [ ] Webhooks e integración con n8n.
- [ ] Logs estructurados, métricas y trazas distribuidas.
- [ ] Backups automáticos y prueba documentada de restauración.

## Siguientes pasos priorizados

### P0 — Base SaaS segura

1. Completar aceptación/revocación de invitaciones y administración visual de miembros.
2. Incorporar OIDC/Auth.js, recuperación y cambio de contraseña.
3. Ejecutar las pruebas negativas RLS contra la infraestructura de destino.
4. Backups automáticos, restauración probada y secretos externos.

### P1 — Ingesta y procesamiento

1. Almacenamiento de objetos para documentos, audio y vídeo.
2. Cola de trabajos con Redis/BullMQ o un worker equivalente.
3. Conectores YouTube, RSS/web y carga documental.
4. Whisper con marcas de tiempo, reintentos e idempotencia.

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
- [x] La sesión contiene usuario, workspace activo y rol.
- [x] Las mutaciones aplican una matriz de permisos por rol.
- [ ] Ejecutar `npm run test:db` contra la infraestructura PostgreSQL de destino antes del despliegue final.
- [ ] Completar Auth.js/OIDC, recuperación de contraseña y ciclo de invitaciones antes de producción.
