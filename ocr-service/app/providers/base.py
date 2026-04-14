from __future__ import annotations

from abc import ABC, abstractmethod
from app.models import OCRResult


class OCRProvider(ABC):
    name: str

    @abstractmethod
    def is_configured(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def extract(self, content: bytes, file_name: str, mime_type: str, enable_tables: bool) -> OCRResult:
        raise NotImplementedError
