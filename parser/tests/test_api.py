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
    data = (FIX / "an_phát.xls").read_bytes()
    r = client.post("/parse", files={"file": ("an_phát.xls", io.BytesIO(data))})
    assert r.status_code == 401


def test_parse_wrong_key(client):
    data = (FIX / "an_phát.xls").read_bytes()
    r = client.post(
        "/parse",
        files={"file": ("an_phát.xls", io.BytesIO(data))},
        headers={"X-Internal-Key": "sai"},
    )
    assert r.status_code == 401


def test_parse_xls_ok(client):
    data = (FIX / "an_phát.xls").read_bytes()
    r = client.post(
        "/parse",
        files={"file": ("an_phát.xls", io.BytesIO(data))},
        headers={"X-Internal-Key": "test-key"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["buyer_tax_code"] == "0110277854"
    assert len(body["lines"]) == 2


def test_parse_pdf_ok(client):
    data = (FIX / "nguyên phát.pdf").read_bytes()
    r = client.post(
        "/parse",
        files={"file": ("quote.pdf", io.BytesIO(data))},
        headers={"X-Internal-Key": "test-key"},
    )
    assert r.status_code == 200
    assert len(r.json()["lines"]) == 3


def test_unsupported_format(client):
    r = client.post(
        "/parse",
        files={"file": ("note.txt", io.BytesIO(b"hello"))},
        headers={"X-Internal-Key": "test-key"},
    )
    assert r.status_code == 422
    assert r.json()["error_code"] == "UNSUPPORTED_FORMAT"


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

    # Tạo PDF trắng (1 trang, không có chữ) bằng pdfplumber dùng lại file mẫu rồi xoá chữ không khả thi,
    # nên dựng tối thiểu bằng PDFKit-free: tạo trang trống bằng pypdf nếu có.
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
