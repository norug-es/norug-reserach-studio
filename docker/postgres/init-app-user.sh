#!/bin/sh
set -eu

: "${POSTGRES_APP_USER:?POSTGRES_APP_USER es obligatorio}"
: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD es obligatorio}"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_user="$POSTGRES_APP_USER" \
  --set=app_password="$POSTGRES_APP_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'app_user', :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format(
  'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'app_user', :'app_password'
)
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user')
\gexec

SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'app_user')
\gexec

-- Si una versión anterior ejecutó las migraciones con el administrador,
-- transfiere la propiedad al rol de aplicación para que las migraciones futuras
-- funcionen sin convertir DATABASE_URL en una conexión privilegiada.
SELECT format('ALTER TABLE %I.%I OWNER TO %I', schemaname, tablename, :'app_user')
FROM pg_tables
WHERE schemaname = 'public' AND tableowner <> :'app_user'
\gexec

SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I', schemaname, sequencename, :'app_user')
FROM pg_sequences
WHERE schemaname = 'public' AND sequenceowner <> :'app_user'
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  current_user, :'app_user'
)
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
  current_user, :'app_user'
)
\gexec
SQL
