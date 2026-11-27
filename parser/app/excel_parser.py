"""Parser Excel (.xlsx qua openpyxl, .xls qua xlrd)."""
from __future__ import annotations

from .base import QuoteParser
from .models import ParsedQuote
from . import table_reader as tr


class ExcelTableParser(QuoteParser):
    name = "excel"

    def can_parse(self, filename: str) -> bool:
        n = filename.lower()
        return n.endswith(".xlsx") or n.endswith(".xls")

    def parse(self, data: bytes, filename: str) -> ParsedQuote:
        grids = tr.read_grids_excel(data, filename)
        return self.parse_grids(grids)

    def parse_grids(self, grids: list[list[list[str]]]) -> ParsedQuote:
        pq = ParsedQuote()
        header_text = "\n".join(tr._sheet_text(g) for g in grids[:2])
        tr.extract_meta(header_text, pq)

        best = None  # (grid_idx, header_idx, mapping, ambiguous)
        for gi, grid in enumerate(grids):
            found = tr.find_table_header(grid)
            if found and (best is None or len(found[1]) > len(best[2])):
                best = (gi, found[0], found[1], found[2])
        if best is None:
            pq.warnings.append("Không tìm thấy bảng hàng hóa trong file Excel")
            return tr.finalize(pq)

        gi, hi, mapping, ambiguous = best
        tr.apply_header_warnings(pq, ambiguous, grids[gi][hi])
        lines, totals = tr.grid_lines(grids[gi], hi, mapping)
        pq.lines = lines
        tr.apply_totals(totals, pq)

        # Thuế suất: tìm trong toàn văn
        rate = None
        for g in grids:
            rate = tu_rate = tr.tu.extract_tax_rate(tr._sheet_text(g))
            if tu_rate is not None and tu_rate > 0:
                rate = tu_rate
                break
        if rate:
            pq.tax_rate = rate
        tr.apply_line_taxes(pq, "\n".join(tr._sheet_text(g) for g in grids))
        if len(grids) > 1:
            pq.warnings.append("File có nhiều sheet, đã chọn sheet chứa bảng hàng hóa")
        return tr.finalize(pq)


# Giữ tương thích với import cũ
__all__ = ["ExcelTableParser"]
