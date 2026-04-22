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
    Write-Host "项目开发菜单"
    Write-Host "当前开发编排文件: $DevComposeFile"
    Write-Host ""
}

function Show-Menu {
    Write-Host "请选择操作:"
    Write-Host "  1) 开发启动"
    Write-Host "  2) 打包菜单"
    Write-Host "  3) 停止开发环境"
    Write-Host "  4) 查看开发日志"
    Write-Host "  5) 查看容器状态"
    Write-Host "  6) 同步 OCR wheels"
    Write-Host "  7) 同步 Docling wheels"
    Write-Host "  0) 退出"
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
        Invoke-Compose up --build
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

while ($true) {
    Show-Header
    Show-Menu
    $choice = (Read-Host "输入选项编号").Trim()

    switch ($choice) {
        "1" {
            Invoke-Compose up
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
