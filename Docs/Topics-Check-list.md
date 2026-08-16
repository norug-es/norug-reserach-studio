## Checklist general — NoRug Research Studio

### Configuración

* [x] Crear investigaciones independientes.
* [x] Definir libremente el área de investigación.
* [x] Seleccionar idioma y formato de salida.
* [x] Configurar controles de aprobación humana.
* [ ] Gestionar equipos, usuarios, roles y permisos.

### Captura de fuentes

* [ ] Monitorizar canales de YouTube.
* [ ] Incorporar vídeos o directos de Twitch.
* [ ] Recopilar noticias, páginas web y RSS.
* [ ] Importar PDF, DOCX, TXT y otros documentos.
* [ ] Conectar APIs y fuentes personalizadas.
* [ ] Filtrar fuentes por fechas, temas y relevancia.
* [ ] Permitir que el humano seleccione qué materiales procesar.

### Procesamiento

* [ ] Descargar vídeo, audio y metadatos.
* [ ] Transcribir automáticamente con Whisper.
* [ ] Utilizar GPU/CUDA cuando esté disponible.
* [ ] Generar marcas de tiempo precisas.
* [ ] Normalizar los datos obtenidos.
* [ ] Ejecutar tareas concurrentes mediante workers y colas.

### Investigación y verificación

* [x] Clasificar afirmaciones por nivel de confianza.
* [x] Diferenciar entre verificado, probable y no demostrado.
* [ ] Cruzar información entre varias fuentes.
* [ ] Detectar contradicciones.
* [ ] Priorizar fuentes primarias.
* [ ] Eliminar duplicados y noticias ya utilizadas.
* [ ] Detectar afirmaciones sin respaldo.
* [ ] Vincular cada afirmación con su evidencia.
* [ ] Conservar hashes SHA-256 y cadena de custodia.
* [ ] Aplicar controles forenses SWAT cuando corresponda.

### Generación editorial

* [ ] Crear un informe técnico consolidado.
* [ ] Generar guiones para vídeo o podcast.
* [ ] Adaptar lenguaje, duración, público y estilo.
* [ ] Incorporar instrucciones editoriales de cada marca.
* [ ] Crear newsletters y artículos.
* [ ] Generar capítulos, títulos, descripciones y etiquetas SEO.
* [ ] Mantener citas, referencias y atribuciones.

### Producción audiovisual

* [ ] Generar narración mediante proveedores TTS.
* [ ] Crear presentaciones y escenas visuales.
* [ ] Sincronizar voz, gráficos y recursos audiovisuales.
* [ ] Seleccionar clips mediante búsqueda semántica.
* [ ] Mezclar voz, música y efectos.
* [ ] Generar subtítulos.
* [ ] Construir una línea de tiempo editable.
* [ ] Exportar vídeo, audio y proyecto de edición.

### Supervisión humana

* [x] Mostrar puntos de control dentro del pipeline.
* [x] Permitir pausar una investigación.
* [x] Acceder al centro de evidencias.
* [ ] Aprobar o rechazar fuentes.
* [ ] Editar el informe y el guion.
* [ ] Resolver contradicciones.
* [ ] Autorizar la publicación final.
* [ ] Registrar quién aprobó cada decisión.

### SaaS y operación

* [x] Dashboard responsive.
* [x] Visualización del progreso y actividad.
* [x] Métricas de fuentes, evidencias y tiempo ahorrado.
* [ ] Persistencia en PostgreSQL.
* [ ] Almacenamiento de archivos.
* [ ] Control de consumo y costes por proveedor.
* [ ] Suscripciones y facturación.
* [ ] API, webhooks e integración con n8n.
* [ ] Auditoría, logs y observabilidad.
* [ ] Exportación de expedientes y manifiestos de evidencia.

**Estado real:** la V0.1 implementa la experiencia visual e interactiva. La ingestión, IA, transcripción, almacenamiento, facturación y producción audiovisual todavía deben conectarse al backend.
