"""Test hồi quy parser với các báo giá mẫu trong tests/fixtures."""
from __future__ import annotations

import io
import json
import pathlib

import pytest

from app.excel_parser import ExcelTableParser
from app.docx_parser import DocxTableParser
from app.pdf_parser import PdfTableParser
from app.models import ParsedQuote, QuoteLine
from app import table_reader as tr
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
        "-   Tổng độ dài ống: 1145mm",  # dòng thông số, không phải dòng tổng tiền
        "Tổng khối lượng: 1,145 kg",
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


# ---------- validate chéo SL × đơn giá = thành tiền ----------


def test_reconcile_lệch_giá_hạ_confidence_va_canh_bao():
    pq = ParsedQuote(
        lines=[
            QuoteLine(
                line_no=1, name="Bơm hoá chất", qty=2, unit_price=5_000_000,
                amount=20_000_000, confidence="high",
            )
        ]
    )
    tr.finalize(pq)
    line = pq.lines[0]
    assert line.confidence == "low"
    assert any("lệch thành tiền" in w for w in pq.warnings)
    # Giữ nguyên số đọc được, chỉ cảnh báo + gợi ý đơn giá đúng
    assert line.unit_price == 5_000_000
    assert any("10,000,000" in w for w in pq.warnings)


def test_reconcile_khop_thi_giu_nguyen_confidence():
    pq = ParsedQuote(
        lines=[
            QuoteLine(
                line_no=1, name="Đĩa", qty=3, unit_price=1_000_000,
                amount=3_000_000, confidence="high",
            ),
            QuoteLine(
                line_no=2, name="Van", qty=2, unit_price=500_000,
                amount=1_000_000, confidence="medium",
            ),
        ]
    )
    tr.finalize(pq)
    assert pq.lines[0].confidence == "high"
    # Dòng đọc từ text-fallback (medium) không bị tự nâng lên high
    assert pq.lines[1].confidence == "medium"
    assert not any("lệch thành tiền" in w for w in pq.warnings)


def test_reconcile_thieu_don_gia_thi_suy_ra_tu_thanh_tien():
    pq = ParsedQuote(
        lines=[QuoteLine(line_no=1, name="Van", qty=4, unit_price=None, amount=8_000_000)]
    )
    tr.finalize(pq)
    assert pq.lines[0].unit_price == 2_000_000


def test_reconcile_thieu_thanh_tien_thi_tinh_tu_sl_va_gia():
    pq = ParsedQuote(
        lines=[QuoteLine(line_no=1, name="Van", qty=4, unit_price=2_000_000, amount=None)]
    )
    tr.finalize(pq)
    assert pq.lines[0].amount == 8_000_000


# ---------- dò tiêu đề: nhiều cột trùng + tiêu đề 2 dòng ----------


def test_score_header_canh_bao_nhieu_cot_don_gia():
    row = ["STT", "Tên hàng", "SL", "Đơn giá", "Đơn giá sau CK", "Thành tiền"]
    hm = tr.score_header_detail(row)
    assert hm is not None
    assert hm.mapping["unit_price"] == 3
    assert hm.ambiguous["unit_price"] == [3, 4]


def test_find_table_header_ghep_2_dong_tieu_de():
    grid = [
        ["STT", "Tên hàng hoá", "ĐVT", "", "", ""],   # dòng nhóm, chưa có cột số
        ["", "", "", "SL", "Đơn giá", "Thành tiền"],   # dòng cột số
        ["1", "Bơm", "Cái", "2", "1,000,000", "2,000,000"],
    ]
    found = tr.find_table_header(grid)
    assert found is not None
    header_idx, mapping, _ = found
    assert header_idx == 1  # body bắt đầu sau dòng tiêu đề thứ hai
    lines, _ = tr.grid_lines(grid, header_idx, mapping)
    assert len(lines) == 1
    assert lines[0].unit_price == 1_000_000


