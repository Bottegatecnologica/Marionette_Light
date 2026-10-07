# Copy the runnable UI into docs/ for GitHub Pages.
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
# script lives in Marionette_Light/scripts
$root = Split-Path $PSScriptRoot -Parent
$static = Join-Path $root "static"
$docs = Join-Path $root "docs"
Copy-Item (Join-Path $static "style.css") (Join-Path $docs "style.css") -Force
Copy-Item (Join-Path $static "app.js") (Join-Path $docs "app.js") -Force
New-Item -ItemType Directory -Force -Path (Join-Path $docs "vendor") | Out-Null
Copy-Item (Join-Path $static "vendor\vis-network.min.js") (Join-Path $docs "vendor\vis-network.min.js") -Force
if (-not (Test-Path (Join-Path $docs ".nojekyll"))) {
  New-Item -ItemType File -Path (Join-Path $docs ".nojekyll") | Out-Null
}
Write-Host "Synced static → docs (keep docs/index.html + config.js)."
