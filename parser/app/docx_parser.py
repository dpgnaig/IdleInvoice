"""Parser Word (.docx) qua python-docx: đọc đoạn văn và bảng hàng hóa.

Bảng trong Word được chuyển thành "grid" giống Excel/PDF rồi dùng chung
``table_reader`` để dò tiêu đề, dòng hàng và dòng tổng.
"""
from __future__ import annotations

import io

from docx import Document

from .base import QuoteParser
from .models import ParsedQuote
from . import table_reader as tr


def _cell_text(text: str) -> str:
    return " ".join((text or "").split())


def read_docx(data: bytes) -> tuple[list[str], list[list[list[str]]]]:
    """Trả (các đoạn văn, các bảng dạng grid)."""
    doc = Document(io.BytesIO(data))
    paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    grids: list[list[list[str]]] = []
    for table in doc.tables:
        grid: list[list[str]] = []
        for row in table.rows:
            cells = [_cell_text(cell.text) for cell in row.cells]
            if any(cells):
                grid.append(cells)
        if grid:
            grids.append(grid)
    return paragraphs, grids


class DocxTableParser(QuoteParser):
    name = "docx"

    def can_parse(self, filename: str) -> bool:
        return filename.lower().endswith(".docx")

    def parse(self, data: bytes, filename: str) -> ParsedQuote:
        paragraphs, grids = read_docx(data)
        pq = ParsedQuote()

        text = "\n".join(paragraphs)
        tables_text = "\n".join(tr._sheet_text(g) for g in grids)
        full_text = "\n".join(t for t in (text, tables_text) if t)
        tr.extract_meta(full_text, pq)

        best = None
        for gi, grid in enumerate(grids):
            found = tr.find_table_header(grid)
            if found and (best is None or len(found[1]) > len(best[2])):
                best = (gi, found[0], found[1])
        if best:
            gi, hi, mapping = best
            pq.lines, totals = tr.grid_lines(grids[gi], hi, mapping)
            tr.apply_totals(totals, pq)

        # Bảng không có header rõ ràng / bảng trải qua nhiều bảng Word -> đọc từ text.
        # Dòng trùng giữa bảng và text được lọc ở finalize().
        text_lines, text_totals = tr.lines_from_text(text)
        for l in text_lines:
            pq.lines.append(l)
        if text_totals:
            for kind, value in text_totals:
                if kind == "subtotal" and pq.declared_subtotal is None:
                    pq.declared_subtotal = value
                elif kind == "vat" and pq.declared_vat is None:
                    pq.declared_vat = value
                elif kind == "total" and pq.declared_total is None:
                    pq.declared_total = value

        rate = tr.tu.extract_tax_rate(full_text)
        if rate is not None and rate > 0:
            pq.tax_rate = rate

        if not pq.lines:
            pq.warnings.append("Không trích được bảng hàng hóa từ file Word")
        return tr.finalize(pq)
