"""Test hồi quy parser với các báo giá mẫu trong tests/fixtures."""
from __future__ import annotations

import json
import pathlib

import pytest

from app.excel_parser import ExcelTableParser
from app.docx_parser import DocxTableParser
from app.pdf_parser import PdfTableParser
from app import text_utils as tu

FIX = pathlib.Path(__file__).parent / "fixtures"
# File mẫu đầy đủ nằm ở thư mục sample/ của repo (dùng kiểm thử thủ công).
SAMPLE = FIX.parent.parent.parent / "sample"


def sample(name: str) -> pathlib.Path:
    return SAMPLE / name


# Fixture nhỏ đã commit (dùng cho hồi quy chính xác từng trường)
QUOTE_FILES = [
    "BG-6_26-Asia.xls",
    "111126_QM-ARK_NA-BGM.pdf",
]


def parser_for(name: str):
    n = name.lower()
    if n.endswith(".pdf"):
        return PdfTableParser()
    if n.endswith(".docx"):
        return DocxTableParser()
    return ExcelTableParser()


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


def test_extract_date_uu_tien_hom_nay():
    """Hợp đồng có nhiều ngày (căn cứ luật) -> lấy ngày lập ở dòng "Hôm nay"."""
    text = (
        "Căn cứ Bộ luật Dân sự số 91/2015/QH13 ngày 24 tháng 11 năm 2015 của Quốc hội\n"
        "Hôm nay, ngày 17   tháng  11  năm 2026. Chúng tôi gồm:"
    )
    assert tu.extract_date(text) == "2026-11-17"


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


@pytest.mark.parametrize(
    "label",
    [
        "Vật liệu",  # "vật" bị bỏ dấu thành "vat"
        "Vật tư",
        "Mã số thuế: 0101234567",
        "- Đường kính tổng cộng: 268 mm",
    ],
)
def test_classify_total_khong_nham_dong_khac(label):
    assert tu.classify_total(label) is None


def test_classify_total_bao_gom_vat_la_tong_thanh_toan():
    assert tu.classify_total("Tổng giá trị đã bao gồm VAT 15,789,600") == "total"


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


def test_ark_vat_row_not_a_line():
    pq = parse("111126_QM-ARK_NA-BGM.pdf")
    assert len(pq.lines) == 1
    assert pq.lines[0].model == "1M120P1115SVBSMV0M3-001"
    assert pq.declared_subtotal == 22_400_000
    assert pq.declared_vat == 1_792_000
    assert pq.declared_total == 24_192_000
    assert pq.payment_terms == "Chuyển khoản"


def test_spec_lines_grouped_under_product():
    pq = parse("111126_QM-ARK_NA-BGM.pdf")
    # "Hãng SX / Model / thông số" phải nằm trong spec_text của dòng hàng, không thành dòng mới
    assert "Model: 1M120P1115SVBSMV0M3-001" in pq.lines[0].spec_text
    assert "Lưu lượng" in pq.lines[0].spec_text
    assert len(pq.lines) == 1


# ---------- file mẫu thật trong sample/ (bỏ qua khi không có) ----------

pytestmark_sample = pytest.mark.skipif(not SAMPLE.exists(), reason="không có thư mục sample/")


@pytestmark_sample
@pytest.mark.parametrize(
    "name",
    [
        "061126_QM-CDM_XT-BGC.pdf",
        "121126_QM-CNQN_NA-BGE.pdf",
        "191126_QM-ML_TT-BGM.pdf",
        "181126_QM-CNX_NA-BGC.pdf",
        "hồ hoàng anh.pdf",
        "BG-6_26-Asia.xls",
        "HTN.xls",
        "HTN11.xls",
        "171126_QM-SEEN_HT-BGC.xlsx",
        "181126_QM-VSUD_TP-BGC.xlsx",
        "171126_QM-NDT_TT- HDC.docx",
    ],
)
def test_sample_tong_dong_hang_khop_voi_tong_khai_bao(name):
    """Các dòng hàng cộng lại phải bằng tổng trước VAT ghi trên file."""
    p = parser_for(name)
    pq = p.parse((SAMPLE / name).read_bytes(), name)
    assert pq.lines, f"{name}: không đọc được dòng hàng nào"
    calc = sum((l.qty or 0) * (l.unit_price or 0) for l in pq.lines)
    if pq.declared_subtotal is not None:
        assert abs(calc - pq.declared_subtotal) <= max(1000, pq.declared_subtotal * 0.005), (
            f"{name}: cộng dòng hàng {calc:,.0f} lệch tổng {pq.declared_subtotal:,.0f}"
        )
    # VAT không bao giờ nhỏ hơn 1000đ hay lớn hơn nửa tổng — chặn lỗi đọc "%" thành tiền
    if pq.declared_vat is not None:
        assert 1000 <= pq.declared_vat <= calc * 0.5, f"{name}: VAT vô lý {pq.declared_vat}"


@pytestmark_sample
@pytest.mark.parametrize(
    "name",
    [
        "061126_QM-CDM_XT-BGC.pdf",
        "BG THIETBI - VIETENVI - 01.pdf",
        "BG THIETBI - VIETENVI - 02.pdf",
    ],
)
def test_sample_pdf_khong_nhan_doi_dong(name):
    """PDF vừa có bảng vừa có text: mỗi dòng hàng chỉ xuất hiện một lần."""
    pq = PdfTableParser().parse((SAMPLE / name).read_bytes(), name)
    keys = [(l.name.split("\n")[0].strip().lower(), l.qty, l.unit_price) for l in pq.lines]
    assert len(keys) == len(set(keys)), f"{name}: có dòng bị lặp {keys}"


@pytestmark_sample
def test_sample_docx_tach_duoc_thong_so_ky_thuat():
    """Word: cột Hãng/Model và các dòng mô tả phải vào đúng dòng hàng."""
    pq = DocxTableParser().parse(
        (SAMPLE / "1. 260630_SEEN-QM_OBL Jaeger-Ký.docx").read_bytes(),
        "bg.docx",
    )
    assert pq.lines
    first = pq.lines[0]
    assert first.brand.startswith("OBL")
    assert first.model.startswith("1R50A3070")
    assert "Lưu lượng" in first.spec_text


@pytestmark_sample
def test_sample_docx_lay_ngay_lap_hop_dong():
    """Hợp đồng trích 3 luật có 3 ngày khác nhau -> phải lấy ngày "Hôm nay"."""
    pq = DocxTableParser().parse(
        (SAMPLE / "171126_QM-NDT_TT- HDC.docx").read_bytes(),
        "bg.docx",
    )
    assert pq.quote_date == "2026-11-17"
    assert pq.buyer_tax_code == "0401557479"
