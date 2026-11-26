"""Đọc bảng hàng hóa từ các "grid" (mảng 2 chiều chuỗi) của Excel/PDF.

Dò tiêu đề theo từ khóa (không theo vị trí cố định), gộp dòng mô tả vào dòng
hàng phía trên, nhận diện dòng tổng/VAT để không bị coi là hàng hóa.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from .models import ParsedQuote, QuoteLine
from . import text_utils as tu

HEADER_KEYWORDS: dict[str, list[str]] = {
    "line_no": ["tt", "stt", "so tt", "sott"],
    "name": [
        "thong so ky thuat",
        "thong tin ky thuat",
        "thong tin thiet bi",
        "thong tin hang hoa",
        "thong tin san pham",
        "chung loai",
        "ten hang",
        "ten thiet bi",
        "ten hang hoa",
        "ten san pham",
        "ten mat hang",
        "ten vat tu",
        "ten dich vu",
        "ten cong viec",
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
    # "S/L", "SL.", "Số lg" là cách viết tắt phổ biến trong báo giá Word/Excel
    "qty": ["so luong", "sl", "s/l", "sl.", "slg", "so lg", "khoi luong"],
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


FIELD_LABELS: dict[str, str] = {
    "line_no": "STT",
    "name": "tên hàng",
    "model": "model",
    "brand": "hãng",
    "origin": "xuất xứ",
    "desc": "mô tả",
    "unit": "đơn vị tính",
    "qty": "số lượng",
    "unit_price": "đơn giá",
    "amount": "thành tiền",
}


@dataclass
class HeaderMatch:
    """Kết quả dò tiêu đề: map field -> cột, kèm các cột cũng khớp (mơ hồ)."""

    mapping: dict[str, int]
    # field -> các cột khác cũng khớp từ khoá (kể cả cột đã chọn ở vị trí đầu)
    ambiguous: dict[str, list[int]] = field(default_factory=dict)


def score_header_detail(cells: list[str]) -> HeaderMatch | None:
    """Như ``score_header`` nhưng kèm danh sách cột trùng từ khoá.

    Nhiều cột cùng khớp một field (vd "Đơn giá trước CK" và "Đơn giá sau CK")
    là nguồn gây đọc sai giá lớn nhất — phần cảnh báo dùng ``ambiguous`` để báo
    cho người dùng biết code đã chọn cột nào.
    """
    keys = [tu.norm(c) for c in cells]
    mapping: dict[str, int] = {}
    ambiguous: dict[str, list[int]] = {}
    used: set[int] = set()
    for fld, words in HEADER_KEYWORDS.items():
        exact = EXACT_ONLY.get(fld, set())
        # Ưu tiên khớp nguyên ô, sau đó tới khớp chứa (từ khoá dài >= 4 ký tự).
        # Vẫn giữ thứ tự này khi chọn cột, nhưng gom cả hai loại để báo mơ hồ.
        exact_hits = [i for i, k in enumerate(keys) if k and any(k == w for w in words)]
        sub_hits = [
            i
            for i, k in enumerate(keys)
            if k
            and i not in exact_hits
            and any(len(w) >= 4 and w not in exact and w in k for w in words)
        ]
        cands = [i for i in exact_hits + sub_hits if i not in used]
        if not cands:
            continue
        mapping[fld] = cands[0]
        used.add(cands[0])
        if len(cands) > 1:
            ambiguous[fld] = cands
    if "name" not in mapping:
        return None
    if not {"qty", "unit_price", "amount"} & set(mapping):
        return None
    return HeaderMatch(mapping, ambiguous)


def score_header(cells: list[str]) -> dict[str, int] | None:
    """Trả map field -> chỉ số cột nếu dòng này là tiêu đề bảng hàng hóa."""
    hm = score_header_detail(cells)
    return hm.mapping if hm else None


def find_table_header(grid: list[list[str]], max_scan: int = 40) -> tuple[int, dict[str, int], dict[str, list[int]]] | None:
    """Dò dòng tiêu đề. Trả (chỉ số dòng tiêu đề cuối, mapping, ambiguous).

    Quét từng dòng trước; chỉ khi không dòng nào là tiêu đề mới thử ghép 2 dòng
    liền kề (tiêu đề 2 tầng: dòng nhóm + dòng "SL/Đơn giá/Thành tiền"). Giữ
    hành vi cũ cho file đã có tiêu đề 1 dòng để không phá kết quả hồi quy.
    """
    best: tuple[int, dict[str, int], dict[str, list[int]]] | None = None
    for i, row in enumerate(grid[:max_scan]):
        hm = score_header_detail(row)
        if hm and (best is None or len(hm.mapping) > len(best[1])):
            best = (i, hm.mapping, hm.ambiguous)
    if best is not None:
        return best

    limit = min(max_scan, len(grid) - 1)
    for i in range(max(0, limit)):
        r1, r2 = grid[i], grid[i + 1]
        width = max(len(r1), len(r2))
        r1 = r1 + [""] * (width - len(r1))
        r2 = r2 + [""] * (width - len(r2))
        combined = [f"{a} {b}".strip() for a, b in zip(r1, r2)]
        hm = score_header_detail(combined)
        if hm and (best is None or len(hm.mapping) > len(best[1])):
            # body bắt đầu sau dòng thứ hai của tiêu đề
            best = (i + 1, hm.mapping, hm.ambiguous)
    return best


def apply_header_warnings(
    pq: ParsedQuote, ambiguous: dict[str, list[int]], header_row: list[str]
) -> None:
    """Cảnh báo khi có nhiều cột cùng khớp một field (đã chọn cột đầu tiên)."""
    for fld, idxs in ambiguous.items():
        names = [(header_row[i] if i < len(header_row) else "").strip() for i in idxs]
        shown = ", ".join(n for n in names if n)
        label = FIELD_LABELS.get(fld, fld)
        if shown:
            pq.warnings.append(
                f"Nhiều cột cùng khớp '{label}': {shown} — đã chọn cột đầu tiên, kiểm tra lại giá"
            )


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
    """Ghi tổng khai báo, đối chiếu bằng số học thay vì tin nhãn.

    Báo giá đặt tên dòng tổng rất khác nhau ("TỔNG", "THÀNH TIỀN", "THÀNH TIỀN
    SAU VAT", "TỔNG CỘNG"…). Thay vì tin nhãn, gom mọi con số dòng tổng rồi suy
    ra: số nhỏ nhất là tạm tính, số lớn nhất là tổng sau VAT. Nhờ vậy
    "THÀNH TIỀN" (2,8tr, trước VAT) không còn bị nhầm là tổng thanh toán khi
    ngay dưới có "THÀNH TIỀN SAU VAT" (3,024tr).
    """
    vat = next((v for k, v in totals if k == "vat"), None)
    if vat is not None and pq.declared_vat is None:
        pq.declared_vat = vat

    money = sorted({v for k, v in totals if k in ("subtotal", "total") and v})
    if money:
        if len(money) >= 2:
            pq.declared_subtotal = money[0]
            pq.declared_total = money[-1]
        else:
            m = money[0]
            # Một con số duy nhất + có dòng VAT: hoặc là tổng sau VAT, hoặc là
            # tạm tính. Chọn cách hiểu có tạm tính gần tổng dòng nhất.
            line_sum = round(sum((l.qty or 0) * (l.unit_price or 0) for l in pq.lines))
            if pq.declared_vat and m > pq.declared_vat:
                after = (m - pq.declared_vat, m)      # M là tổng sau VAT
                before = (m, m + pq.declared_vat)     # M là tạm tính
                if line_sum and abs(before[0] - line_sum) < abs(after[0] - line_sum):
                    pq.declared_subtotal, pq.declared_total = before
                else:
                    pq.declared_subtotal, pq.declared_total = after
            else:
                pq.declared_subtotal = pq.declared_total = m

    # Hợp đồng nhiều mức thuế suất (vd VAT 8% + VAT 10%) có nhiều dòng VAT.
    # Chỉ cộng chúng khi tạm tính + tổng các dòng VAT khớp tổng khai báo, còn
    # dòng đầu đơn lẻ thì không khớp -> tránh cộng trùng khi một dòng VAT bị lặp.
    vats = [v for k, v in totals if k == "vat" and v]
    if len(vats) > 1 and pq.declared_subtotal and pq.declared_total:
        tol = max(1000, pq.declared_total * 0.0005)
        first_ok = abs(pq.declared_subtotal + vats[0] - pq.declared_total) <= tol
        sum_ok = abs(pq.declared_subtotal + sum(vats) - pq.declared_total) <= tol
        if sum_ok and not first_ok:
            pq.declared_vat = sum(vats)

    # Bù chéo khi thiếu hẳn một con số
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

    # read_only=False để có merged_cells (read-only không lấp được ô merge).
    wb = load_workbook(io.BytesIO(data), data_only=True)
    out: list[tuple[str, list[list[str]]]] = []
    for ws in wb.worksheets:
        rows, cols = ws.max_row or 0, ws.max_column or 0
        if rows > 5000 or cols > 80:
            # File lớn bất thường: đọc nhanh, bỏ qua lấp ô merge
            grid = []
            for row in ws.iter_rows(values_only=True):
                vals = [_norm_cell(v) for v in row]
                if any(vals):
                    grid.append(vals)
            if grid:
                out.append((ws.title or "Sheet", grid))
            continue

        # Chỉ lấp merge DỌC (vd tên nhóm hàng merge qua nhiều dòng). Merge
        # ngang thường chỉ để trình bày, lấp ra sẽ nhân đôi từ khoá tiêu đề.
        fill: dict[tuple[int, int], object] = {}
        for rng in ws.merged_cells.ranges:
            if rng.min_col != rng.max_col:
                continue
            anchor = ws.cell(row=rng.min_row, column=rng.min_col).value
            if anchor is None or str(anchor).strip() == "":
                continue
            for r in range(rng.min_row + 1, rng.max_row + 1):
                fill[(r, rng.min_col)] = anchor

        grid: list[list[str]] = []
        for ridx, row in enumerate(ws.iter_rows(min_row=1, max_row=rows, max_col=cols), start=1):
            vals = []
            for cidx, cell in enumerate(row, start=1):
                v = cell.value
                if v is None and (ridx, cidx) in fill:
                    v = fill[(ridx, cidx)]
                vals.append(_norm_cell(v))
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
        # (rlo, rhi, clo, chi) — lấp merge dọc như bản xlsx
        fill: dict[tuple[int, int], object] = {}
        for rlo, rhi, clo, chi in getattr(ws, "merged_cells", []) or []:
            if clo != chi - 1:
                continue
            anchor = ws.cell_value(rlo, clo)
            if anchor is None or str(anchor).strip() == "":
                continue
            for r in range(rlo + 1, rhi):
                fill[(r, clo)] = anchor

        grid: list[list[str]] = []
        for r in range(ws.nrows):
            row = []
            for c in range(ws.ncols):
                v = ws.cell_value(r, c)
                if (v is None or v == "") and (r, c) in fill:
                    v = fill[(r, c)]
                row.append(_norm_cell(v))
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


def _reconcile_line(l: QuoteLine, pq: ParsedQuote) -> None:
    """Đối chiếu SL × đơn giá với thành tiền; bù field thiếu; cảnh báo khi lệch.

    Sai cột giá (đọc nhầm cột "đơn giá" hay tự động nhân SL) là lỗi hay gặp
    nhất ở báo giá nhiều cột. Thay vì im lặng, dòng lệch được hạ confidence và
    báo kèm đơn giá suy ra để người dùng đối chiếu.
    """
    q, p, a = l.qty, l.unit_price, l.amount
    has_q = q is not None and q > 0
    has_p = p is not None and p > 0
    has_a = a is not None and a > 0

    if has_q and has_p and has_a:
        expected = round(q * p)
        if abs(expected - a) > max(1, a * 0.02):
            l.confidence = "low"
            pq.warnings.append(
                f"Dòng #{l.line_no} \"{l.name[:30]}\": SL×đơn giá ({expected:,.0f}) "
                f"lệch thành tiền ({a:,.0f}); đơn giá đúng có thể là {round(a / q):,.0f} — kiểm tra lại"
            )
        # Khớp thì giữ nguyên confidence gốc: dòng đọc từ text-fallback vốn
        # kém tin cậy hơn bảng có đường kẻ, không tự nâng lên "high".
        return

    # Thiếu 1 field -> suy ra bằng phép tính thay vì để trống
    if has_q and has_a and not has_p:
        l.unit_price = round(a / q)
        if l.confidence != "low":
            l.confidence = "medium"
    elif has_q and has_p and not has_a:
        l.amount = round(q * p)
        if l.confidence != "low":
            l.confidence = "medium"
    elif has_a and has_p and not has_q:
        l.qty = round(a / p, 4)
        if l.confidence != "low":
            l.confidence = "medium"


def finalize(pq: ParsedQuote) -> ParsedQuote:
    """Tính thuế suất, kiểm tra lệch tổng, sinh cảnh báo."""
    pq.lines = _dedupe_lines(pq.lines)
    for l in pq.lines:
        _reconcile_line(l, pq)

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
    # Nhiều mức thuế suất: nếu tạm tính + VAT khai báo khớp tổng khai báo thì dữ liệu
    # nhất quán, dùng thuế suất hiệu dụng thay vì nhân một mức với toàn bộ tạm tính.
    if (
        pq.declared_vat
        and subtotal
        and pq.declared_total
        and abs(subtotal + pq.declared_vat - pq.declared_total) <= max(1000, pq.declared_total * 0.0005)
    ):
        effective = round(pq.declared_vat / subtotal, 4)
        if pq.tax_rate and abs(effective - pq.tax_rate) > 0.0005:
            pq.tax_rate = effective
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
