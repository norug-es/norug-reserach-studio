param(
  [Parameter(Mandatory = $true)][string]$BackupPath,
  [string]$VerificationDatabase = "norug_research_restore_check"
)

$ErrorActionPreference = "Stop"
$resolvedBackup = (Resolve-Path $BackupPath).Path
if ($VerificationDatabase -notmatch '^[a-zA-Z][a-zA-Z0-9_]+$') {
  throw "El nombre de la base de verificación no es válido"
}
if ($VerificationDatabase -eq "norug_research") {
  throw "La restauración de verificación nunca puede usar la base principal"
}
$containerPath = "/tmp/norug-restore-check.dump"

try {
  docker compose cp $resolvedBackup "postgres:$containerPath"
  if ($LASTEXITCODE -ne 0) { throw "No se pudo copiar el backup al contenedor" }
  $restoreCommand = 'dropdb -U "$POSTGRES_USER" --if-exists ''{0}'' && createdb -U "$POSTGRES_USER" ''{0}'' && pg_restore -U "$POSTGRES_USER" -d ''{0}'' --clean --if-exists ''{1}''' -f $VerificationDatabase, $containerPath
  docker compose exec -T postgres sh -c $restoreCommand
  if ($LASTEXITCODE -ne 0) { throw "La restauración de verificación falló" }
  $checkCommand = 'psql -U "$POSTGRES_USER" -d ''{0}'' -v ON_ERROR_STOP=1 -c ''SELECT MAX(version) AS migration_version FROM schema_migrations;'' -c ''SELECT COUNT(*) AS projects FROM projects;''' -f $VerificationDatabase
  docker compose exec -T postgres sh -c $checkCommand
  if ($LASTEXITCODE -ne 0) { throw "Las comprobaciones del backup fallaron" }
  Write-Host "Backup restaurado y validado en una base aislada"
} finally {
  $cleanupCommand = 'dropdb -U "$POSTGRES_USER" --if-exists ''{0}''; rm -f ''{1}''' -f $VerificationDatabase, $containerPath
  docker compose exec -T postgres sh -c $cleanupCommand 2>$null | Out-Null
}
