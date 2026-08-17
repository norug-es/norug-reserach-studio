param(
  [string]$OutputDirectory = "./backups"
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupName = "norug-research-$timestamp.dump"
$containerPath = "/tmp/$backupName"
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$backupPath = Join-Path $resolvedOutput $backupName

try {
  $dumpCommand = 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --file=''{0}''' -f $containerPath
  docker compose exec -T postgres sh -c $dumpCommand
  if ($LASTEXITCODE -ne 0) { throw "pg_dump falló" }
  docker compose cp "postgres:$containerPath" $backupPath
  if ($LASTEXITCODE -ne 0) { throw "No se pudo copiar el backup" }
  $hash = (Get-FileHash -Algorithm SHA256 -Path $backupPath).Hash.ToLowerInvariant()
  "$hash  $backupName" | Set-Content -Encoding ascii "$backupPath.sha256"
  Write-Host "Backup creado: $backupPath"
  Write-Host "SHA-256: $hash"
} finally {
  docker compose exec -T postgres sh -c "rm -f '$containerPath'" 2>$null | Out-Null
}
