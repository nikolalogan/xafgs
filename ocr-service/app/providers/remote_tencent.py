from __future__ import annotations

import os
from app.models import OCRResult
from app.providers.base import OCRProvider


class RemoteTencentOCRProvider(OCRProvider):
    name = "remote_tencent_ocr"

    def is_configured(self) -> bool:
        secret_id = os.getenv("TENCENT_OCR_SECRET_ID", "").strip()
        secret_key = os.getenv("TENCENT_OCR_SECRET_KEY", "").strip()
        return bool(secret_id and secret_key)

    def extract(self, content: bytes, file_name: str, mime_type: str, enable_tables: bool) -> OCRResult:
        # 预留真实腾讯云 OCR 接入口：
        # 1. 选择表格识别/通用文字识别接口
        # 2. 按页或按图片调用
        # 3. 结果标准化为统一 OCRResult
        if not self.is_configured():
            raise RuntimeError("remote_tencent_ocr is not configured")
        raise RuntimeError("Tencent OCR runtime is not wired yet")
