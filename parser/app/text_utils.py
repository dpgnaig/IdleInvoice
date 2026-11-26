"""Hàm dùng chung: chuẩn hóa tiếng Việt, đọc số tiền, tách model/hãng/xuất xứ."""
from __future__ import annotations

import re
import unicodedata


def strip_accents(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.replace("đ", "d").replace("Đ", "D")


def norm(s: str) -> str:
    """Chữ thường, bỏ dấu, gộp khoảng trắng."""
    return re.sub(r"\s+", " ", strip_accents(s or "").lower()).strip()


_SPLIT_MONEY_RE = re.compile(r"(?<=\b\d)\s+(?=[.,]?\d{1,3}(?:[.,]\d{3})+\b)")


def merge_split_money(text: str) -> str:
    """Nối lại số tiền bị PDF căn phải tách rời: "7 ,840,000" / "6 27,200".

    Chỉ nối khi chữ số đứng riêng (một chữ số đầu từ) — không đụng tới cặp
    "SL 28 | Đơn giá 280,000" vì "28" không phải chữ số đứng riêng.
    """
    return _SPLIT_MONEY_RE.sub("", text or "")


def parse_money(raw: object) -> int | None:
    """11,200,000 / 11.200.000 / 11 200 000 / 11200000 -> int VND."""
    if raw is None:
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return round(raw)
    s = merge_split_money(str(raw)).strip()
    if not s:
        return None
    negative = s.startswith("(") and s.endswith(")")
    s = re.sub(r"[()₫đĐvVnNdD\s]", "", s)
    last_comma, last_dot = s.rfind(","), s.rfind(".")
    if last_comma > -1 and last_dot > -1:
        if last_comma > last_dot:
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif last_comma > -1:
        parts = s.split(",")
        s = s.replace(",", "") if len(parts) > 2 or len(parts[-1]) == 3 else s.replace(",", ".")
    elif last_dot > -1:
        parts = s.split(".")
        if len(parts) > 2 or len(parts[-1]) == 3:
            s = s.replace(".", "")
    try:
        n = float(s)
    except ValueError:
        return None
    return round(-n if negative else n)


def parse_qty(raw: object) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip().replace(" ", "")
    if not s:
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def extract_tax_rate(text: str) -> float | None:
    """Tìm thuế suất VAT và trả về dạng 0.08. Bỏ qua nếu là 0%."""
    t = norm(text)
    m = re.search(r"(?:thue\s*vat|vat)[^\d\n]{0,12}(\d{1,2}(?:[.,]\d+)?)\s*%", t)
    if m:
        return float(m.group(1).replace(",", ".")) / 100
    m = re.search(r"(\d{1,2}(?:[.,]\d+)?)\s*%\s*(?:vat|thue)", t)
    if m:
        return float(m.group(1).replace(",", ".")) / 100
    return None


MODEL_RE = re.compile(r"model\s*[:\-]?\s*([^\n]{1,80})", re.I)
BRAND_RE = re.compile(
    r"(?:h[aã]ng\s*sx|h[aã]ng\s*s[aả]n\s*xu[aấ]t|th[uư][oơ]ng\s*hi[eệ]u)\s*[:\-]?\s*([^\n]{1,80})",
    re.I,
)
ORIGIN_RE = re.compile(
    r"(?:xu[aấ]t\s*x[uứ]|s[aả]n\s*xu[aấ]t\s*t[aạ]i|sx\s*t[aạ]i|made\s*in)\s*[:\-]?\s*([^\n;\)]{2,40})",
    re.I,
)
ORIGIN_IN_PAREN_RE = re.compile(
    r"\((?:s[aả]n\s*xu[aấ]t\s*t[aạ]i|sx\s*t[aạ]i|xu[aấ]t\s*x[uứ])\s*([^)]+)\)", re.I
)


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).strip(" .,;:-")


def extract_model_brand_origin(text: str) -> tuple[str, str, str]:
    """Tách Model / Hãng SX / Xuất xứ từ một khối văn bản."""
    model = brand = origin = ""
    src = text or ""
    m = MODEL_RE.search(src)
    if m:
        model = _clean(re.split(r"[\(\n]", m.group(1))[0])
    b = BRAND_RE.search(src)
    if b:
        raw = _clean(b.group(1))
        o = ORIGIN_IN_PAREN_RE.search(raw)
        if o:
            origin = _clean(o.group(1))
        brand = _clean(re.split(r"\((?:s[aả]n\s*xu[aấ]t|sx|xu[aấ]t)", raw, flags=re.I)[0])
    if not origin:
        o = ORIGIN_RE.search(src)
        if o:
            origin = _clean(o.group(1))
    return model, brand, origin


