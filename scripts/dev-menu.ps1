param(
    [string]$DevComposeFile = "docker-compose.dev.yml"
)

$ErrorActionPreference = "Stop"

$StartItems = @(
    @{ Name = "frontend"; Target = "menu-start-frontend" }
    @{ Name = "backend"; Target = "menu-start-backend" }
    @{ Name = "ocr-service"; Target = "menu-start-ocr-service" }
    @{ Name = "ocr-table-service"; Target = "menu-start-ocr-table-service" }
    @{ Name = "docling-service"; Target = "menu-start-docling-service" }
    @{ Name = "vllm"; Target = "menu-start-vllm" }
    @{ Name = "gateway"; Target = "menu-start-gateway" }
    @{ Name = "postgres"; Target = "menu-start-postgres" }
    @{ Name = "redis"; Target = "menu-start-redis" }
)

$BuildItems = @(
    @{ Name = "frontend"; Target = "menu-build-frontend" }
    @{ Name = "backend"; Target = "menu-build-backend" }
    @{ Name = "ocr-service"; Target = "menu-build-ocr-service" }
    @{ Name = "ocr-table-service"; Target = "menu-build-ocr-table-service" }
    @{ Name = "docling-service"; Target = "menu-build-docling-service" }
    @{ Name = "vllm"; Target = "menu-build-vllm" }
    @{ Name = "gateway"; Target = "menu-build-gateway" }
    @{ Name = "postgres"; Target = "menu-build-postgres" }
    @{ Name = "redis"; Target = "menu-build-redis" }
)

$PreloadItems = @(
    @{ Name = "ocr-table-layout"; Target = "menu-preload-ocr-table-layout" }
    @{ Name = "ocr-table-structure"; Target = "menu-preload-ocr-table-structure" }
    @{ Name = "ocr-table-all"; Target = "menu-preload-ocr-table-all" }
    @{ Name = "docling-model"; Target = "menu-preload-docling" }
)

function Invoke-MenuMake {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Target
    )
    & make "DEV_COMPOSE_FILE=$DevComposeFile" $Target
}

function Show-Header {
    Write-Host ""
    Write-Host "Dev Menu"
    Write-Host "Compose File: $DevComposeFile"
    Write-Host ""
}

function Pause-Menu {
    Write-Host ""
    Read-Host "Press Enter to continue" | Out-Null
}

function Read-MenuChoice {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Prompt
    )
    $value = Read-Host $Prompt
    if ($null -eq $value) {
        return ""
    }
    return $value.Trim()
}

function Show-Main-Menu {
    Write-Host "Select action:"
    Write-Host "  1) Start"
    Write-Host "  2) Build"
    Write-Host "  3) Preload"
    Write-Host "  4) Stop"
    Write-Host "  5) Logs"
    Write-Host "  6) Status"
    Write-Host "  0) Exit"
    Write-Host ""
}

function Show-Submenu {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,
        [Parameter(Mandatory = $true)]
        [array]$Items
    )
    Write-Host ("Select {0} action:" -f $Title)
    Write-Host "  1) All"
    Write-Host "  2) Single"
    Write-Host "  0) Back"
    Write-Host ""
    Write-Host ("{0} options:" -f $Title)
    for ($i = 0; $i -lt $Items.Count; $i++) {
        Write-Host ("  {0}) {1}" -f ($i + 1), $Items[$i].Name)
    }
    Write-Host ""
}

function Select-SingleItem {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,
        [Parameter(Mandatory = $true)]
        [array]$Items
    )
    Write-Host ("Select single {0} item:" -f $Title)
    for ($i = 0; $i -lt $Items.Count; $i++) {
        Write-Host ("  {0}) {1}" -f ($i + 1), $Items[$i].Name)
    }
    Write-Host "  0) Back"
    Write-Host ""
    $choice = Read-MenuChoice -Prompt "Enter option number"
    if ($choice -eq "0") {
        return
    }
    if ($choice -notmatch '^\d+$') {
        Write-Host "Invalid option: $choice"
        Pause-Menu
        return
    }
    $index = [int]$choice
    if ($index -lt 1 -or $index -gt $Items.Count) {
        Write-Host "Invalid option: $choice"
        Pause-Menu
        return
    }
    Invoke-MenuMake -Target $Items[$index - 1].Target
    Pause-Menu
}

function Show-Start-Submenu {
    while ($true) {
        Show-Header
        Show-Submenu -Title "start" -Items $StartItems
        $choice = Read-MenuChoice -Prompt "Enter option number"
        switch ($choice) {
            "1" {
                Invoke-MenuMake -Target "menu-start-all"
                Pause-Menu
            }
            "2" {
                Select-SingleItem -Title "start" -Items $StartItems
            }
            "0" { return }
            default {
                Write-Host "Invalid option: $choice"
                Pause-Menu
            }
        }
    }
}

function Show-Build-Submenu {
    while ($true) {
        Show-Header
        Show-Submenu -Title "build" -Items $BuildItems
        $choice = Read-MenuChoice -Prompt "Enter option number"
        switch ($choice) {
            "1" {
                Invoke-MenuMake -Target "menu-build-all"
                Pause-Menu
            }
            "2" {
                Select-SingleItem -Title "build" -Items $BuildItems
            }
            "0" { return }
            default {
                Write-Host "Invalid option: $choice"
                Pause-Menu
            }
        }
    }
}

function Show-Preload-Submenu {
    while ($true) {
        Show-Header
        Show-Submenu -Title "preload" -Items $PreloadItems
        $choice = Read-MenuChoice -Prompt "Enter option number"
        switch ($choice) {
            "1" {
                Invoke-MenuMake -Target "menu-preload-all"
                Pause-Menu
            }
            "2" {
                Select-SingleItem -Title "preload" -Items $PreloadItems
            }
            "0" { return }
            default {
                Write-Host "Invalid option: $choice"
                Pause-Menu
            }
        }
    }
}

while ($true) {
    Show-Header
    Show-Main-Menu
    $choice = Read-MenuChoice -Prompt "Enter option number"
    switch ($choice) {
        "1" { Show-Start-Submenu }
        "2" { Show-Build-Submenu }
        "3" { Show-Preload-Submenu }
        "4" {
            Invoke-MenuMake -Target "down"
            Pause-Menu
        }
        "5" {
            Invoke-MenuMake -Target "logs"
        }
        "6" {
            Invoke-MenuMake -Target "ps"
            Pause-Menu
        }
        "0" { exit 0 }
        default {
            Write-Host "Invalid option: $choice"
            Pause-Menu
        }
    }
}
