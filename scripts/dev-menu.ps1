param(
    [string]$DevComposeFile = "docker-compose.dev.yml"
)

$ErrorActionPreference = "Stop"

$ServiceItems = @(
    @{ Key = "1"; Name = "全部服务"; Service = "" }
    @{ Key = "2"; Name = "frontend"; Service = "frontend" }
    @{ Key = "3"; Name = "backend"; Service = "backend" }
    @{ Key = "4"; Name = "ocr-service"; Service = "ocr-service" }
    @{ Key = "5"; Name = "docling-service"; Service = "docling-service" }
    @{ Key = "6"; Name = "vllm"; Service = "vllm" }
    @{ Key = "7"; Name = "gateway"; Service = "gateway" }
    @{ Key = "8"; Name = "postgres"; Service = "postgres" }
    @{ Key = "9"; Name = "redis"; Service = "redis" }
)

function Invoke-Compose {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Args
    )

    & docker compose -f $DevComposeFile @Args
}

function Show-Header {
    Write-Host ""
    Write-Host "项目开发菜单"
    Write-Host "当前开发编排文件: $DevComposeFile"
    Write-Host ""
}

function Show-Menu {
    Write-Host "请选择操作:"
    Write-Host "  1) 启动菜单"
    Write-Host "  2) 打包菜单"
    Write-Host "  3) 停止开发环境"
    Write-Host "  4) 查看开发日志"
    Write-Host "  5) 查看容器状态"
    Write-Host "  6) 同步 OCR wheels"
    Write-Host "  7) 同步 Docling wheels"
    Write-Host "  0) 退出"
    Write-Host ""
}

function Show-Start-Menu {
    Write-Host "请选择启动操作:"
    foreach ($item in $ServiceItems) {
        Write-Host ("  {0}) 启动 {1}" -f $item.Key, $item.Name)
    }
    Write-Host "  0) 返回上级"
    Write-Host ""
}

function Show-Build-Menu {
    Write-Host "请选择打包操作:"
    Write-Host "  1) 打包所有"
    Write-Host "  2) 打包并启动"
    Write-Host "  3) 单独打包 OCR"
    Write-Host "  4) 单独打包 Docling"
    Write-Host "  0) 返回上级"
    Write-Host ""
}

function Pause-Menu {
    Write-Host ""
    Read-Host "按回车键返回菜单" | Out-Null
}

function Restart-All-Services {
    Invoke-Compose down
    Invoke-Compose up -d
}

function Restart-Single-Service {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Service
    )

    Invoke-Compose stop $Service
    Invoke-Compose rm -f $Service
    Invoke-Compose up -d $Service
}

function Invoke-Build-All {
    New-Item -ItemType Directory -Force -Path ocr-service/model_cache | Out-Null
    New-Item -ItemType Directory -Force -Path docling-service/model_cache | Out-Null
    & bash ocr-service/scripts/verify_wheels.sh
    $env:OCR_WHEELS_ONLY = "1"
    $env:DOCLING_WHEELS_ONLY = "1"
    try {
        Invoke-Compose build
    }
    finally {
        Remove-Item Env:OCR_WHEELS_ONLY -ErrorAction SilentlyContinue
        Remove-Item Env:DOCLING_WHEELS_ONLY -ErrorAction SilentlyContinue
    }
}

function Invoke-Build-Up {
    New-Item -ItemType Directory -Force -Path ocr-service/model_cache | Out-Null
    New-Item -ItemType Directory -Force -Path docling-service/model_cache | Out-Null
    & bash ocr-service/scripts/verify_wheels.sh
    $env:OCR_WHEELS_ONLY = "1"
    $env:DOCLING_WHEELS_ONLY = "1"
    try {
        Invoke-Compose up --build -d
    }
    finally {
        Remove-Item Env:OCR_WHEELS_ONLY -ErrorAction SilentlyContinue
        Remove-Item Env:DOCLING_WHEELS_ONLY -ErrorAction SilentlyContinue
    }
}

function Show-Build-Submenu {
    while ($true) {
        Show-Header
        Show-Build-Menu
        $buildChoice = (Read-Host "输入打包选项编号").Trim()

        switch ($buildChoice) {
            "1" {
                Invoke-Build-All
                Pause-Menu
            }
            "2" {
                Invoke-Build-Up
            }
            "3" {
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
            "4" {
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
                return
            }
            default {
                Write-Host "无效选项: $buildChoice"
                Pause-Menu
            }
        }
    }
}

function Show-Start-Submenu {
    while ($true) {
        Show-Header
        Show-Start-Menu
        $startChoice = (Read-Host "输入启动选项编号").Trim()

        if ($startChoice -eq "0") {
            return
        }

        $selectedItem = $ServiceItems | Where-Object { $_.Key -eq $startChoice } | Select-Object -First 1
        if ($null -eq $selectedItem) {
            Write-Host "无效选项: $startChoice"
            Pause-Menu
            continue
        }

        if ([string]::IsNullOrWhiteSpace($selectedItem.Service)) {
            Restart-All-Services
        }
        else {
            Restart-Single-Service -Service $selectedItem.Service
        }
    }
}

while ($true) {
    Show-Header
    Show-Menu
    $choice = (Read-Host "输入选项编号").Trim()

    switch ($choice) {
        "1" {
            Show-Start-Submenu
        }
        "2" {
            Show-Build-Submenu
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
        "0" {
            exit 0
        }
        default {
            Write-Host "无效选项: $choice"
            Pause-Menu
        }
    }
}
