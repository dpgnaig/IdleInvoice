"""Parser PDF dùng pdfplumber (PDF có text layer)."""
from __future__ import annotations

import io

import pdfplumber

from .base import QuoteParser
from .models import ParsedQuote
from . import table_reader as tr


class PdfTableParser(QuoteParser):
    name = "pdf"

    def can_parse(self, filename: str) -> bool:
        return filename.lower().endswith(".pdf")

    def parse(self, data: bytes, filename: str) -> ParsedQuote:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            full_text = ""
            grids: list[list[list[str]]] = []
            for page in pdf.pages:
                full_text += (page.extract_text() or "") + "\n"
                for table in page.extract_tables() or []:
                    grid = [[(c or "").strip() for c in row] for row in table]
                    grid = [r for r in grid if any(r)]
                    if grid:
                        grids.append(grid)

        stripped = full_text.strip()
        if len(stripped) < 40:
            pq = ParsedQuote()
            pq.warnings.append("NO_TEXT_LAYER")
            return pq

        pq = ParsedQuote()
        tr.extract_meta(full_text, pq)

        if grids:
            best = None
            for gi, grid in enumerate(grids):
                found = tr.find_table_header(grid)
                if found and (best is None or len(found[1]) > len(best[2])):
                    best = (gi, found[0], found[1])
            if best:
                gi, hi, mapping = best
                pq.lines, totals = tr.grid_lines(grids[gi], hi, mapping)
                tr.apply_totals(totals, pq)

        # Trang không có bảng (vd bảng tiếp sang trang 2) -> đọc dòng hàng từ text
        text_lines, text_totals = tr.lines_from_text(full_text, pq.lines)
        if text_lines:
            # Trùng lặp do đọc cả bảng lẫn text được lọc một lần ở finalize()
            for l in text_lines:
                l.line_no = len(pq.lines) + 1
                pq.lines.append(l)
        # Bổ sung các dòng tổng còn thiếu từ văn bản (vd bảng tiếp sang trang sau)
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
            pq.warnings.append("Không trích được bảng hàng hóa từ PDF")
        return tr.finalize(pq)
