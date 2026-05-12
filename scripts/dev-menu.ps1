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
    Write-Host "项目开发菜单"
    Write-Host "当前开发编排文件: $DevComposeFile"
    Write-Host ""
}

function Pause-Menu {
    Write-Host ""
    Read-Host "按回车键返回菜单" | Out-Null
}

function Show-Main-Menu {
    Write-Host "请选择操作:"
    Write-Host "  1) 启动"
    Write-Host "  2) 打包"
    Write-Host "  3) 预加载"
    Write-Host "  4) 停止"
    Write-Host "  5) 日志"
    Write-Host "  6) 状态"
    Write-Host "  0) 退出"
    Write-Host ""
}

function Show-Submenu {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,
        [Parameter(Mandatory = $true)]
        [array]$Items
    )
    Write-Host ("请选择{0}操作:" -f $Title)
    Write-Host "  1) 全部"
    Write-Host "  2) 单个"
    Write-Host "  0) 返回上级"
    Write-Host ""
    Write-Host ("{0}可选项:" -f $Title)
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
    Write-Host ("请选择单个{0}项:" -f $Title)
    for ($i = 0; $i -lt $Items.Count; $i++) {
        Write-Host ("  {0}) {1}" -f ($i + 1), $Items[$i].Name)
    }
    Write-Host "  0) 返回上级"
    Write-Host ""
    $choice = (Read-Host "输入选项编号").Trim()
    if ($choice -eq "0") {
        return
    }
    if ($choice -notmatch '^\d+$') {
        Write-Host "无效选项: $choice"
        Pause-Menu
        return
    }
    $index = [int]$choice
    if ($index -lt 1 -or $index -gt $Items.Count) {
        Write-Host "无效选项: $choice"
        Pause-Menu
        return
    }
    Invoke-MenuMake -Target $Items[$index - 1].Target
    Pause-Menu
}

function Show-Start-Submenu {
    while ($true) {
        Show-Header
        Show-Submenu -Title "启动" -Items $StartItems
        $choice = (Read-Host "输入选项编号").Trim()
        switch ($choice) {
            "1" {
                Invoke-MenuMake -Target "menu-start-all"
                Pause-Menu
            }
            "2" {
                Select-SingleItem -Title "启动" -Items $StartItems
            }
            "0" { return }
            default {
                Write-Host "无效选项: $choice"
                Pause-Menu
            }
        }
    }
}

function Show-Build-Submenu {
    while ($true) {
        Show-Header
        Show-Submenu -Title "打包" -Items $BuildItems
        $choice = (Read-Host "输入选项编号").Trim()
        switch ($choice) {
            "1" {
                Invoke-MenuMake -Target "menu-build-all"
                Pause-Menu
            }
            "2" {
                Select-SingleItem -Title "打包" -Items $BuildItems
            }
            "0" { return }
            default {
                Write-Host "无效选项: $choice"
                Pause-Menu
            }
        }
    }
}

function Show-Preload-Submenu {
    while ($true) {
        Show-Header
        Show-Submenu -Title "预加载" -Items $PreloadItems
        $choice = (Read-Host "输入选项编号").Trim()
        switch ($choice) {
            "1" {
                Invoke-MenuMake -Target "menu-preload-all"
                Pause-Menu
            }
            "2" {
                Select-SingleItem -Title "预加载" -Items $PreloadItems
            }
            "0" { return }
            default {
                Write-Host "无效选项: $choice"
                Pause-Menu
            }
        }
    }
}

while ($true) {
    Show-Header
    Show-Main-Menu
    $choice = (Read-Host "输入选项编号").Trim()
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
            Write-Host "无效选项: $choice"
            Pause-Menu
        }
    }
}
