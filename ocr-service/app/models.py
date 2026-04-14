from __future__ import annotations

from pydantic import BaseModel, Field
from typing import List, Optional


class OCRTaskCreateRequest(BaseModel):
    fileId: int
    versionNo: int
    fileName: str
    mimeType: str
    providerMode: str = "auto"
    enableTables: bool = True
    contentBase64: str


class OCRLine(BaseModel):
    lineNo: int
    bbox: List[float] = Field(default_factory=list)
    text: str = ""


class OCRBlock(BaseModel):
    blockNo: int
    bbox: List[float] = Field(default_factory=list)
    text: str = ""
    lines: List[OCRLine] = Field(default_factory=list)


class OCRCell(BaseModel):
    rowIndex: int
    colIndex: int
    rowSpan: int = 1
    colSpan: int = 1
    text: str = ""
    bbox: List[float] = Field(default_factory=list)
    confidence: float = 0.0


class OCRTable(BaseModel):
    tableNo: int
    bbox: List[float] = Field(default_factory=list)
    headerRowCount: int = 0
    rows: List[List[str]] = Field(default_factory=list)
    cells: List[OCRCell] = Field(default_factory=list)


class OCRPage(BaseModel):
    pageNo: int
    width: float = 0.0
    height: float = 0.0
    text: str = ""
    blocks: List[OCRBlock] = Field(default_factory=list)
    tables: List[OCRTable] = Field(default_factory=list)


class OCRResult(BaseModel):
    provider: str = ""
    pageCount: int = 0
    confidence: float = 0.0
    language: str = "zh"
    pages: List[OCRPage] = Field(default_factory=list)


class OCRTaskView(BaseModel):
    taskId: str
    status: str
    provider: str = ""
    progress: int = 0
    pageCount: int = 0
    confidence: float = 0.0
    errorCode: str = ""
    errorMessage: str = ""
    result: Optional[OCRResult] = None
