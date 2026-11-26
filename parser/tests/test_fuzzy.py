"""Test tìm tương tự bằng rapidfuzz."""
from __future__ import annotations

from app import fuzzy


CUSTOMERS = [
    {"id": 1, "name": "CÔNG TY TNHH THƯƠNG MẠI QUANG MINH", "taxCode": "0101397217"},
    {"id": 2, "name": "CÔNG TY CỔ PHẦN STAVIAN TISSUE", "taxCode": "0900260628"},
    {"id": 3, "name": "CÔNG TY TNHH ARK VIỆT NAM", "taxCode": "2400573873"},
]

PRODUCTS = [
    {"id": 10, "code": "HD-270", "name": "Đĩa phân phối khí tinh", "unit": "Cái"},
    {"id": 11, "code": "HD270KHAU", "name": "Đĩa phân phối khí phi 270 inox", "unit": "Cái"},
    {"id": 12, "code": "1M321P1115SVBSMV0M3-001", "name": "Bơm hóa chất OBL", "unit": "Cái"},
    {"id": 13, "code": "LT-040-0.75KW", "name": "Máy thổi khí", "unit": "Cái"},
]


def test_customer_khop_ten_viet_tat_khong_dau():
    res = fuzzy.customer_candidates("CTY TM QUANG MINH", CUSTOMERS, limit=5)
    assert res
    assert res[0]["id"] == 1
    assert res[0]["score"] >= 0.8


def test_customer_go_sai_van_tim_duoc():
    res = fuzzy.customer_candidates("STAVIAN TISU", CUSTOMERS, limit=5)
    assert res and res[0]["id"] == 2


def test_customer_khong_lien_quan_diemsai_thap():
    res = fuzzy.customer_candidates("ZZZ KHONG TON TAI", CUSTOMERS, min_score=0.6)
    assert res == []


def test_product_ma_khop_tuyet_doi():
    lines = [{"name": "ĐĨA PHÂN PHỐI KHÍ", "model": "HD-270", "spec": "", "brand": ""}]
    out = fuzzy.product_candidates(lines, PRODUCTS, limit=5)
    assert out[0][0]["code"] == "HD-270"
    assert out[0][0]["codeScore"] == 1.0
    assert out[0][0]["score"] == 1.0


def test_product_ket_hop_ma_va_mo_ta():
    # Model gần đúng + mô tả khớp -> ứng viên đĩa đứng đầu, không phải bơm
    lines = [{
        "name": "ĐĨA PHÂN PHỐI KHÍ TINH",
        "model": "HD-270",
        "spec": "Đường kính 268 mm, màng EPDM",
        "brand": "",
    }]
    out = fuzzy.product_candidates(lines, PRODUCTS, limit=3)
    assert out[0][0]["id"] in (10, 11)


def test_product_chi_co_mo_ta_khong_co_ma():
    lines = [{"name": "BƠM HÓA CHẤT OBL 320L/h", "model": "", "spec": "", "brand": "OBL"}]
    out = fuzzy.product_candidates(lines, PRODUCTS, limit=3)
    assert out[0][0]["id"] == 12


def test_product_tra_dung_thu_tu_dong():
    lines = [
        {"name": "BƠM HÓA CHẤT", "model": "1M321P1115SVBSMV0M3-001", "spec": "", "brand": ""},
        {"name": "MÁY THỔI KHÍ", "model": "LT-040", "spec": "", "brand": ""},
    ]
    out = fuzzy.product_candidates(lines, PRODUCTS, limit=3)
    assert len(out) == 2
    assert out[0][0]["id"] == 12
    assert out[1][0]["id"] == 13


def test_danh_muc_rong_khong_loi():
    assert fuzzy.product_candidates([{"name": "X", "model": "Y", "spec": "", "brand": ""}], []) == [[]]
    assert fuzzy.customer_candidates("X", []) == []


# --- Model + thông số kỹ thuật: cùng mã gốc, khác biến thể ---

