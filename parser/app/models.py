"""Pydantic models cho ParsedQuote trả về từ parser service."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Confidence = Literal["high", "medium", "low"]


class FieldValue(BaseModel):
    value: str | float | int | None = None
    confidence: Confidence = "medium"


class QuoteLine(BaseModel):
    line_no: int
    name: str
    unit: str = ""
    qty: float | None = None
    unit_price: int | None = None
    amount: int | None = None
    model: str = ""
    brand: str = ""
    origin: str = ""
    spec_text: str = ""
    confidence: Confidence = "medium"


class ParsedQuote(BaseModel):
    buyer_name: str = ""
    buyer_name_confidence: Confidence = "low"
    buyer_tax_code: str = ""
    buyer_tax_code_confidence: Confidence = "low"
    quote_no: str = ""
    quote_no_confidence: Confidence = "low"
    quote_date: str = ""  # ISO yyyy-mm-dd hoặc ""
    quote_date_confidence: Confidence = "low"
    sender_name: str = ""
    receiver_name: str = ""
    lines: list[QuoteLine] = Field(default_factory=list)
    declared_subtotal: int | None = None
    declared_vat: int | None = None
    declared_total: int | None = None
    tax_rate: float | None = None
    payment_terms: str = ""
    validity_days: int | None = None
    warnings: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    ok: bool = True
    service: str = "parser"


class PreviewSheet(BaseModel):
    name: str = ""
    rows: list[list[str]] = Field(default_factory=list)


class PreviewDoc(BaseModel):
    """Dữ liệu thô để UI xem trước file Excel/Word giống PDF."""

    kind: Literal["excel", "word", "pdf"] | str = ""
    sheets: list[PreviewSheet] = Field(default_factory=list)
    paragraphs: list[str] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    error: str
    error_code: str
    message: str


# ---------- Tìm tương tự (rapidfuzz) ----------


class CustomerCandidate(BaseModel):
    id: int | None = None
    name: str = ""
    taxCode: str = ""
    score: float = 0.0


class MatchCustomersRequest(BaseModel):
    query: str = ""
    customers: list[dict] = Field(default_factory=list)
    limit: int = 20
    min_score: float = 0.3


class MatchCustomersResponse(BaseModel):
    candidates: list[CustomerCandidate] = Field(default_factory=list)


class ProductCandidate(BaseModel):
    id: int | None = None
    code: str = ""
    name: str = ""
    unit: str = ""
    score: float = 0.0
    codeScore: float = 0.0
    textScore: float = 0.0


class MatchProductsRequest(BaseModel):
    lines: list[dict] = Field(default_factory=list)
    products: list[dict] = Field(default_factory=list)
    limit: int = 20
    min_score: float = 0.3


class MatchProductsResponse(BaseModel):
    # Ứng viên xếp hạng cho từng dòng, giữ đúng thứ tự dòng gửi lên.
    lines: list[list[ProductCandidate]] = Field(default_factory=list)
