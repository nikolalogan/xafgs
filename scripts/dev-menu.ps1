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
    Write-Host "  2) 构建并启动（默认离线，缺 wheels 直接失败）"
    Write-Host "  3) 停止开发环境"
    Write-Host "  4) 查看开发日志"
    Write-Host "  5) 查看容器状态"
    Write-Host "  6) 同步 OCR wheels"
    Write-Host "  7) 同步 Docling wheels"
    Write-Host "  8) 离线构建 OCR"
    Write-Host "  9) 离线构建 Docling"
    Write-Host "  0) 退出"
    Write-Host ""
}

function Pause-Menu {
    Write-Host ""
    Read-Host "按回车键返回菜单" | Out-Null
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
            Write-Host "无效选项: $choice"
            Pause-Menu
        }
    }
}
