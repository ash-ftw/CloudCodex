#!/usr/bin/env pwsh
# Build all CloudCodeX Docker images

Write-Host "Building CloudCodeX Docker images..." -ForegroundColor Cyan

$images = @(
    @{ name = "cloudcodex-python"; path = "./languages/python" },
    @{ name = "cloudcodex-c-cpp"; path = "./languages/c-cpp" },
    @{ name = "cloudcodex-javascript"; path = "./languages/javascript" },
    @{ name = "cloudcodex-java"; path = "./languages/java" },
    @{ name = "cloudcodex-go"; path = "./languages/go" },
    @{ name = "cloudcodex-rust"; path = "./languages/rust" },
    @{ name = "cloudcodex-php"; path = "./languages/php" },
    @{ name = "cloudcodex-ruby"; path = "./languages/ruby" },
    @{ name = "cloudcodex-bash"; path = "./languages/bash" },
    @{ name = "cloudcodex-git-worker"; path = "./languages/git-worker" }
)

$failed = @()

foreach ($img in $images) {
    Write-Host "`nBuilding $($img.name)..." -ForegroundColor Yellow
    docker build -t $img.name $img.path
    
    if ($LASTEXITCODE -ne 0) {
        $failed += $img.name
        Write-Host "Failed to build $($img.name)" -ForegroundColor Red
    } else {
        Write-Host "Successfully built $($img.name)" -ForegroundColor Green
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
if ($failed.Count -eq 0) {
    Write-Host "All images built successfully!" -ForegroundColor Green
} else {
    Write-Host "Failed to build: $($failed -join ', ')" -ForegroundColor Red
}
