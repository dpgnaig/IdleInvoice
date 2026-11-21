"""Test API service (FastAPI) của parser: auth bằng X-Internal-Key, định dạng lỗi."""
from __future__ import annotations

import io
import pathlib

import pytest
from fastapi.testclient import TestClient

from app import main as main_module

FIX = pathlib.Path(__file__).parent / "fixtures"


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(main_module, "INTERNAL_KEY", "test-key")
    return TestClient(main_module.app)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_parse_requires_internal_key(client):
    data = (FIX / "BG-6_26-Asia.xls").read_bytes()
    r = client.post("/parse", files={"file": ("BG-6_26-Asia.xls", io.BytesIO(data))})
    assert r.status_code == 401


def test_parse_wrong_key(client):
    data = (FIX / "BG-6_26-Asia.xls").read_bytes()
    r = client.post(
        "/parse",
        files={"file": ("BG-6_26-Asia.xls", io.BytesIO(data))},
        headers={"X-Internal-Key": "sai"},
    )
    assert r.status_code == 401


def test_parse_xls_ok(client):
    data = (FIX / "BG-6_26-Asia.xls").read_bytes()
    r = client.post(
        "/parse",
        files={"file": ("BG-6_26-Asia.xls", io.BytesIO(data))},
        headers={"X-Internal-Key": "test-key"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["buyer_name"] == "CÔNG TY TNHH THƯƠNG MẠI MÔI TRƯỜNG ASIA"
    assert len(body["lines"]) == 1


def test_parse_pdf_ok(client):
    data = (FIX / "111126_QM-ARK_NA-BGM.pdf").read_bytes()
    r = client.post(
        "/parse",
        files={"file": ("quote.pdf", io.BytesIO(data))},
        headers={"X-Internal-Key": "test-key"},
    )
    assert r.status_code == 200
    assert r.json()["buyer_tax_code"] == "2400573873"


def test_unsupported_format(client):
    r = client.post(
        "/parse",
        files={"file": ("note.txt", io.BytesIO(b"hello"))},
        headers={"X-Internal-Key": "test-key"},
    )
    assert r.status_code == 422
    assert r.json()["error_code"] == "UNSUPPORTED_FORMAT"


def test_doc_legacy_bao_huong_dan(client):
    """.doc (Word 97-2003) chưa hỗ trợ -> gợi ý lưu thành .docx."""
    r = client.post(
        "/parse",
        files={"file": ("bao_gia.doc", io.BytesIO(b"\xd0\xcf\x11\xe0"))},
        headers={"X-Internal-Key": "test-key"},
    )
    assert r.status_code == 422
    assert ".docx" in r.json()["message"]


def _docx_bytes() -> bytes:
    from docx import Document

    doc = Document()
    doc.add_paragraph("Mã số thuế: 0101234567")
    table = doc.add_table(rows=1, cols=4)
    for i, h in enumerate(["STT", "Tên hàng", "SL", "Thành tiền"]):
        table.rows[0].cells[i].text = h
    row = table.add_row().cells
    for i, v in enumerate(["1", "Bơm hóa chất", "2", "20,000,000"]):
        row[i].text = v
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_parse_docx_ok(client):
    r = client.post(
        "/parse",
        files={"file": ("bg.docx", io.BytesIO(_docx_bytes()))},
        headers={"X-Internal-Key": "test-key"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["buyer_tax_code"] == "0101234567"
    assert len(body["lines"]) == 1


def test_preview_docx_tra_dong_va_bang(client):
    r = client.post(
        "/preview",
        files={"file": ("bg.docx", io.BytesIO(_docx_bytes()))},
        headers={"X-Internal-Key": "test-key"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "word"
    assert any("Mã số thuế" in p for p in body["paragraphs"])
    assert body["sheets"] and body["sheets"][0]["rows"][0][1] == "Tên hàng"


def test_preview_xlsx(client):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "BG"
    ws.append(["STT", "Tên hàng", "SL"])
    ws.append([1, "Bơm", 2])
    buf = io.BytesIO()
    wb.save(buf)

    r = client.post(
        "/preview",
        files={"file": ("bg.xlsx", io.BytesIO(buf.getvalue()))},
        headers={"X-Internal-Key": "test-key"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "excel"
    assert body["sheets"][0]["name"] == "BG"
    assert body["sheets"][0]["rows"][1] == ["1", "Bơm", "2"]


def test_empty_file(client):
    r = client.post(
        "/parse",
        files={"file": ("empty.xlsx", io.BytesIO(b""))},
        headers={"X-Internal-Key": "test-key"},
    )
    assert r.status_code == 400


def test_no_text_layer(client):
    """PDF không có text layer -> error_code NO_TEXT_LAYER."""
    import pdfplumber
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    buf = io.BytesIO()
    writer.write(buf)
    payload = buf.getvalue()
    assert pdfplumber.open(io.BytesIO(payload)).pages[0].extract_text() in (None, "")

    r = client.post(
        "/parse",
        files={"file": ("scan.pdf", io.BytesIO(payload))},
        headers={"X-Internal-Key": "test-key"},
    )
    assert r.status_code == 422
    assert r.json()["error_code"] == "NO_TEXT_LAYER"
