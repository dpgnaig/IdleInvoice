"""Test parser Word và xem trước Excel/Word.

Dựng file .docx tại chỗ bằng python-docx thay vì commit dữ liệu khách hàng
thật vào repo.
"""
from __future__ import annotations

import io

import pytest
from docx import Document

from app.docx_parser import DocxTableParser


def build_docx(header: list[str] | None = None, rows: list[list[str]] | None = None,
               paragraphs: list[str] | None = None) -> bytes:
    doc = Document()
    for p in paragraphs or []:
        doc.add_paragraph(p)
    table = doc.add_table(rows=1, cols=len(header or []))
    if header:
        for i, h in enumerate(header):
            table.rows[0].cells[i].text = h
    for row in rows or []:
        cells = table.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = v
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


DOC_HEADER = ["STT", "Tên hàng hóa", "Hãng", "Model", "ĐVT", "SL", "Đơn giá", "Thành tiền"]
DOC_ROWS = [
    ["1", "Máy bơm hóa chất", "Jaeger", "HD-270", "Cái", "8", "13,200,000", "105,600,000"],
    ["2", "Đĩa phân phối khí", "Jaeger", "HD-330", "Bộ", "2", "5,000,000", "10,000,000"],
]
DOC_PARAS = [
    "CÔNG TY TNHH ABC VIỆT NAM",
    "Mã số thuế: 0101234567",
    "Số báo giá: BG-2026-001",
    "Ngày 10 tháng 11 năm 2026",
    "Tổng chưa bao gồm VAT: 115,600,000",
    "Thuế VAT 8%: 9,248,000",
    "Tổng thanh toán: 124,848,000",
]


def test_docx_can_parse():
    p = DocxTableParser()
    assert p.can_parse("bao_gia.docx")
    assert p.can_parse("BAO_GIA.DOCX")
    assert not p.can_parse("bao_gia.doc")


def test_docx_doc_thong_tin_chung():
    pq = DocxTableParser().parse(build_docx(DOC_HEADER, DOC_ROWS, DOC_PARAS), "bg.docx")
    assert pq.buyer_tax_code == "0101234567"
    assert pq.quote_no == "BG-2026-001"
    assert pq.quote_date == "2026-11-10"
    assert pq.tax_rate == pytest.approx(0.08)


def test_docx_tach_cot_hang_model_xuat_xu():
    pq = DocxTableParser().parse(build_docx(DOC_HEADER, DOC_ROWS, DOC_PARAS), "bg.docx")
    assert len(pq.lines) == 2
    first = pq.lines[0]
    assert first.name == "Máy bơm hóa chất"
    assert first.brand == "Jaeger"
    assert first.model == "HD-270"
    assert first.unit == "Cái"
    assert first.qty == 8
    assert first.unit_price == 13_200_000
    assert first.amount == 105_600_000


def test_docx_dong_tong_khong_bi_coi_la_hang():
    pq = DocxTableParser().parse(build_docx(DOC_HEADER, DOC_ROWS, DOC_PARAS), "bg.docx")
    assert pq.declared_subtotal == 115_600_000
    assert pq.declared_vat == 9_248_000
    assert pq.declared_total == 124_848_000
    assert all("Tổng" not in l.name for l in pq.lines)


def test_docx_mo_ta_gop_vao_dong_hang():
    """Dòng mô tả không có SL/giá nằm dưới một dòng hàng phải vào spec_text."""
    doc = Document()
    table = doc.add_table(rows=1, cols=6)
    for i, h in enumerate(["STT", "Thông số kỹ thuật", "ĐVT", "SL", "Đơn giá", "Thành tiền"]):
        table.rows[0].cells[i].text = h
    cells = table.add_row().cells
    for i, v in enumerate(["1", "BƠM HOÁ CHẤT", "Cái", "2", "10,000,000", "20,000,000"]):
        cells[i].text = v
    for text in ["Hãng SX: OBL - Ý", "Model: 1M50P1155", "- Lưu lượng: 100 lít/h"]:
        row = table.add_row().cells
        row[1].text = text
    buf = io.BytesIO()
    doc.save(buf)

    pq = DocxTableParser().parse(buf.getvalue(), "bg.docx")
    assert len(pq.lines) == 1
    line = pq.lines[0]
    assert line.model == "1M50P1155"
    assert line.brand.startswith("OBL")
    assert "Lưu lượng" in line.spec_text


def test_docx_dem_dung_so_dong_khi_bang_va_text_trung_nhau():
    """Bảng có đường kẻ + dòng text cùng nội dung không được nhân đôi."""
    pq = DocxTableParser().parse(build_docx(DOC_HEADER, DOC_ROWS, DOC_PARAS), "bg.docx")
    assert len(pq.lines) == 2
