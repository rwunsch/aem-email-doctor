# dev.ps1 — Install dependencies, build, and start AEM Email Doctor.
# Works on Windows PowerShell and PowerShell Core.

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$MinNode = 18
$Port = if ($env:PORT) { $env:PORT } else { "5000" }

function Info($msg)  { Write-Host $msg -ForegroundColor Cyan }
function Ok($msg)    { Write-Host $msg -ForegroundColor Green }
function Err($msg)   { Write-Host $msg -ForegroundColor Red; exit 1 }

# Check Node.js
try {
    $nodeVer = (node -v) -replace '^v', ''
    $major = [int]($nodeVer -split '\.')[0]
    if ($major -lt $MinNode) {
        Err "Node.js v$nodeVer found, but v$MinNode+ is required."
    }
    Ok "Node.js v$nodeVer OK"
} catch {
    Err "Node.js is not installed. Install Node.js $MinNode+ from https://nodejs.org"
}

# Check npm
try {
    $npmVer = npm -v
    Ok "npm $npmVer OK"
} catch {
    Err "npm is not installed. It should come with Node.js."
}

Info ""
Info "Installing dependencies..."
npm install
if ($LASTEXITCODE -ne 0) { Err "npm install failed" }

Info ""
Info "Building..."
npm run build
if ($LASTEXITCODE -ne 0) { Err "Build failed" }

Info ""
Ok "Build complete."
Info "Starting web UI on port $Port..."
Info ""

node dist/cli/index.js serve --port $Port