DATE_VN_RE = re.compile(r"ng[aà]y\s*(\d{1,2})\s*th[aá]ng\s*(\d{1,2})\s*n[aă]m\s*(\d{4})", re.I)
DATE_SLASH_RE = re.compile(r"(?<!\d)(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})(?!\d)")
# "Hôm nay, ngày ...," luôn là ngày lập chứng từ. Các câu "Căn cứ ... ngày 24
# tháng 11 năm 2015" trích luật cũng có dạng ngày nên phải ưu tiên dòng này.
DATE_TODAY_RE = re.compile(
    r"(?:h[oô]m\s*nay|ng[aà]y\s*l[aậ]p|k[yý]\s*ng[aà]y)[^\n]{0,40}?"
    r"ng[aà]y\s*(\d{1,2})\s*th[aá]ng\s*(\d{1,2})\s*n[aă]m\s*(\d{4})",
    re.I,
)
# "Số báo giá"/"Báo giá số" tách rời trên dòng Excel/Word ("Số trang: 01 | Số báo giá: X")
QUOTE_NO_LABEL_RE = re.compile(
    r"(?:s[oôố]\s*b[aá]o\s*gi[aá]|b[aá]o\s*gi[aá]\s*s[oôố]|bg\s*s[oôố])\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-\/\._]{2,40})",
    re.I,
)


def _ymd(m: re.Match[str]) -> str:
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return ""
    return f"{y:04d}-{mo:02d}-{d:02d}"


def extract_date(text: str) -> str:
    text = text or ""
    m = DATE_TODAY_RE.search(text) or DATE_VN_RE.search(text) or DATE_SLASH_RE.search(text)
    return _ymd(m) if m else ""


QUOTE_NO_RES = [
    QUOTE_NO_LABEL_RE,
    re.compile(r"s[oôố]\s*bg\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-\/\._]{2,40})", re.I),
]

TAX_CODE_RE = re.compile(
    r"(?:m[aã]\s*s[oôố]\s*thu[eế]|mst)\s*[:\-]?\s*(\d{10}(?:\s*[-–]\s*\d{3})?)", re.I
)

BUYER_RE = re.compile(r"k[ií]nh\s*g[uử]i\s*[:\-]?\s*([^\n|]{3,120})", re.I)

VALIDITY_RE = re.compile(
    r"(?:hi[eệ]u\s*l[uự]c)[^\d\n]{0,40}?(\d{1,3})\s*ng[aà]y", re.I
)

SENDER_RE = re.compile(r"ngu[oờ]i\s*g[uử]i\s*[:\-]?\s*([^\n|]{2,40})", re.I)
RECEIVER_RE = re.compile(r"ngu[oờ]i\s*nh[aậ]n\s*[:\-]?\s*([^\n|]{2,40})", re.I)


def classify_total(label: str) -> str | None:
    """Phân loại dòng tổng: subtotal (trước VAT) / vat / total.

    "vat" ở đây nghĩa là dòng TIỀN thuế. Dòng chỉ có chữ ("Vật liệu:",
    "Đơn giá trên đã bao gồm VAT 8%") không được coi là dòng tổng — không có
    số tiền thì không có gì để ghi, chỉ gây nhiễu.
    """
    n = norm(label)
    if not n:
        return None
    # "Mã số thuế: 0101234567" không phải dòng VAT — nếu không loại sẽ lấy MST làm tiền thuế
    if "ma so thue" in n or "mst" in n:
        return None
    # "Vật liệu"/"Vật tư" trong bảng thông số kỹ thuật cũng chứa "vat" (bỏ dấu
    # thành "vat lieu") -> không phải dòng thuế.
    if "vat lieu" in n or "vat tu" in n:
        return None
    if "vat" in n and "thue" not in n and not re.search(r"\bvat\b(?!\s+(lieu|tu))", n):
        return None
    # "Đường kính tổng cộng: 268 mm", "Tổng độ dài ống: 1145mm" -> đây là
    # dòng thông số, không phải dòng tổng tiền.
    if re.search(r"\btong\b.*\b(do dai|khoi luong|trong luong|the tich|dien tich|kich thuoc)\b", n):
        return None
    if re.search(r"\btong\b.*\d\s*(mm|cm|met|kg|m)\b", n):
        return None
    if "chua bao gom vat" in n or "truoc vat" in n or "khong bao gom vat" in n or "truoc thue" in n:
        return "subtotal"
    # "TỔNG GIÁ SAU THUẾ" / "Thành tiền sau VAT" là tổng thanh toán, không phải
    # dòng tiền thuế (nhãn có chữ "thuế" nên nếu không bắt ở đây sẽ bị xếp vào vat).
    if "sau thue" in n or "sau vat" in n:
        return "total"
    if "thanh tien" in n or "tong cong" in n or "tong thanh toan" in n or "tong tien thanh toan" in n:
        return "total"
    # "Tổng giá trị đã bao gồm VAT" là tổng thanh toán, không phải dòng thuế
    if "bao gom vat" in n:
        return "total"
    if "vat" in n or "thue" in n:
        return "vat"
    if "tong" in n:
        return "subtotal"
    return None


def last_money_in_row(cells: list[str]) -> int | None:
    """Lấy số tiền cuối cùng trong dòng (hỗ trợ cả dòng ghép 'TỔNG | 145,940,000').

    Bỏ qua token là phần trăm ("VAT 8%"), tránh nhầm thuế suất thành số tiền.
    """
    flat: list[str] = []
    for c in cells:
        flat.extend(str(c).split("|"))
    tokens: list[str] = []
    for c in flat:
        for m in re.finditer(r"\d[\d.,]*\s*%?", merge_split_money(c)):
            tok = m.group(0).strip()
            if tok.endswith("%"):
                continue
            tokens.append(tok)
    for token in reversed(tokens):
        v = parse_money(token)
        if v is not None and v > 0:
            return v
    return None