def test_header_dung_cum_thong_tin_ky_thuat():
    """Nhiều hợp đồng đặt cột tên hàng là 'THÔNG TIN KỸ THUẬT' (không phải 'thông số')."""
    header = ["STT", "THÔNG TIN KỸ THUẬT", "ĐV", "SL", "Đơn giá", "Thành tiền"]
    hm = tr.score_header_detail(header)
    assert hm is not None
    assert hm.mapping["name"] == 1
    assert hm.mapping["qty"] == 3
    assert hm.mapping["unit_price"] == 4
    assert hm.mapping["amount"] == 5


def test_apply_totals_khong_lay_thanh_tien_truoc_vat_lam_tong():
    """'THÀNH TIỀN' (trước VAT) + 'THÀNH TIỀN SAU VAT' -> tổng phải là số sau VAT."""
    pq = ParsedQuote(
        lines=[QuoteLine(line_no=1, name="Đĩa", qty=10, unit_price=280_000, amount=2_800_000)]
    )
    tr.apply_totals(
        [("total", 2_800_000), ("vat", 224_000), ("total", 3_024_000)],
        pq,
    )
    assert pq.declared_subtotal == 2_800_000
    assert pq.declared_vat == 224_000
    assert pq.declared_total == 3_024_000


def test_apply_totals_mot_con_so_dua_vao_tong_dong():
    """Chỉ có một dòng tiền + VAT: chọn cách hiểu có tạm tính khớp tổng dòng."""
    pq = ParsedQuote(
        lines=[QuoteLine(line_no=1, name="Bơm", qty=2, unit_price=50_000_000, amount=100_000_000)]
    )
    # Con số 108,000,000 là tổng sau VAT -> tạm tính 100,000,000 khớp tổng dòng
    tr.apply_totals([("total", 108_000_000), ("vat", 8_000_000)], pq)
    assert pq.declared_subtotal == 100_000_000
    assert pq.declared_total == 108_000_000


# ---------- merged cell Excel (lấp ô merge dọc) ----------


def test_excel_lap_merged_ten_hang_qua_nhieu_dong():
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["STT", "Tên hàng", "ĐVT", "SL", "Đơn giá", "Thành tiền"])
    ws.append([1, "BƠM HOÁ CHẤT", "Cái", 2, "11,200,000", "22,400,000"])
    ws.append(["", "", "", 3, "1,000,000", "3,000,000"])
    ws.merge_cells("B2:B3")  # tên hàng merge dọc
    buf = io.BytesIO()
    wb.save(buf)

    pq = ExcelTableParser().parse(buf.getvalue(), "merged.xlsx")
    assert len(pq.lines) == 2
    assert pq.lines[1].name == "BƠM HOÁ CHẤT"
    assert pq.lines[1].qty == 3
    assert pq.lines[1].unit_price == 1_000_000


# ---------- merged cell Word (merge ngang không nhân đôi giá) ----------


def test_docx_merge_ngang_don_gia_thanh_tien_khong_nhan_doi():
    from docx import Document

    doc = Document()
    table = doc.add_table(rows=2, cols=6)
    headers = ["STT", "Tên hàng", "ĐVT", "SL", "Đơn giá", "Thành tiền"]
    for i, h in enumerate(headers):
        table.cell(0, i).text = h
    vals = ["1", "BƠM HOÁ CHẤT", "Cái", "2", "", ""]
    for i, v in enumerate(vals):
        table.cell(1, i).text = v
    # Lỗi soạn thảo: merge ngang 2 ô "Đơn giá" + "Thành tiền"
    merged = table.cell(1, 4).merge(table.cell(1, 5))
    merged.text = "5,000,000"

    buf = io.BytesIO()
    doc.save(buf)
    pq = DocxTableParser().parse(buf.getvalue(), "merged.docx")

    assert len(pq.lines) == 1
    line = pq.lines[0]
    # KHÔNG được để amount = unit_price; suy ra amount = SL × giá
    assert line.unit_price == 5_000_000
    assert line.amount == 10_000_000



@pytest.mark.parametrize(
    "raw,expected",
    [
        # PDF căn phải tách chữ số đầu khỏi nhóm nghìn
        ("7 ,840,000", 7840000),
        ("8 ,467,200", 8467200),
        ("6 27,200", 627200),
        ("1 234,567", 1234567),
    ],
)
def test_parse_money_bi_tach_chu_so(raw, expected):
    assert tu.parse_money(raw) == expected
