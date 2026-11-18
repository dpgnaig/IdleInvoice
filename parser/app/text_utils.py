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


def parse_money(raw: object) -> int | None:
    """11,200,000 / 11.200.000 / 11 200 000 / 11200000 -> int VND."""
    if raw is None:
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return round(raw)
    s = str(raw).strip()
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


def extract_date(text: str) -> str:
    m = DATE_VN_RE.search(text or "")
    if not m:
        m = DATE_SLASH_RE.search(text or "")
    if not m:
        return ""
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return ""
    return f"{y:04d}-{mo:02d}-{d:02d}"


QUOTE_NO_RES = [
    re.compile(r"s[oôố]\s*b[aá]o\s*gi[aá]\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-\/\._]{2,40})", re.I),
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
    """Phân loại dòng tổng: subtotal (trước VAT) / vat / total."""
    n = norm(label)
    if not n:
        return None
    if "chua bao gom vat" in n or "truoc vat" in n or "khong bao gom vat" in n:
        return "subtotal"
    if "thanh tien" in n or "tong cong" in n or "tong thanh toan" in n or "tong tien thanh toan" in n:
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
        for m in re.finditer(r"\d[\d.,]*\s*%?", c):
            tok = m.group(0).strip()
            if tok.endswith("%"):
                continue
            tokens.append(tok)
    for token in reversed(tokens):
        v = parse_money(token)
        if v is not None and v > 0:
            return v
    return None
