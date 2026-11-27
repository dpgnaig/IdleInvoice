"""Test cho app.converter: .xls -> .xlsx và .doc -> .docx (phục vụ trình xem trên trình duyệt)."""
from __future__ import annotations

import io
import pathlib

from docx import Document
from openpyxl import load_workbook

from app import converter
from app import table_reader as tr

FIX = pathlib.Path(__file__).parent / "fixtures"


def test_xls_to_xlsx_keeps_sheets_and_values():
    data = (FIX / "BG-6_26-Asia.xls").read_bytes()
    out = converter.xls_to_xlsx(data)
    assert out[:2] == b"PK"
    expected = tr.read_sheets_excel(data, "a.xls")
    got = tr.read_sheets_excel(out, "a.xlsx")
    assert [n for n, _ in got] == [n for n, _ in expected]
    diffs = []
    for (name, e), (_, g) in zip(expected, got):
        if len(e) != len(g):
            diffs.append(f"{name}: rows {len(e)} != {len(g)}")
        for i, (re_, rg) in enumerate(zip(e, g)):
            for j in range(max(len(re_), len(rg))):
                a = re_[j] if j < len(re_) else None
                b = rg[j] if j < len(rg) else None
                if a != b:
                    diffs.append(f"{name} r{i} c{j}: {a!r} != {b!r}")
    assert not diffs, "\n".join(diffs[:15]) + f"\n(total {len(diffs)})"



def test_xls_to_xlsx_keeps_merged_cells():
    import xlrd

    data = (FIX / "BG-6_26-Asia.xls").read_bytes()
    book = xlrd.open_workbook(file_contents=data, formatting_info=True)
    wb = load_workbook(io.BytesIO(converter.xls_to_xlsx(data)))
    for sh, ws in zip(book.sheets(), wb.worksheets):
        assert len(ws.merged_cells.ranges) == len(sh.merged_cells)


def test_xls_named_but_actually_xlsx_is_passed_through():
    data = b"PK\x03\x04rest"
    assert converter.xls_to_xlsx(data) == data


def test_doc_to_docx_writes_paragraphs_and_tables(monkeypatch):
    monkeypatch.setattr(
        converter,
        "read_doc",
        lambda _data: (["BÁO GIÁ số 01", "Kính gửi: Công ty A"], [[["STT", "Tên hàng"], ["1", "Máy bơm"]]]),
    )
    out = converter.doc_to_docx(b"\xd0\xcf\x11\xe0fake")
    doc = Document(io.BytesIO(out))
    texts = [p.text for p in doc.paragraphs if p.text]
    assert texts == ["BÁO GIÁ số 01", "Kính gửi: Công ty A"]
    assert len(doc.tables) == 1
    assert [c.text for c in doc.tables[0].rows[1].cells] == ["1", "Máy bơm"]


def test_doc_named_but_actually_docx_is_passed_through():
    data = b"PK\x03\x04rest"
    assert converter.doc_to_docx(data) == data
