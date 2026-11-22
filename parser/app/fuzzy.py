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


def _code_score(line_model: str, product_code: str) -> float:
    """Điểm khớp mã hàng trong [0, 1].

    Trùng khớp tuyệt đối chỉ khi mã (sau khi bỏ khoảng trắng) giống hệt nhau —
    "HD-270" ≠ "HD270". Mã cùng gốc nhưng khác biến thể ("LT-050" so với
    "LT-050-0.75KW") chỉ được điểm cao, KHÔNG phải 1.0, để thông số kỹ thuật
    còn phân định biến thể đúng.
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
    prefix = b.startswith(a) or a.startswith(b)
    if prefix:
        return round(min(0.95, max(ratio, partial) * 0.95), 4)
    return round(min(0.7, max(ratio, partial) * 0.7), 4)


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
