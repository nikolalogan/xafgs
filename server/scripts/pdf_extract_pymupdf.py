#!/usr/bin/env python3
import json
import sys

try:
    import fitz
except Exception as exc:
    print(json.dumps({"page_count": 0, "has_text": False, "pages": [], "errors": [f"import fitz failed: {exc}"]}, ensure_ascii=False))
    sys.exit(1)


def bbox_to_list(bbox):
    if bbox is None:
        return []
    try:
        return [float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])]
    except Exception:
        return []


def extract_blocks(page):
    result = []
    text_dict = page.get_text("dict")
    for block in text_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        lines = []
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            words = []
            parts = []
            for span in spans:
                text = (span.get("text") or "").strip()
                if text:
                    parts.append(text)
                    words.append({
                        "text": text,
                        "bbox": bbox_to_list(span.get("bbox")),
                    })
            line_text = "".join(parts).strip()
            if not line_text:
                continue
            lines.append({
                "bbox": bbox_to_list(line.get("bbox")),
                "text": line_text,
                "words": words,
            })
        if lines:
            result.append({
                "bbox": bbox_to_list(block.get("bbox")),
                "lines": lines,
            })
    return result


def extract_tables(page):
    result = []
    finder = page.find_tables()
    tables = getattr(finder, "tables", []) or []
    for table in tables:
        rows = table.extract() or []
        normalized_rows = []
        for row in rows:
            normalized_rows.append([(cell or "").strip() for cell in row])
        cells = []
        table_cells = getattr(table, "cells", None)
        if isinstance(table_cells, list):
            row_count = len(normalized_rows)
            col_count = max((len(row) for row in normalized_rows), default=0)
            for idx, cell_bbox in enumerate(table_cells):
                if not isinstance(cell_bbox, (list, tuple)) or len(cell_bbox) != 4 or col_count <= 0:
                    continue
                row_index = idx // col_count
                col_index = idx % col_count
                cell_text = ""
                if row_index < row_count and col_index < len(normalized_rows[row_index]):
                    cell_text = normalized_rows[row_index][col_index]
                cells.append({
                    "row_index": row_index,
                    "col_index": col_index,
                    "text": cell_text,
                    "bbox": bbox_to_list(cell_bbox),
                })
        result.append({
            "bbox": bbox_to_list(getattr(table, "bbox", None)),
            "rows": normalized_rows,
            "cells": cells,
        })
    return result


def main():
    if len(sys.argv) < 2:
      print(json.dumps({"page_count": 0, "has_text": False, "pages": [], "errors": ["missing pdf path"]}, ensure_ascii=False))
      sys.exit(1)
    pdf_path = sys.argv[1]
    doc = fitz.open(pdf_path)
    pages = []
    errors = []
    has_text = False
    for page_index in range(len(doc)):
        page = doc.load_page(page_index)
        text = (page.get_text("text") or "").strip()
        if text:
            has_text = True
        try:
            tables = extract_tables(page)
        except Exception as exc:
            tables = []
            errors.append(f"page {page_index + 1} find_tables failed: {exc}")
        pages.append({
            "page_no": page_index + 1,
            "width": float(page.rect.width),
            "height": float(page.rect.height),
            "text": text,
            "blocks": extract_blocks(page),
            "tables": tables,
        })
    print(json.dumps({
        "page_count": len(doc),
        "has_text": has_text,
        "pages": pages,
        "errors": errors,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
