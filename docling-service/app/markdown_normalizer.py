import re


TABLE_BLOCK_RE = re.compile(r"<table[\s\S]*?</table>", flags=re.IGNORECASE)
HEADING_RE = re.compile(r"^(#{1,6})\s+\S")
UNORDERED_LIST_RE = re.compile(r"^[-*+]\s+\S")
ORDERED_LIST_RE = re.compile(r"^\d+[.)]\s+\S")


def normalize_docling_like_markdown(value: str) -> str:
    content = _normalize_line_endings(value).strip()
    if not content:
        return ""

    parts: list[str] = []
    cursor = 0
    for match in TABLE_BLOCK_RE.finditer(content):
        before = content[cursor:match.start()]
        normalized_before = _normalize_text_segment(before)
        if normalized_before:
            parts.append(normalized_before)
        table = match.group(0).strip()
        if table:
            parts.append(table)
        cursor = match.end()

    tail = _normalize_text_segment(content[cursor:])
    if tail:
        parts.append(tail)

    return "\n\n".join(part for part in parts if part).strip()


def markdown_to_plain_text(value: str) -> str:
    normalized = normalize_docling_like_markdown(value)
    if not normalized:
        return ""

    parts: list[str] = []
    cursor = 0
    for match in TABLE_BLOCK_RE.finditer(normalized):
        before = normalized[cursor:match.start()]
        before_text = _strip_markdown_block(before)
        if before_text:
            parts.append(before_text)
        table_text = _table_to_plain_text(match.group(0))
        if table_text:
            parts.append(table_text)
        cursor = match.end()

    tail = _strip_markdown_block(normalized[cursor:])
    if tail:
        parts.append(tail)

    return "\n\n".join(part for part in parts if part).strip()


def _normalize_text_segment(value: str) -> str:
    lines = [_strip_trailing_spaces(line) for line in _normalize_line_endings(value).split("\n")]
    blocks: list[str] = []
    paragraph_lines: list[str] = []
    list_lines: list[str] = []

    def flush_paragraph() -> None:
        nonlocal paragraph_lines
        if paragraph_lines:
            text = " ".join(line.strip() for line in paragraph_lines if line.strip()).strip()
            if text:
                blocks.append(text)
            paragraph_lines = []

    def flush_list() -> None:
        nonlocal list_lines
        if list_lines:
            blocks.append("\n".join(line.strip() for line in list_lines if line.strip()))
            list_lines = []

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            flush_paragraph()
            flush_list()
            continue
        if _is_heading(line):
            flush_paragraph()
            flush_list()
            blocks.append(line)
            continue
        if _is_list_item(line):
            flush_paragraph()
            list_lines.append(line)
            continue
        if list_lines:
            flush_list()
        paragraph_lines.append(line)

    flush_paragraph()
    flush_list()
    return "\n\n".join(block for block in blocks if block).strip()


def _strip_markdown_block(value: str) -> str:
    blocks: list[str] = []
    for block in re.split(r"\n{2,}", _normalize_line_endings(value).strip()):
        block = block.strip()
        if not block:
            continue
        lines: list[str] = []
        for raw_line in block.split("\n"):
            line = raw_line.strip()
            if not line:
                continue
            line = re.sub(r"^(#{1,6})\s+", "", line)
            line = re.sub(r"^[-*+]\s+", "", line)
            line = re.sub(r"^\d+[.)]\s+", "", line)
            if line:
                lines.append(line)
        if lines:
            blocks.append("\n".join(lines))
    return "\n\n".join(blocks).strip()


def _table_to_plain_text(value: str) -> str:
    text = value
    text = re.sub(r"</?(table|thead|tbody|tfoot)>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"</tr\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<tr[^>]*>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"</t[dh]\s*>", " | ", text, flags=re.IGNORECASE)
    text = re.sub(r"<t[dh][^>]*>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    rows = []
    for raw_line in text.split("\n"):
        cleaned = re.sub(r"\s*\|\s*$", "", raw_line.strip())
        cleaned = re.sub(r"\s+", " ", cleaned)
        if cleaned:
            rows.append(cleaned)
    return "\n".join(rows).strip()


def _normalize_line_endings(value: str) -> str:
    return str(value or "").replace("\r\n", "\n").replace("\r", "\n")


def _strip_trailing_spaces(value: str) -> str:
    return re.sub(r"\s+$", "", value or "")


def _is_heading(value: str) -> bool:
    return bool(HEADING_RE.match(value))


def _is_list_item(value: str) -> bool:
    return bool(UNORDERED_LIST_RE.match(value) or ORDERED_LIST_RE.match(value))
