# NoRug Research Studio v0.6.6 — Signed Batch Intake

## Alcance

- Selección múltiple de archivos desde el navegador.
- Selección de carpeta mediante `webkitdirectory`, preservando rutas relativas.
- ZIP conservado como objeto raíz inmutable y descargable.
- Escaneo ClamAV del ZIP antes de expandirlo.
- Parser ZIP defensivo sin escritura en disco.
- Rechazo de cifrado, rutas absolutas, `..`, enlaces, archivos especiales, Zip64,
  nombres duplicados, entradas vacías y relaciones de compresión sospechosas.
- Creación de un objeto hijo por cada formato aceptado; cada hijo recorre su propio
  escaneo, extracción o transcripción.
- Entradas duplicadas o rechazadas visibles en la parrilla aunque no se materialicen
  como objetos ejecutables.
- Manifiesto canónico con SHA-256, CRC-32, ruta, tamaño y resolución de cada entrada.
- Firma separada Ed25519 del manifiesto que contiene el SHA-256 del ZIP raíz.
- Verificación autenticada en `GET /api/bundles/:id/verify`.

## Semántica de la firma

El ZIP no se modifica para insertar la firma: hacerlo cambiaría su propio hash. La
aplicación conserva sus bytes originales y firma un manifiesto que incluye el SHA-256
del ZIP y de todas sus entradas. La prueba solo es confiable si la clave privada se
mantiene estable y el `keyId`/clave pública se publica fuera de la misma base de datos.

## Despliegue

```powershell
npm install
npm run evidence:keygen
# Copiar EVIDENCE_SIGNING_KEY_ID y EVIDENCE_SIGNING_PRIVATE_KEY_B64 a .env.

docker compose stop ingestion-worker research-studio
docker compose up -d postgres redis minio clamav transcriber
npm run db:migrate
docker compose build ingestion-worker research-studio
docker compose up -d --force-recreate ingestion-worker research-studio
npm test
npm run test:db
```

No vuelvas a ejecutar `evidence:keygen` en cada despliegue. Respalda la clave privada
de forma cifrada y publica la clave pública o su huella en un canal independiente.

## Prueba de aceptación

1. Subir tres archivos sueltos de formatos diferentes; deben aparecer tres objetos.
2. Subir una carpeta con subcarpetas; la parrilla debe conservar la ruta relativa.
3. Subir un ZIP con TXT, PDF y OPUS; debe aparecer el ZIP raíz y sus tres hijos.
4. Esperar el estado `signed` y abrir `Verificar firma`; `verified`,
   `manifestHashMatches`, `signatureValid` y `archiveHashMatches` deben ser `true`.
5. Subir el mismo ZIP; debe resolverse como duplicado sin crear una segunda raíz.
6. Probar un ZIP con `../escape.txt`; debe terminar rechazado/dead-letter sin hijos.
7. Probar un ZIP con un `.exe`; la entrada se registra como `rejected` en el
   manifiesto y no se materializa como objeto hijo.

## Límites conocidos

- La recepción HTTP aún usa `multipart/form-data` a través de Next.js y no debe usarse
  para lotes de varios GB.
- Zip64, ZIP cifrados y ZIP anidados están bloqueados.
- El lote puede completar parcialmente: la respuesta HTTP informa aceptados,
  duplicados y rechazados por separado.
- La firma demuestra integridad y procedencia respecto a la clave configurada; no
  demuestra por sí sola veracidad editorial del contenido.
