"""Parser Word (.docx) qua python-docx: đọc đoạn văn và bảng hàng hóa.

Bảng trong Word được chuyển thành "grid" giống Excel/PDF rồi dùng chung
``table_reader`` để dò tiêu đề, dòng hàng và dòng tổng.
"""
from __future__ import annotations

import io

from docx import Document

from .base import QuoteParser
from .doc_reader import read_doc
from .models import ParsedQuote
from . import table_reader as tr


def _cell_text(text: str) -> str:
    return " ".join((text or "").split())


def read_docx(data: bytes) -> tuple[list[str], list[list[list[str]]]]:
    """Trả (các đoạn văn, các bảng dạng grid).

    Ô bị merge của python-docx trả về nội dung trùng ở nhiều vị trí. Merge
    NGANG (cùng dòng) bị blank bớt để không nhân đôi giá trị — nếu không, hai
    cột "Đơn giá" và "Thành tiền" do lỗi soạn thảo bị merge sẽ ra cùng số và
    ``unit_price`` đọc thành ``amount``. Merge DỌC (qua nhiều dòng) được lấp
    xuống để cột tên nhóm hàng không trống.
    """
    doc = Document(io.BytesIO(data))
    paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    grids: list[list[list[str]]] = []
    for table in doc.tables:
        grid: list[list[str]] = []
        prev_tc: dict[int, object] = {}  # cột -> _tc dòng trước (merge dọc)
        prev_val: dict[int, str] = {}
        for row in table.rows:
            cells: list[str] = []
            seen_row: dict[object, int] = {}  # _tc -> cột đầu tiên trong dòng
            for cidx, cell in enumerate(row.cells):
                tc = cell._tc
                val = _cell_text(cell.text)
                if tc in seen_row:
                    # merge ngang: ô lặp lại trong cùng dòng -> để trống
                    cells.append("")
                    continue
                seen_row[tc] = cidx
                if tc == prev_tc.get(cidx) and not val:
                    val = prev_val.get(cidx, "")
                cells.append(val)
                prev_tc[cidx] = tc
                if val:
                    prev_val[cidx] = val
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
        return self.parse_content(paragraphs, grids)

    def parse_content(self, paragraphs: list[str], grids: list[list[list[str]]]) -> ParsedQuote:
        """Phân tích đoạn văn + bảng đã đọc (dùng chung cho .docx và .doc)."""
        pq = ParsedQuote()

        text = "\n".join(paragraphs)
        tables_text = "\n".join(tr._sheet_text(g) for g in grids)
        full_text = "\n".join(t for t in (text, tables_text) if t)
        tr.extract_meta(full_text, pq)

        best = None  # (grid_idx, header_idx, mapping, ambiguous)
        for gi, grid in enumerate(grids):
            found = tr.find_table_header(grid)
            if found and (best is None or len(found[1]) > len(best[2])):
                best = (gi, found[0], found[1], found[2])
        if best:
            gi, hi, mapping, ambiguous = best
            tr.apply_header_warnings(pq, ambiguous, grids[gi][hi])
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

        tr.apply_line_taxes(pq, full_text)

        if not pq.lines:
            pq.warnings.append("Không trích được bảng hàng hóa từ file Word")
        return tr.finalize(pq)


def read_word(data: bytes) -> tuple[list[str], list[list[list[str]]]]:
    """Đọc file Word bất kể đuôi: .docx (zip, bắt đầu bằng PK) hoặc .doc (OLE)."""
    if data[:2] == b"PK":
        return read_docx(data)  # đặt đuôi .doc nhưng thực chất là .docx
    return read_doc(data)


class DocParser(QuoteParser):
    """File .doc cũ: đọc bằng Python thuần (doc_reader) rồi dùng chung DocxTableParser."""

    name = "doc"

    def can_parse(self, filename: str) -> bool:
        return filename.lower().endswith(".doc")

    def parse(self, data: bytes, filename: str) -> ParsedQuote:
        paragraphs, grids = read_word(data)
        return DocxTableParser().parse_content(paragraphs, grids)