LT_PRODUCTS = [
    {"id": 20, "code": "LT-050-0.75KW", "name": "Máy thổi khí LongTech 0.75kw", "unit": "bộ"},
    {"id": 21, "code": "LT-050-2.2KW", "name": "Máy thổi khí LongTech 2.2kw", "unit": "bộ"},
    {"id": 22, "code": "LT-040-0.75KW", "name": "Máy thổi khí LongTech 0.75kw", "unit": "bộ"},
    {"id": 23, "code": "HD270", "name": "Đĩa phân phối khí", "unit": "Cái"},
]


def test_product_bien_the_cung_ma_xep_theo_thong_so():
    # Báo giá ghi model gốc "LT - 050"; thông số (2.2 kw) phải đẩy đúng biến thể lên đầu
    lines = [{
        "name": "MÁY THỔI KHÍ LONGTECH",
        "model": "LT - 050",
        "spec": "Công suất: 2.2 Kw/380V/3 pha - Lưu lượng Q = 1.15 m3/phút",
        "brand": "LongTech",
    }]
    out = fuzzy.product_candidates(lines, LT_PRODUCTS, limit=4)
    assert out[0][0]["id"] == 21


def test_product_ma_goc_khop_nhieu_bien_the_khong_tu_chon():
    # Không có thông số phân biệt -> điểm sát nhau, caller phải coi là mơ hồ
    lines = [{"name": "MÁY THỔI KHÍ", "model": "LT - 050", "spec": "", "brand": ""}]
    out = fuzzy.product_candidates(lines, LT_PRODUCTS, limit=4)
    top = out[0][:2]
    assert top[0]["codeScore"] == top[1]["codeScore"]
    assert abs(top[0]["score"] - top[1]["score"]) < 0.05


def test_product_khop_chinh_xac_co_gach_noi_la_tuyet_doi():
    lines = [{"name": "ĐĨA PHÂN PHỐI KHÍ", "model": "HD-270", "spec": "", "brand": ""}]
    out = fuzzy.product_candidates(lines, PRODUCTS, limit=3)
    # HD-270 phải thắng HD270KHAU dù cả hai đều chứa "hd270"
    assert out[0][0]["id"] == 10
    assert out[0][0]["codeScore"] == 1.0
    assert out[0][1]["codeScore"] < 0.99


def test_product_ma_khac_gach_noi_khong_phai_khop_tuyet_doi():
    lines = [{"name": "ĐĨA", "model": "HD270", "spec": "", "brand": ""}]
    out = fuzzy.product_candidates(lines, PRODUCTS, limit=3)
    # "HD270" không được coi là trùng tuyệt đối với "HD-270"
    assert out[0][0]["codeScore"] < 1.0


# --- Công suất (kW) phân định biến thể cùng mã gốc ---

POWER_PRODUCTS = [
    {"id": 30, "code": "LT-040-0.75KW", "name": "Máy thổi khí Longtech LT-040, P=0.75kw", "unit": "bộ"},
    {"id": 31, "code": "LT-040-1.5KW", "name": "Máy thổi khí Longtech LT-040, P=1.5kw", "unit": "bộ"},
    {"id": 32, "code": "LT-050-1.5KW", "name": "Máy thổi khí Longtech LT-050, P=1.5kw", "unit": "bộ"},
    {"id": 33, "code": "LT-050-2.2KW", "name": "Máy thổi khí Longtech LT-050, P=2.2kw", "unit": "bộ"},
]


def test_product_cong_suat_phan_dinh_dung_bien_the():
    lines = [{
        "name": "MÁY THỔI KHÍ LONGTECH",
        "model": "LT - 040",
        "spec": "Model: LT - 040\n- Công suất: 1.5 kW/380V/3 pha/50Hz/4P",
        "brand": "LongTech",
    }]
    out = fuzzy.product_candidates(lines, POWER_PRODUCTS, limit=4)
    assert out[0][0]["id"] == 31
    assert out[0][0]["score"] >= 0.9
    # Biến thể cùng mã gốc nhưng khác công suất bị đẩy hẳn xuống dưới
    assert out[0][1]["id"] != 30 or out[0][1]["score"] < 0.8


