#!/usr/bin/env pwsh
<#
.SYNOPSIS
Builds and publishes the CloudCodeX worker container image to GHCR.

.DESCRIPTION
Builds the worker Docker image and pushes it to ghcr.io/ash-ftw/cloudcodex-worker.
Never hardcodes credentials; reads token from environment variable or prompts securely.
#>

param(
    [string]$Tag = "latest",
    [string]$Owner = "ash-ftw"
)

$ErrorActionPreference = "Stop"

$imageName = "ghcr.io/$($Owner.ToLower())/cloudcodex-worker:$Tag"
$dockerfilePath = Join-Path $PSScriptRoot "languages/git-worker"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " CloudCodeX Worker Image Publisher" -ForegroundColor Cyan
Write-Host " Target Image: $imageName" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Check Docker daemon availability
try {
    docker info > $null 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Docker Desktop is not currently running. Please start Docker Desktop and try again."
        exit 1
    }
} catch {
    Write-Error "Docker is not available in PATH or not running."
    exit 1
}

# GHCR Login check
Write-Host "`n[1/3] Checking GHCR authentication..." -ForegroundColor Yellow
if (-not $env:GHCR_PAT) {
    Write-Host "Provide your GitHub Personal Access Token (PAT) with 'write:packages' scope." -ForegroundColor Gray
    Write-Host "(Alternatively set `$env:GHCR_PAT beforehand)" -ForegroundColor Gray
    $secureToken = Read-Host -Prompt "Enter GitHub PAT" -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $token = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
} else {
    $token = $env:GHCR_PAT
}

$token | docker login ghcr.io -u $Owner --password-stdin
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to authenticate with ghcr.io."
    exit 1
}

# Build Image
Write-Host "`n[2/3] Building worker image..." -ForegroundColor Yellow
docker build -t $imageName $dockerfilePath
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker build failed."
    exit 1
}

# Push Image
Write-Host "`n[3/3] Pushing to GHCR ($imageName)..." -ForegroundColor Yellow
docker push $imageName
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker push failed."
    exit 1
}

Write-Host "`nSuccessfully published $imageName!" -ForegroundColor Green
Write-Host "View package on GitHub: https://github.com/$Owner/CloudCodex/pkgs/container/cloudcodex-worker" -ForegroundColor Cyan
