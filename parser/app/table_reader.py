"""Đọc bảng hàng hóa từ các "grid" (mảng 2 chiều chuỗi) của Excel/PDF.

Dò tiêu đề theo từ khóa (không theo vị trí cố định), gộp dòng mô tả vào dòng
hàng phía trên, nhận diện dòng tổng/VAT để không bị coi là hàng hóa.
"""
from __future__ import annotations

import re
import unicodedata

from .models import ParsedQuote, QuoteLine
from . import text_utils as tu

HEADER_KEYWORDS: dict[str, list[str]] = {
    "line_no": ["tt", "stt", "so tt", "sott"],
    "name": [
        "thong so ky thuat",
        "chung loai",
        "ten hang",
        "ten thiet bi",
        "ten hang hoa",
        "hang hoa dich vu",
        "noi dung",
        "dien giai",
        "mo ta",
    ],
    # Cột riêng cho model/hãng/xuất xứ — báo giá Word/Excel thường tách cột
    # thay vì ghi "Model: ..." trong ô tên hàng.
    "model": ["model", "ma model", "ma hang", "ma hieu", "ky hieu"],
    "brand": [
        "hang",
        "hang sx",
        "hang san xuat",
        "hang san xuat",
        "thuong hieu",
        "nhan hieu",
        "hangsx",
    ],
    "origin": ["xuat xu", "nuoc san xuat", "nuoc", "made in"],
    "desc": ["mo ta chi tiet", "mo ta", "quy cach", "thong so ky thuat"],
    "unit": ["dvt", "don vi tinh", "dv", "don vi"],
    "qty": ["so luong", "sl", "khoi luong"],
    "unit_price": ["don gia"],
    "amount": ["thanh tien", "so tien", "tong tien"],
}

# Từ khoá ngắn dễ khớp nhầm cột khác ("Hàng" trong "Hàng hóa", "Nước" trong
# "Nước uống"): chỉ chấp nhận khi cả ô đúng bằng từ khoá.
EXACT_ONLY: dict[str, set[str]] = {
    "brand": {"hang", "hangsx"},
    "origin": {"nuoc"},
    "model": {"model", "ma hang", "ma hieu", "ky hieu"},
}


def _cell(cells: list[str], i: int | None) -> str:
    if i is None or i < 0 or i >= len(cells):
        return ""
    return (cells[i] or "").strip()


def score_header(cells: list[str]) -> dict[str, int] | None:
    """Trả map field -> chỉ số cột nếu dòng này là tiêu đề bảng hàng hóa.

    Mỗi cột chỉ được gán cho một field (cột "Mô tả" không bị vừa là tên hàng
    vừa là mô tả). Từ khoá ngắn trong ``EXACT_ONLY`` chỉ khớp nguyên ô.
    """
    keys = [tu.norm(c) for c in cells]
    mapping: dict[str, int] = {}
    used: set[int] = set()
    for field, words in HEADER_KEYWORDS.items():
        exact = EXACT_ONLY.get(field, set())
        for i, k in enumerate(keys):
            if not k or i in used:
                continue
            if any(k == w for w in words):
                mapping[field] = i
                used.add(i)
                break
        if field in mapping:
            continue
        for i, k in enumerate(keys):
            if not k or i in used:
                continue
            if any(len(w) >= 4 and w not in exact and w in k for w in words):
                mapping[field] = i
                used.add(i)
                break
    if "name" not in mapping:
        return None
    numeric_cols = {"qty", "unit_price", "amount"} & set(mapping)
    if not numeric_cols:
        return None
    # Tiêu đề phải có tín hiệu ở ít nhất 2 trong 3 cột số
    return mapping


def find_table_header(grid: list[list[str]], max_scan: int = 40) -> tuple[int, dict[str, int]] | None:
    best: tuple[int, dict[str, int]] | None = None
    for i, row in enumerate(grid[:max_scan]):
        m = score_header(row)
        if m and (best is None or len(m) > len(best[1])):
            best = (i, m)
    return best


