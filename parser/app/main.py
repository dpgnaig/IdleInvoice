from __future__ import annotations

import os
import tempfile

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .base import QuoteParser
from .docx_parser import DocParser, DocxTableParser, read_docx, read_word
from .excel_parser import ExcelTableParser
from .models import (
    HealthResponse,
    MatchCustomersRequest,
    MatchCustomersResponse,
    MatchProductsRequest,
    MatchProductsResponse,
    ParsedQuote,
    PreviewDoc,
    PreviewSheet,
)
from .pdf_parser import PdfTableParser
from . import fuzzy
from . import table_reader as tr

MAX_FILE_MB = float(os.environ.get("MAX_FILE_MB", "10"))
INTERNAL_KEY = os.environ.get("INTERNAL_KEY", "")
LLM_FALLBACK_ENABLED = os.environ.get("LLM_FALLBACK_ENABLED", "false").lower() == "true"

PARSERS: list[QuoteParser] = [ExcelTableParser(), DocxTableParser(), DocParser(), PdfTableParser()]

# Xem trước chỉ để đọc bằng mắt — chặn kích thước để trình duyệt không treo
PREVIEW_MAX_ROWS = 1200
PREVIEW_MAX_COLS = 40

app = FastAPI(title="IdleInvoice Parser", version="0.1.0")


def check_internal_key(x_internal_key: str | None = Header(default=None)) -> None:
    if not INTERNAL_KEY:
        return  # dev không cấu hình key: cho qua
    if x_internal_key != INTERNAL_KEY:
        raise HTTPException(status_code=401, detail="Sai X-Internal-Key")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.post("/match/customers", response_model=MatchCustomersResponse)
def match_customers(
    req: MatchCustomersRequest,
    _auth: None = Depends(check_internal_key),
) -> MatchCustomersResponse:
    """Xếp hạng tên công ty gần giống bằng rapidfuzz (dùng cho ghép khách hàng)."""
    candidates = fuzzy.customer_candidates(
        req.query, req.customers, limit=max(1, min(req.limit, 200)), min_score=req.min_score
    )
    return MatchCustomersResponse(candidates=candidates)


@app.post("/match/products", response_model=MatchProductsResponse)
def match_products(
    req: MatchProductsRequest,
    _auth: None = Depends(check_internal_key),
) -> MatchProductsResponse:
    """Ghép từng dòng báo giá với danh mục, kết hợp mã hàng + mô tả kỹ thuật."""
    lines = fuzzy.product_candidates(
        req.lines, req.products, limit=max(1, min(req.limit, 200)), min_score=req.min_score
    )
    return MatchProductsResponse(lines=lines)


@app.post("/parse")
async def parse(
    file: UploadFile = File(...),
    _auth: None = Depends(check_internal_key),
) -> JSONResponse:
    name = file.filename or "upload.bin"
    data = await file.read()
    if len(data) > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File quá lớn (tối đa {MAX_FILE_MB:g} MB)")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="File rỗng")

    parser = next((p for p in PARSERS if p.can_parse(name)), None)
    if parser is None:
        hint = " Chỉ hỗ trợ .pdf, .xlsx, .xls, .doc, .docx."
        return JSONResponse(
            status_code=422,
            content={
                "error": "Định dạng file không hỗ trợ",
                "error_code": "UNSUPPORTED_FORMAT",
                "message": f"{hint} (nhận: {name})",
            },
        )
    try:
        result: ParsedQuote = parser.parse(data, name)
    except Exception as exc:  # noqa: BLE001 - parser không được crash service
        return JSONResponse(
            status_code=422,
            content={
                "error": "Không đọc được file",
                "error_code": "PARSE_FAILED",
                "message": str(exc)[:300],
            },
        )

    if LLM_FALLBACK_ENABLED:
        result.warnings.append(
            "LLM_FALLBACK_ENABLED=true: nội dung file có thể đã được gửi ra dịch vụ ngoài (Claude API)"
        )

    # NO_TEXT_LAYER: PDF scan không có text layer
    if result.warnings == ["NO_TEXT_LAYER"]:
        return JSONResponse(
            status_code=422,
            content={
                "error": "PDF không có text layer (file scan/ảnh)",
                "error_code": "NO_TEXT_LAYER",
                "message": "File PDF này là ảnh scan, chưa đọc được. Hãy dùng bản PDF gốc có text hoặc bật OCR.",
            },
        )
    return JSONResponse(status_code=200, content=result.model_dump())


def _preview_rows(rows: list[list[str]]) -> list[list[str]]:
    out: list[list[str]] = []
    for row in rows[:PREVIEW_MAX_ROWS]:
        trimmed = list(row[:PREVIEW_MAX_COLS])
        while trimmed and not trimmed[-1]:
            trimmed.pop()
        out.append(trimmed)
    while out and not any(out[-1]):
        out.pop()
    return out


@app.post("/preview", response_model=PreviewDoc)
async def preview(
    file: UploadFile = File(...),
    _auth: None = Depends(check_internal_key),
) -> PreviewDoc:
    """Trả dữ liệu thô (sheet/đoạn văn) để UI xem trước Excel và Word."""
    name = file.filename or "upload.bin"
    data = await file.read()
    if len(data) > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File quá lớn (tối đa {MAX_FILE_MB:g} MB)")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="File rỗng")

    lower = name.lower()
    try:
        if lower.endswith((".xlsx", ".xls")):
            sheets = [
                PreviewSheet(name=sheet_name, rows=_preview_rows(grid))
                for sheet_name, grid in tr.read_sheets_excel(data, name)
            ]
            return PreviewDoc(kind="excel", sheets=sheets)
        if lower.endswith((".docx", ".doc")):
            paragraphs, grids = read_word(data) if lower.endswith(".doc") else read_docx(data)
            return PreviewDoc(
                kind="word",
                sheets=[
                    PreviewSheet(name=f"Bảng {i + 1}", rows=_preview_rows(g))
                    for i, g in enumerate(grids)
                ],
                paragraphs=paragraphs[:PREVIEW_MAX_ROWS],
            )
        if lower.endswith(".pdf"):
            return PreviewDoc(kind="pdf")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Không đọc được file để xem trước: {str(exc)[:200]}")
    raise HTTPException(status_code=422, detail="Định dạng file không hỗ trợ xem trước")


@app.post("/parse-file-path")
def parse_file_path() -> JSONResponse:
    return JSONResponse(status_code=404, content={"error": "Dùng /parse với multipart file"})


def _tmp() -> str:
    fd, path = tempfile.mkstemp(prefix="idleinvoice-")
    os.close(fd)
    return path
