"""Báo giá nhiều mức VAT: thuế suất theo từng mục (vd VAT 8% mục 1; VAT 10% mục 1.1)."""
from __future__ import annotations

from app import table_reader as tr
from app.docx_parser import DocxTableParser
from app.models import ParsedQuote, QuoteLine

from test_docx_parser import build_docx

HEADER = ["TT", "THÔNG SỐ KỸ THUẬT", "Đv", "SL", "Đơn giá", "Thành tiền"]
ROWS = [
    ["1", "BƠM CHÌM", "Cái", "2", "1,000,000", "2,000,000"],
    ["", "Model: EF-05T", "", "", "", ""],
    ["1.1", "BỘ KHỚP NỐI NHANH", "Bộ", "1", "1,000,000", "1,000,000"],
    ["", "TỔNG", "", "", "", "3,000,000"],
    ["", "THUẾ VAT 8% (mục 1)", "", "", "", "160,000"],
    ["", "THUẾ VAT 10% (mục 1.1)", "", "", "", "100,000"],
    ["", "THÀNH TIỀN", "", "", "", "3,260,000"],
]
PARAS = ["Mã số thuế: 0101234567", "Tổng giá trị hợp đồng: 3,260,000 VNĐ (Đã bao gồm VAT)"]


def test_expand_items():
    assert tr._expand_items("muc 1; 2; 3; 4; 5; 6") == ["1", "2", "3", "4", "5", "6"]
    assert tr._expand_items("muc 4.1 ; 5.1") == ["4.1", "5.1"]
    assert tr._expand_items("muc 1-3") == ["1", "2", "3"]


def test_apply_line_taxes_gan_dung_muc():
    pq = ParsedQuote(lines=[
        QuoteLine(line_no=1, name="a", item_no="4"),
        QuoteLine(line_no=2, name="b", item_no="4.1"),
        QuoteLine(line_no=3, name="c", item_no=""),
    ])
    tr.apply_line_taxes(pq, "THUẾ VAT 8% (mục 1; 2; 3; 4; 5; 6)\nTHUẾ VAT 10% (mục 4.1 ; 5.1)")
    assert [l.tax_rate for l in pq.lines] == [0.08, 0.10, None]


def test_apply_line_taxes_khong_co_dong_thue_thi_giu_none():
    pq = ParsedQuote(lines=[QuoteLine(line_no=1, name="a", item_no="1")])
    tr.apply_line_taxes(pq, "Đã bao gồm 8% VAT")
    assert pq.lines[0].tax_rate is None


def test_docx_nhieu_muc_thue():
    pq = DocxTableParser().parse(build_docx(HEADER, ROWS, PARAS), "bg.docx")
    by_no = {l.item_no: l for l in pq.lines}
    assert by_no["1"].tax_rate == 0.08
    assert by_no["1.1"].tax_rate == 0.10
    assert pq.declared_vat == 260_000
    assert pq.declared_total == 3_260_000
    assert not any("lệch VAT" in w for w in pq.warnings)


def _parse_sample_doc(name):
    import os
    import pathlib

    import pytest

    from app.docx_parser import DocParser

    root = pathlib.Path(
        os.environ.get("IDLEINVOICE_SAMPLE_DIR")
        or pathlib.Path(__file__).parent.parent.parent / "sample"
    )
    path = root / name
    if not path.exists():
        pytest.skip(f"thiếu file mẫu {name}")
    return DocParser().parse(path.read_bytes(), path.name)


def test_hdmb_quang_minh_hiep_thanh_phu():
    pq = _parse_sample_doc("1. HDMB QUANG MINH-HIỆP THÀNH PHÚ.doc")
    rates = {l.item_no: l.tax_rate for l in pq.lines}
    assert rates == {
        "1": 0.08, "2": 0.10, "3": 0.10, "4": 0.10,
        "5": 0.08, "6": 0.08, "7": 0.08, "8": 0.08,
    }
    assert pq.declared_vat == 36_334_280
    assert pq.declared_total == 451_630_280
    assert not any("lệch VAT" in w for w in pq.warnings)


def test_hop_dong_vg_tv_hdc():
    pq = _parse_sample_doc("101126_QM- VG_TV-HDC.doc")
    rates = {l.item_no: l.tax_rate for l in pq.lines}
    assert rates.get("1") == 0.08
    assert rates.get("4.1") == 0.10
    assert rates.get("5.1") == 0.10
    assert pq.declared_total == 170_322_800
    assert not any("lệch VAT" in w for w in pq.warnings)


def test_apply_line_taxes_khong_co_chu_vat():
    # Hợp đồng HDMB Quang Minh - Hiệp Thành Phú: "THUẾ 8% ( MỤC 1,5,6,7,8)"
    pq = ParsedQuote(lines=[QuoteLine(line_no=i, name=str(i), item_no=str(i)) for i in range(1, 9)])
    tr.apply_line_taxes(pq, "THUẾ 8% ( MỤC 1,5,6,7,8)\nTHUẾ 10% ( MỤC 2,3,4)")
    assert [l.tax_rate for l in pq.lines] == [0.08, 0.10, 0.10, 0.10, 0.08, 0.08, 0.08, 0.08]


def test_apply_line_taxes_cac_cach_viet_khac():
    pq = ParsedQuote(lines=[QuoteLine(line_no=i, name=str(i), item_no=str(i)) for i in range(1, 4)])
    tr.apply_line_taxes(pq, "Thuế GTGT 10% (mục 2, 3)\nThuế suất 8% (STT 1)")
    assert [l.tax_rate for l in pq.lines] == [0.08, 0.10, 0.10]
