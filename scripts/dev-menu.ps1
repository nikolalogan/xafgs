param(
    [string]$DevComposeFile = "docker-compose.dev.yml"
)

$ErrorActionPreference = "Stop"

function Invoke-Compose {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Args
    )

    & docker compose -f $DevComposeFile @Args
}

function Show-Header {
    Write-Host ""
    Write-Host "Project dev menu"
    Write-Host "Current compose file: $DevComposeFile"
    Write-Host ""
}

function Show-Menu {
    Write-Host "Select an action:"
    Write-Host "  1) Start dev stack"
    Write-Host "  2) Build and start (offline first)"
    Write-Host "  3) Stop dev stack"
    Write-Host "  4) View dev logs"
    Write-Host "  5) View container status"
    Write-Host "  6) Sync OCR wheels"
    Write-Host "  7) Sync Docling wheels"
    Write-Host "  8) Offline build OCR"
    Write-Host "  9) Offline build Docling"
    Write-Host "  0) Exit"
    Write-Host ""
}

function Pause-Menu {
    Write-Host ""
    Read-Host "Press Enter to continue" | Out-Null
}

while ($true) {
    Show-Header
    Show-Menu
    $choice = (Read-Host "Enter choice").Trim()

    switch ($choice) {
        "1" {
            Invoke-Compose up
        }
        "2" {
            Invoke-Compose up --build
        }
        "3" {
            Invoke-Compose down
            Pause-Menu
        }
        "4" {
            Invoke-Compose logs -f
        }
        "5" {
            Invoke-Compose ps
            & docker compose ps
            Pause-Menu
        }
        "6" {
            & bash ocr-service/scripts/download_wheels.sh
            Pause-Menu
        }
        "7" {
            & bash docling-service/scripts/download_wheels.sh
            Pause-Menu
        }
        "8" {
            New-Item -ItemType Directory -Force -Path ocr-service/model_cache | Out-Null
            & bash ocr-service/scripts/verify_wheels.sh
            $env:OCR_WHEELS_ONLY = "1"
            try {
                Invoke-Compose build ocr-service
            }
            finally {
                Remove-Item Env:OCR_WHEELS_ONLY -ErrorAction SilentlyContinue
            }
            Pause-Menu
        }
        "9" {
            New-Item -ItemType Directory -Force -Path docling-service/model_cache | Out-Null
            $env:DOCLING_WHEELS_ONLY = "1"
            try {
                Invoke-Compose build docling-service
            }
            finally {
                Remove-Item Env:DOCLING_WHEELS_ONLY -ErrorAction SilentlyContinue
            }
            Pause-Menu
        }
        "0" {
            exit 0
        }
        default {
            Write-Host "Invalid choice: $choice"
            Pause-Menu
        }
    }
}
