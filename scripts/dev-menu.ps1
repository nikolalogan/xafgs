param(
    [string]$DevComposeFile = "docker-compose.dev.yml"
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

$StartItems = @(
    @{ Name = "frontend"; Target = "menu-start-frontend" }
    @{ Name = "backend"; Target = "menu-start-backend" }
    @{ Name = "gateway"; Target = "menu-start-gateway" }
    @{ Name = "postgres"; Target = "menu-start-postgres" }
    @{ Name = "redis"; Target = "menu-start-redis" }
)

$BuildItems = @(
    @{ Name = "frontend"; Target = "menu-build-frontend" }
    @{ Name = "backend"; Target = "menu-build-backend" }
    @{ Name = "gateway"; Target = "menu-build-gateway" }
    @{ Name = "postgres"; Target = "menu-build-postgres" }
    @{ Name = "redis"; Target = "menu-build-redis" }
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
    Write-Host "请选择操作:"
    Write-Host "  1) 启动"
    Write-Host "  2) 打包"
    Write-Host "  3) 停止"
    Write-Host "  4) 日志"
    Write-Host "  5) 状态"
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
    $choice = Read-MenuChoice -Prompt "输入选项编号"
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
        $choice = Read-MenuChoice -Prompt "输入选项编号"
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
        $choice = Read-MenuChoice -Prompt "输入选项编号"
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

while ($true) {
    Show-Header
    Show-Main-Menu
    $choice = Read-MenuChoice -Prompt "输入选项编号"
    switch ($choice) {
        "1" { Show-Start-Submenu }
        "2" { Show-Build-Submenu }
        "3" {
            Invoke-MenuMake -Target "down"
            Pause-Menu
        }
        "4" {
            Invoke-MenuMake -Target "logs"
        }
        "5" {
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

