"""Tìm tương tự (fuzzy search) bằng rapidfuzz cho khách hàng và hàng hóa.

- Khách hàng: so tên công ty đã chuẩn hóa (bỏ dấu, chữ thường) với danh mục.
- Hàng hóa: KẾT HỢP mã/model và phần mô tả kỹ thuật thành một điểm duy nhất,
  thay vì chỉ so mã hoặc chỉ so tên như trước.

Không đụng tới DB: caller (Node API) gửi kèm danh mục, module chỉ chấm điểm.
Dùng ``token_set_ratio`` để tên đầy đủ dài hơn trên báo giá vẫn khớp tên ngắn
trong danh mục, và ``WRatio``/``partial_ratio`` cho trường hợp gõ sai/thiếu.
"""
from __future__ import annotations

import re

from rapidfuzz import fuzz

from . import text_utils as tu


def _norm_code(s: str) -> str:
    """Chuẩn hóa mã: bỏ dấu, bỏ mọi ký tự không phải chữ/số, viết thường.

    "LT - 040" và "lt040" -> "lt040"; "HD-270" -> "hd270".
    """
    return re.sub(r"[^a-z0-9]", "", tu.norm(s or ""))


def score_customer(query: str, name: str) -> float:
    """Điểm khớp tên công ty trong [0, 1]."""
    q = tu.norm(query or "")
    n = tu.norm(name or "")
    if not q or not n:
        return 0.0
    best = max(
        fuzz.token_set_ratio(q, n),
        fuzz.token_sort_ratio(q, n),
        fuzz.WRatio(q, n),
    )
    return round(best / 100.0, 4)


def customer_candidates(
    query: str,
    customers: list[dict],
    limit: int = 20,
    min_score: float = 0.3,
) -> list[dict]:
    scored = []
    for c in customers:
        s = score_customer(query, str(c.get("name", "")))
        if s >= min_score:
            scored.append((c, s))
    scored.sort(key=lambda x: x[1], reverse=True)
    return [
        {
            "id": c.get("id"),
            "name": c.get("name", ""),
            "taxCode": c.get("taxCode", ""),
            "score": s,
        }
        for c, s in scored[:limit]
    ]


_POWER_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*kw", re.I)


def _extract_power_kw(*texts: str) -> float | None:
    """Tìm công suất (kW) trong chuỗi: "P=1.5kw", "Công suất: 2,2 Kw", mã "LT-040-1.5kw".

    Nhiều mã trong cùng một dòng máy (LT-040-0.75kw / LT-040-1.5kw / LT-040-2.2kw…)
    chỉ khác nhau ở công suất; mô tả dài (số vòng/phút, lưu lượng, điện áp…) làm
    loãng điểm rapidfuzz nên các biến thể ra điểm gần như ngang nhau. Công suất là
    đặc trưng phân biệt rõ ràng nhất nên tách riêng ra so khớp.
    """
    for t in texts:
        if not t:
            continue
        m = _POWER_RE.search(tu.norm(str(t)))
        if m:
            try:
                return float(m.group(1).replace(",", "."))
            except ValueError:
                continue
    return None


def _literal_prefix(a: str, b: str) -> bool:
    """Một mã là tiền tố của mã kia theo ĐÚNG dạng viết (giữ dấu gạch ngang).

    Ký tự ngay sau phần tiền tố không được là chữ số, để "hd-270" không khớp
    nhầm "hd-2700". Hậu tố chữ/ký hiệu ("(tq)", "bgkhau", "-0.75kw") thì được.
    """
    if not a or not b:
        return False
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    if not long_.startswith(short):
        return False
    rest = long_[len(short):]
    return not rest or not rest[0].isdigit()


def _glued_digit_extension(short_norm: str, long_raw: str) -> bool:
    """Mã dài có kéo dài mã ngắn bằng chữ số DÍNH LIỀN không?

    `short_norm` là mã ngắn đã chuẩn hóa (chỉ chữ/số), `long_raw` là mã dài giữ
    nguyên dấu phân cách. "hd270" với "hd-2700" -> True (số 0 dính liền);
    "lt040" với "lt-040-1.5kw" -> False (có dấu '-' ngăn cách phần công suất).
    """
    if not short_norm or not short_norm[-1].isdigit():
        return False
    count = 0
    for i, ch in enumerate(long_raw):
        if re.fullmatch(r"[a-z0-9]", ch):
            count += 1
            if count == len(short_norm):
                nxt = long_raw[i + 1 : i + 2]
                return nxt.isdigit()
    return False


def _code_score(line_model: str, product_code: str) -> float:
    """Điểm khớp mã hàng trong [0, 1].

    Thang điểm (giữ nguyên dạng viết của model, gồm cả dấu gạch ngang):
      - giống hệt sau khi bỏ khoảng trắng            -> 1.0   ("HD-270" = "HD-270")
      - cùng dạng viết, là tiền tố của mã kia         -> 0.97  ("HD-270" ~ "HD-270(TQ)")
      - chỉ khớp sau khi bỏ ký tự đặc biệt (tiền tố)  -> ≤ 0.9  ("HD-270" ~ "HD270")
      - như trên nhưng bị kéo dài bằng chữ số dính liền -> ≤ 0.6  ("HD-270" ~ "HD-2700")
      - còn lại                                       -> ≤ 0.7
    "HD-270" ≠ "HD270": mã viết đúng dạng của báo giá luôn đứng trên mã chỉ
    giống sau khi chuẩn hóa. Mã cùng gốc nhưng khác biến thể ("LT-050" so với
    "LT-050-0.75KW") không bao giờ được 1.0, để thông số kỹ thuật còn phân định.
    """
    raw_a = re.sub(r"\s+", "", tu.norm(line_model or ""))
    raw_b = re.sub(r"\s+", "", tu.norm(product_code or ""))
    a = _norm_code(line_model)
    b = _norm_code(product_code)
    if not a or not b:
        return 0.0
    if raw_a and raw_a == raw_b:
        return 1.0
    ratio = fuzz.ratio(a, b) / 100.0
    partial = fuzz.partial_ratio(a, b) / 100.0
    if _literal_prefix(raw_a, raw_b):
        return 0.97
    prefix = b.startswith(a) or a.startswith(b)
    if prefix:
        if a != b:
            short_n, long_raw = (a, raw_b) if len(a) <= len(b) else (b, raw_a)
            if _glued_digit_extension(short_n, long_raw):
                # "HD-270" so với "HD-2700": hai model khác nhau, không phải
                # cùng một mã viết khác dấu -> thấp hơn hẳn "HD270".
                return round(min(0.6, max(ratio, partial) * 0.6), 4)
        return round(min(0.9, max(ratio, partial) * 0.9), 4)
    return round(min(0.7, max(ratio, partial) * 0.7), 4)