def grid_lines(grid: list[list[str]], header_idx: int, mapping: dict[str, int]) -> tuple[list[QuoteLine], list[tuple[str, int]]]:
    """Duyệt phần thân bảng. Trả (lines, totals) với totals = [(loại, số tiền)]."""
    name_i = mapping.get("name")
    unit_i = mapping.get("unit")
    qty_i = mapping.get("qty")
    price_i = mapping.get("unit_price")
    amount_i = mapping.get("amount")
    model_i = mapping.get("model")
    brand_i = mapping.get("brand")
    origin_i = mapping.get("origin")
    desc_i = mapping.get("desc")

    lines: list[QuoteLine] = []
    totals: list[tuple[str, int]] = []
    current: QuoteLine | None = None
    in_terms = False

    for row in grid[header_idx + 1:]:
        label = f"{_cell(row, 0)} {_cell(row, 1)}"
        kind = tu.classify_total(label)
        # Chỉ coi là dòng tổng khi có số tiền và không có số lượng/đơn giá
        has_qty = tu.parse_qty(_cell(row, qty_i)) is not None if qty_i is not None else False
        if kind and not has_qty:
            amount = tu.last_money_in_row(row)
            if amount is not None:
                totals.append((kind, amount))
                in_terms = True
                continue
        if kind and not any(_cell(row, i) for i in {qty_i, price_i, amount_i} - {None}):
            # dòng tiêu đề tổng không có số (vd "TỔNG" ở dòng tiêu đề mục)
            continue

        name_cell = _cell(row, name_i)
        qty = tu.parse_qty(_cell(row, qty_i)) if qty_i is not None else None
        price = tu.parse_money(_cell(row, price_i)) if price_i is not None else None
        amount = tu.parse_money(_cell(row, amount_i)) if amount_i is not None else None

        # Dòng hàng chính: có tên + (số lượng hoặc đơn giá/thành tiền)
        if name_cell and (qty is not None or (price is not None and price > 0) or (amount is not None and amount > 0)):
            model, brand, origin = tu.extract_model_brand_origin(name_cell)
            model = _cell(row, model_i) or model
            brand = _cell(row, brand_i) or brand
            origin = _cell(row, origin_i) or origin
            desc = _cell(row, desc_i)
            # Cột mô tả trùng nội dung ô tên thì không lặp lại
            spec_text = desc if desc and tu.norm(desc) != tu.norm(name_cell) else ""
            current = QuoteLine(
                line_no=len(lines) + 1,
                name=name_cell,
                unit=_cell(row, unit_i),
                qty=qty,
                unit_price=price,
                amount=amount,
                model=model,
                brand=brand,
                origin=origin,
                spec_text=spec_text,
                confidence="high" if (qty is not None and price is not None) else "medium",
            )
            lines.append(current)
            continue

        # Chỉ có thành tiền nhưng không có số lượng/đơn giá: bổ sung vào dòng hiện tại
        if current is not None and qty is None and price is None and amount is not None:
            if current.amount is None:
                current.amount = amount
            in_terms = True
            continue

        # Dòng mô tả bên dưới -> gộp vào spec_text của dòng trên
        text = _cell(row, name_i) or " ".join(c for c in row if c)
        text = text.strip()
        if not text:
            continue
        if in_terms or current is None:
            continue
        model, brand, origin = tu.extract_model_brand_origin(text)
        if model and not current.model:
            current.model = model
        if brand and not current.brand:
            current.brand = brand
        if origin and not current.origin:
            current.origin = origin
        current.spec_text = (current.spec_text + "\n" + text).strip()

    return lines, totals


def apply_totals(totals: list[tuple[str, int]], pq: ParsedQuote) -> None:
    """Ghi tổng khai báo; dòng ghi trước được ưu tiên (dòng 'đã bao gồm VAT 8%' phía sau bị bỏ qua)."""
    for kind, value in totals:
        if kind == "vat" and pq.declared_vat is None:
            pq.declared_vat = value
        elif kind == "total" and pq.declared_total is None:
            pq.declared_total = value
        elif kind == "subtotal" and pq.declared_subtotal is None:
            pq.declared_subtotal = value
    if pq.declared_subtotal is None and pq.declared_total is not None and pq.declared_vat is not None:
        pq.declared_subtotal = pq.declared_total - pq.declared_vat
    if pq.declared_vat is None and pq.declared_total and pq.declared_subtotal:
        pq.declared_vat = pq.declared_total - pq.declared_subtotal