def test_product_cong_suat_khac_mo_ta_giong_het_van_phan_biet():
    # LT-050 1.5kw và LT-040 1.5kw mô tả gần giống hệt, chỉ khác mã gốc + công suất trùng
    lines = [{
        "name": "MÁY THỔI KHÍ LONGTECH",
        "model": "LT - 050",
        "spec": "Model: LT - 050\n- Công suất: 1.5 kW/380V/3 pha/50Hz/4P",
        "brand": "LongTech",
    }]
    out = fuzzy.product_candidates(lines, POWER_PRODUCTS, limit=4)
    assert out[0][0]["id"] == 32


# --- Giữ đúng dạng viết của model (gạch ngang) — dữ liệu thật trong DB ---

HD_REAL = [
    {"id": 1000, "code": "HD270", "name": "Đĩa phân phối khí Jaeger HD270, loại có màng: EPDM F053A", "unit": "Cái"},
    {"id": 1358, "code": "HD270-SILICON", "name": "Đĩa phân phối khí Jaeger HD270, màng: silicone", "unit": "Cái"},
    {"id": 1528, "code": "HD270KHAU", "name": "Đĩa phân phối khí Jaeger HD270 loại có màng: EPDM F053A, bao gồm khớp nối", "unit": "Bộ"},
    {"id": 133, "code": "HD-270(TQ)", "name": "Đĩa phân phối khí Jaeger HD-270, loại có màng: EPDM F053A", "unit": "Cái"},
    {"id": 131, "code": "HD-270bgkhau", "name": "Đĩa phân phối khí Jaeger HD-270, loại có màng: EPDM F053A, bao gồm khớp nối", "unit": "Cái"},
]


def test_model_co_gach_ngang_uu_tien_ma_co_gach_ngang():
    lines = [{
        "name": "ĐĨA PHÂN PHỐI KHÍ TINH",
        "model": "HD-270",
        "spec": "Jaeger HD-270, màng EPDM F053A",
        "brand": "Jaeger",
    }]
    out = fuzzy.product_candidates(lines, HD_REAL, limit=5)[0]
    by_id = {c["id"]: c for c in out}
    # Hai mã viết đúng "HD-270" đứng trên mọi mã chỉ giống sau khi bỏ gạch ngang
    assert out[0]["id"] in (133, 131)
    for dashed in (133, 131):
        for plain in (1000, 1358, 1528):
            assert by_id[dashed]["codeScore"] > by_id[plain]["codeScore"]
    assert by_id[133]["score"] > by_id[1000]["score"]


def test_model_viet_lien_uu_tien_ma_viet_lien():
    lines = [{"name": "ĐĨA PHÂN PHỐI KHÍ", "model": "HD270", "spec": "", "brand": ""}]
    out = fuzzy.product_candidates(lines, HD_REAL, limit=5)[0]
    assert out[0]["id"] == 1000
    assert out[0]["codeScore"] == 1.0


def test_ma_khong_khop_nham_chu_so_tiep_theo():
    # "HD-270" không được coi là tiền tố đúng dạng của "HD-2700"
    assert fuzzy._code_score("HD-270", "HD-2700") < 0.97
    assert fuzzy._code_score("HD-270", "HD-270(TQ)") == 0.97
    assert fuzzy._code_score("HD-270", "HD270") < 0.97


def test_ma_keo_dai_bang_chu_so_bi_tru_nang():
    # Khác model (thêm chữ số) phải thấp hơn hẳn khác dấu phân cách
    same_model = fuzzy._code_score("HD-270", "HD270")
    assert same_model == 0.9
    for line, code in [("HD-270", "HD-2700"), ("HD270", "HD2700"),
                       ("ABC-100", "ABC-1000"), ("LT-050", "LT0501")]:
        assert fuzzy._code_score(line, code) <= 0.6, (line, code)
        assert fuzzy._code_score(code, line) <= 0.6, (code, line)


def test_ma_co_hau_to_cong_suat_khong_bi_tru():
    # Dấu '-' ngăn cách công suất => vẫn là cùng dòng máy, không bị coi là kéo dài số
    assert fuzzy._code_score("LT040", "LT-040-1.5kw") == 0.9
    assert fuzzy._code_score("LT-040", "LT-040-1.5kw") == 0.97
    assert fuzzy._code_score("HD270", "HD-270(TQ)") == 0.9