def _model_in_name(line_model: str, product_name: str) -> bool:
    """Model báo giá xuất hiện NGUYÊN VẸN trong tên hàng (khi cột mã là mã nội bộ).

    Ví dụ model "HJW 600-400-3" nằm trong tên "Bình chứa clo ... HJW 600-400-3"
    (mã nội bộ "Binh500"). Giữ dấu gạch ngang; ký tự ngay trước/sau phải không
    phải chữ/số và phần sau không được là "-xxx" (tránh nhầm "HD-270" với
    "HD-2700" hay "HD-270-0.75kw"). Model quá ngắn/không có chữ số bị bỏ qua.
    """
    model = tu.norm(line_model or "").strip()
    name = tu.norm(product_name or "")
    if len(model) < 4 or not any(ch.isdigit() for ch in model) or not name:
        return False
    parts = [re.escape(p) for p in re.findall(r"[a-z]+|\d+|[^a-z\d\s]", model)]
    pattern = r"(?<![a-z0-9])" + r"\s*".join(parts) + r"(?![a-z0-9])(?!-[a-z0-9])"
    return re.search(pattern, name) is not None


def _text_score(line_name: str, line_spec: str, product_name: str) -> float:
    q = tu.norm(" ".join(x for x in (line_name or "", line_spec or "") if x))
    p = tu.norm(product_name or "")
    if not q or not p:
        return 0.0
    best = max(
        fuzz.token_set_ratio(q, p),
        fuzz.token_sort_ratio(q, p),
        fuzz.partial_ratio(q, p),
    )
    return round(best / 100.0, 4)


def _combine(code_score: float, text_score: float, power_match: bool | None) -> float:
    """Gộp điểm mã + điểm mô tả thành một điểm duy nhất.

    Mã hàng là khoá chính (theo nghiệp vụ), mô tả bổ trợ khi mã mờ/thiếu:
      - mã khớp tuyệt đối            -> 1.0
      - không có mã trên báo giá     -> dựa chủ yếu vào mô tả (0.8 × text)
      - mã khớp một phần             -> 0.6 × mã + 0.4 × mô tả

    `power_match`: cả báo giá lẫn mã hàng cùng đọc được công suất (kW) —
    True nếu trùng (đẩy lên gần như chắc chắn, phân định đúng biến thể),
    False nếu khác nhau (loại khỏi biến thể đó dù mô tả còn lại giống hệt),
    None nếu không đọc được công suất ở một trong hai bên (không đổi điểm).
    """
    if code_score >= 0.999:
        return 1.0
    if code_score <= 0:
        base = round(0.8 * text_score, 4)
    else:
        base = round(0.6 * code_score + 0.4 * text_score, 4)
    if power_match is True:
        return round(min(0.99, base + 0.25), 4)
    if power_match is False:
        return round(base * 0.3, 4)
    return base


def product_candidates(
    lines: list[dict],
    products: list[dict],
    limit: int = 20,
    min_score: float = 0.3,
) -> list[list[dict]]:
    """Trả, với MỖI dòng báo giá, danh sách ứng viên hàng hóa đã xếp hạng."""
    out: list[list[dict]] = []
    for line in lines:
        line_power = _extract_power_kw(
            str(line.get("model", "")), str(line.get("name", "")), str(line.get("spec", ""))
        )
        scored = []
        for p in products:
            cs = _code_score(str(line.get("model", "")), str(p.get("code", "")))
            # Chỉ khi cột mã KHÔNG liên quan model (mã nội bộ như "Binh500"). Nếu mã đã
            # khớp một phần (vd "LT-040-1.5KW" với model "LT-040") thì để thông số
            # (công suất...) phân định biến thể, không nâng tất cả lên 1.0.
            if cs < 0.9 and _model_in_name(str(line.get("model", "")), str(p.get("name", ""))):
                cs = 1.0
            ts = _text_score(
                str(line.get("name", "")),
                str(line.get("spec", "")),
                str(p.get("name", "")),
            )
            product_power = _extract_power_kw(str(p.get("code", "")), str(p.get("name", "")))
            power_match = (
                None
                if line_power is None or product_power is None
                else abs(line_power - product_power) < 0.01
            )
            combined = _combine(cs, ts, power_match)
            if combined >= min_score:
                scored.append((p, combined, cs, ts))
        scored.sort(key=lambda x: x[1], reverse=True)
        out.append(
            [
                {
                    "id": p.get("id"),
                    "code": p.get("code", ""),
                    "name": p.get("name", ""),
                    "unit": p.get("unit", ""),
                    "score": combined,
                    "codeScore": cs,
                    "textScore": ts,
                }
                for p, combined, cs, ts in scored[:limit]
            ]
        )
    return out
