import re


def clean_markdown_ocr_output(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    fence_match = re.match(r"^```(?:markdown|md)?\s*([\s\S]*?)\s*```$", text, flags=re.IGNORECASE)
    if fence_match:
        text = fence_match.group(1).strip()
    return text.strip()