def read_grids_excel(data: bytes, filename: str) -> list[list[list[str]]]:
    return [grid for _name, grid in read_sheets_excel(data, filename)]


def read_sheets_excel(data: bytes, filename: str) -> list[tuple[str, list[list[str]]]]:
    """Trả [(tên sheet, grid)] — dùng cho xem trước và cho parser."""
    if filename.lower().endswith(".xls"):
        return _read_xls(data)
    return _read_xlsx(data)


def _norm_cell(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value == int(value):
        return str(int(value))
    return str(value).strip()


def _read_xlsx(data: bytes) -> list[tuple[str, list[list[str]]]]:
    import io

    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    out: list[tuple[str, list[list[str]]]] = []
    for ws in wb.worksheets:
        grid: list[list[str]] = []
        for row in ws.iter_rows(values_only=True):
            vals = [_norm_cell(v) for v in row]
            if any(vals):
                grid.append(vals)
        if grid:
            out.append((ws.title or "Sheet", grid))
    return out


def _read_xls(data: bytes) -> list[tuple[str, list[list[str]]]]:
    import xlrd

    wb = xlrd.open_workbook(file_contents=data)
    out: list[tuple[str, list[list[str]]]] = []
    for ws in wb.sheets():
        grid: list[list[str]] = []
        for r in range(ws.nrows):
            row = [_norm_cell(ws.cell_value(r, c)) for c in range(ws.ncols)]
            if any(row):
                grid.append(row)
        if grid:
            out.append((ws.name or "Sheet", grid))
    return out


def _sheet_text(grid: list[list[str]]) -> str:
    return "\n".join(" | ".join(c for c in row if c) for row in grid)


def _raw_lines(text: str) -> list[str]:
    out = []
    for line in text.splitlines():
        # Grid Excel được ghép bằng " | " -> bỏ các ô rỗng ở cuối
        parts = [p.strip() for p in line.split("|")] if "|" in line else [line.strip()]
        while parts and not parts[-1]:
            parts.pop()
        joined = " | ".join(p for p in parts if p).strip()
        if joined:
            out.append(joined)
    return out


def _value_after_colon(raw: str) -> str:
    """Lấy phần sau dấu ':' cuối cùng trong dòng ('V/v: ... Số BG: xxx' -> xxx)."""
    if ":" not in raw:
        return ""
    return raw.rsplit(":", 1)[1].split("|")[0].strip(" .,;|-")


def _norm_with_map(raw: str) -> tuple[str, list[int]]:
    """Chuẩn hóa bỏ dấu nhưng giữ map về chỉ số ký tự trong chuỗi gốc."""
    out: list[str] = []
    index: list[int] = []
    for i, ch in enumerate(raw):
        for c in unicodedata.normalize("NFD", ch.lower()):
            if unicodedata.category(c) == "Mn":
                continue
            mapped = "d" if c == "đ" else c
            out.append(mapped)
            index.append(i)
    return "".join(out), index


def label_value(raw: str, label: str, stop_labels: tuple[str, ...] = ()) -> str:
    """Lấy giá trị sau nhãn (không phân biệt hoa/thường, có/không dấu)."""
    n, index = _norm_with_map(raw)
    pos = n.find(label)
    if pos < 0:
        return ""
    start = pos + len(label)
    # bỏ qua dấu ':' và khoảng trắng ngay sau nhãn
    while start < len(n) and n[start] in " :-–\t":
        start += 1
    end = len(n)
    for stop in stop_labels:
        p = n.find(stop, start)
        if p > -1:
            end = min(end, p)
    raw_start = index[start] if start < len(index) else len(raw)
    raw_end = index[end] if end < len(index) else len(raw)
    return re.sub(r"\s+", " ", raw[raw_start:raw_end]).strip(" .,;|-")


def extract_meta(text: str, pq: ParsedQuote) -> None:
    """Bóc thông tin chung từng dòng (giữ được dấu tiếng Việt trong tên)."""
    lines = _raw_lines(text)

    for raw in lines:
        n = tu.norm(raw)

        if not pq.buyer_name and "kinh gui" in n:
            val = label_value(raw, "kinh gui") or _value_after_colon(raw)
            val = re.sub(r"\s+", " ", val).strip(" .,;|-")
            if val:
                pq.buyer_name = val
                pq.buyer_name_confidence = "high"

        if not pq.buyer_tax_code:
            if re.search(r"(mst|ma so thue|m[aã] s[oố] thu[eế])", n):
                m = re.search(r"(\d{10}(?:\s*[-–]\s*\d{3})?)", raw)
                if m:
                    pq.buyer_tax_code = re.sub(r"\s+", "", m.group(1))
                    pq.buyer_tax_code_confidence = "high"

        if not pq.quote_no:
            if re.search(r"(so bao gia|so bg|s[oố] b[aá]o gi[aá])", n):
                for label in ("so bao gia", "so bg"):
                    val = label_value(raw, label)
                    if not val and ":" in raw:
                        val = _value_after_colon(raw)
                    if val:
                        pq.quote_no = val.split()[0].strip(" .,;")
                        pq.quote_no_confidence = "high"
                        break

        if not pq.sender_name and "nguoi gui" in n:
            val = label_value(raw, "nguoi gui", stop_labels=("dien thoai", "email", "tel"))
            if val:
                pq.sender_name = val
        if not pq.receiver_name and "nguoi nhan" in n:
            val = label_value(raw, "nguoi nhan", stop_labels=("nguoi gui", "dien thoai", "email", "tel"))
            if val:
                pq.receiver_name = val

        if pq.validity_days is None and "hieu luc" in n:
            v = tu.VALIDITY_RE.search(raw)
            if v:
                pq.validity_days = int(v.group(1))
        if not pq.payment_terms and "chuyen khoan" in n:
            pq.payment_terms = "Chuyển khoản"

    if not pq.quote_no:
        for pat in tu.QUOTE_NO_RES:
            q = pat.search(text)
            if q:
                pq.quote_no = q.group(1).strip(" .,;")
                pq.quote_no_confidence = "medium"
                break

    pq.quote_date = tu.extract_date(text)
    if pq.quote_date:
        pq.quote_date_confidence = "high"

    if pq.validity_days is None:
        v = tu.VALIDITY_RE.search(text)
        if v:
            pq.validity_days = int(v.group(1))

    if not pq.payment_terms and "chuyen khoan" in tu.norm(text):
        pq.payment_terms = "Chuyển khoản"


# Dòng hàng dạng text: "3 BƠM HOÁ CHẤT Cái 8 13,200,000 105,600,000"
TEXT_LINE_RE = re.compile(
    r"^(?P<no>\d{1,3})[.)]?\s+(?P<body>.+?)\s+"
    r"(?P<qty>\d[\d.,]*)\s+(?P<price>\d[\d.,]*)\s+(?P<amount>[\d][\d.,]*)\s*$"
)


def lines_from_text(
    text: str, existing: list[QuoteLine] | None = None
) -> tuple[list[QuoteLine], list[tuple[str, int]]]:
    """Dự phòng cho trang PDF không có đường kẻ bảng.

    `existing` là các dòng đã đọc từ bảng. Dòng text có cùng (SL, đơn giá,
    thành tiền) với một dòng trong bảng bị coi là bản đọc lại của cùng dòng đó;
    chỉ giữ số dòng vượt quá số lần xuất hiện trong bảng.
    """
    budget: dict[tuple, int] = {}
    for l in existing or []:
        key = (l.qty, l.unit_price, l.amount)
        budget[key] = budget.get(key, 0) + 1

    lines: list[QuoteLine] = []
    totals: list[tuple[str, int]] = []
    current: QuoteLine | None = None
    for raw in _raw_lines(text):
        kind = tu.classify_total(raw)
        if kind and not TEXT_LINE_RE.match(raw):
            amount = tu.last_money_in_row([raw])
            if amount is not None:
                totals.append((kind, amount))
                current = None
                continue
        m = TEXT_LINE_RE.match(raw)
        if m:
            body = m.group("body").strip()
            tokens = body.split()
            unit = ""
            if len(tokens) >= 2 and len(tokens[-1]) <= 12 and not re.search(r"\d", tokens[-1]):
                unit = tokens[-1]
                body = " ".join(tokens[:-1])
            model, brand, origin = tu.extract_model_brand_origin(body)
            candidate = QuoteLine(
                line_no=len(lines) + 1,
                name=body,
                unit=unit,
                qty=tu.parse_qty(m.group("qty")),
                unit_price=tu.parse_money(m.group("price")),
                amount=tu.parse_money(m.group("amount")),
                model=model,
                brand=brand,
                origin=origin,
                confidence="medium",
            )
            key = (candidate.qty, candidate.unit_price, candidate.amount)
            if budget.get(key, 0) > 0:
                budget[key] -= 1
                continue
            current = candidate
            lines.append(current)
            continue
        if current is not None and raw.strip():
            model, brand, origin = tu.extract_model_brand_origin(raw)
            if model and not current.model:
                current.model = model
            if brand and not current.brand:
                current.brand = brand
            if origin and not current.origin:
                current.origin = origin
            current.spec_text = (current.spec_text + "\n" + raw.strip()).strip()
    return lines, totals


def _dedupe_lines(lines: list[QuoteLine]) -> list[QuoteLine]:
    """Bỏ dòng trùng do đọc cả bảng (có đường kẻ) lẫn text của cùng trang PDF.

    Tên trùng nhưng khác model (2 mã của 1 thiết bị) hoặc khác ĐVT/giá thì giữ:
    chỉ coi là trùng khi cả tên gọn (bỏ phần sau xuống dòng và "MODEL: ...")
    lẫn số lượng, đơn giá và model đều khớp.
    """
    out: list[QuoteLine] = []
    seen: set[tuple] = set()
    for l in lines:
        head = re.split(r"[\n(]", l.name)[0].strip().lower()
        key = (head, l.qty, l.unit_price, tu.norm(l.model))
        if key in seen:
            continue
        seen.add(key)
        out.append(l)
    for i, l in enumerate(out, 1):
        l.line_no = i
    return out


def finalize(pq: ParsedQuote) -> ParsedQuote:
    """Tính thuế suất, kiểm tra lệch tổng, sinh cảnh báo."""
    pq.lines = _dedupe_lines(pq.lines)

    # Đọc nhầm "%" thành số tiền (vd "VAT 10% 5,657,000" -> VAT = 10):
    # VAT khai báo là bội số của thuế suất trên tổng trước thuế, không phải
    # vài chục đồng. Bỏ số vô lý để UI tự tính lại.
    base = pq.declared_subtotal or round(sum((l.qty or 0) * (l.unit_price or 0) for l in pq.lines))
    if pq.declared_vat is not None and base:
        if pq.declared_vat < 1000 or pq.declared_vat > base * 0.5:
            pq.declared_vat = None
    if pq.declared_total is not None and base and pq.declared_total < base * 0.9:
        pq.declared_total = None

    if pq.tax_rate is None and pq.declared_subtotal and pq.declared_vat:
        pq.tax_rate = round(pq.declared_vat / pq.declared_subtotal, 4)

    calc = sum((l.qty or 0) * (l.unit_price or 0) for l in pq.lines)
    subtotal = pq.declared_subtotal
    if subtotal is None and calc:
        pq.declared_subtotal = round(calc)
        subtotal = pq.declared_subtotal
    if subtotal and abs(calc - subtotal) > max(1000, subtotal * 0.005):
        pq.warnings.append(
            f"Tổng các dòng ({calc:,.0f}) lệch tổng khai báo ({subtotal:,.0f})"
        )
    if pq.declared_vat is not None and subtotal and pq.tax_rate:
        expected = round(subtotal * pq.tax_rate)
        if abs(expected - pq.declared_vat) > max(1000, expected * 0.01):
            pq.warnings.append(
                f"VAT tính lại ({expected:,.0f}) lệch VAT khai báo ({pq.declared_vat:,.0f})"
            )
    if not pq.buyer_tax_code:
        pq.warnings.append("Không tìm thấy mã số thuế người mua")
    if len(pq.lines) == 0:
        pq.warnings.append("Không nhận diện được dòng hàng hóa nào")
    return pq
