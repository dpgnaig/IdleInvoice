"""Test hồi quy parser với các báo giá mẫu trong tests/fixtures."""
from __future__ import annotations

import json
import pathlib

import pytest

from app.excel_parser import ExcelTableParser
from app.pdf_parser import PdfTableParser
from app import text_utils as tu

FIX = pathlib.Path(__file__).parent / "fixtures"

QUOTE_FILES = [
    "an_phát.xls",
    "BG-6_26-Asia.xls",
    "nguyên phát.pdf",
    "111126_QM-ARK_NA-BGM.pdf",
]


def parser_for(name: str):
    return PdfTableParser() if name.lower().endswith(".pdf") else ExcelTableParser()


def parse(name: str):
    return parser_for(name).parse((FIX / name).read_bytes(), name)


# ---------- unit test cho tiện ích ----------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("11,200,000", 11200000),
        ("11.200.000", 11200000),
        ("11 200 000", 11200000),
        ("11200000", 11200000),
        ("1.234.567", 1234567),
        ("0", 0),
        ("", None),
        ("abc", None),
    ],
)
def test_parse_money(raw, expected):
    assert tu.parse_money(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [("1,5", 1.5), ("1.5", 1.5), ("101", 101.0), ("0,25", 0.25), ("", None)],
)
def test_parse_qty(raw, expected):
    assert tu.parse_qty(raw) == expected


def test_strip_accents():
    assert tu.norm("ĐĨA PHÂN PHỐI KHÍ") == "dia phan phoi khi"


def test_extract_date_vn():
    assert tu.extract_date("Hà Nội, ngày 03 tháng 06 năm 2026") == "2026-06-03"
    assert tu.extract_date("ngày 8 tháng 2 năm 2026") == "2026-02-08"


def test_extract_model_brand_origin():
    model, brand, origin = tu.extract_model_brand_origin(
        "Hãng SX: Jaeger (Sản xuất tại Trung Quốc)\nModel: HD-270"
    )
    assert model == "HD-270"
    assert brand == "Jaeger"
    assert origin == "Trung Quốc"


def test_classify_total():
    assert tu.classify_total("Tổng chưa bao gồm VAT") == "subtotal"
    assert tu.classify_total("TỔNG") == "subtotal"
    assert tu.classify_total("THUẾ VAT 8%") == "vat"
    assert tu.classify_total("THÀNH TIỀN") == "total"
    assert tu.classify_total("Tổng Cộng") == "total"
    assert tu.classify_total("ĐĨA PHÂN PHỐI KHÍ TINH") is None


# ---------- hồi quy với file mẫu ----------


@pytest.mark.parametrize("name", QUOTE_FILES)
def test_quote_parses_to_expected(name):
    expected_path = FIX / f"{name}.expected.json"
    assert expected_path.exists(), f"thiếu file kỳ vọng {expected_path.name}"
    expected = json.loads(expected_path.read_text(encoding="utf-8"))
    result = parse(name).model_dump()
    assert result == expected


@pytest.mark.parametrize("name", QUOTE_FILES)
def test_quote_has_sane_lines(name):
    pq = parse(name)
    assert pq.lines, "phải nhận diện được ít nhất một dòng hàng"
    for line in pq.lines:
        assert line.name
        assert line.qty is None or line.qty > 0
        assert line.unit_price is None or line.unit_price > 0
        # Không dòng nào được là dòng tổng
        assert tu.classify_total(line.name) is None, f"dòng tổng bị nhận là hàng hóa: {line.name}"


def test_an_phat_values():
    pq = parse("an_phát.xls")
    assert pq.buyer_tax_code == "0110277854"
    assert pq.buyer_name.startswith("CÔNG TY TNHH THƯƠNG MẠI VÀ DỊCH VỤ")
    assert pq.quote_no == "101126/QM-AP/TV-BGC"
    assert pq.quote_date == "2026-11-10"
    assert pq.declared_subtotal == 4_955_000
    assert pq.declared_vat == 396_400
    assert pq.declared_total == 5_351_400
    assert pq.tax_rate == pytest.approx(0.08)
    assert pq.validity_days == 15
    assert len(pq.lines) == 2
    assert pq.lines[1].model == "HD340"
    assert pq.lines[1].qty == 9


def test_asia_missing_tax_code_warns():
    pq = parse("BG-6_26-Asia.xls")
    assert pq.buyer_tax_code == ""
    assert any("mã số thuế" in w for w in pq.warnings)
    assert pq.declared_subtotal == 64_500_000
    assert pq.declared_vat == 5_160_000
    assert pq.declared_total == 69_660_000


def test_nguyen_phat_multipage_lines():
    pq = parse("nguyên phát.pdf")
    # dòng hàng thứ 3 nằm ở trang 2 -> vẫn phải đọc được
    assert len(pq.lines) == 3
    assert pq.lines[2].name == "BƠM HOÁ CHẤT"
    assert pq.lines[2].qty == 8
    assert pq.lines[2].unit_price == 13_200_000
    assert pq.declared_subtotal == 145_940_000
    assert pq.declared_vat == 11_675_200
    assert pq.declared_total == 157_615_200
    assert pq.validity_days == 15
    assert pq.lines[1].origin == "Trung Quốc"


def test_ark_vat_row_not_a_line():
    pq = parse("111126_QM-ARK_NA-BGM.pdf")
    assert len(pq.lines) == 1
    assert pq.lines[0].model == "1M120P1115SVBSMV0M3-001"
    assert pq.declared_subtotal == 22_400_000
    assert pq.declared_vat == 1_792_000
    assert pq.declared_total == 24_192_000
    assert pq.payment_terms == "Chuyển khoản"


def test_spec_lines_grouped_under_product():
    pq = parse("an_phát.xls")
    # "Hãng SX / Model / thông số" phải nằm trong spec_text của dòng hàng, không thành dòng mới
    assert "Model: CBD 105" in pq.lines[0].spec_text
    assert "Đường kính đĩa" in pq.lines[1].spec_text
