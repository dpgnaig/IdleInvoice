from __future__ import annotations

import os
import tempfile

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .base import QuoteParser
from .excel_parser import ExcelTableParser
from .models import HealthResponse, ParsedQuote
from .pdf_parser import PdfTableParser

MAX_FILE_MB = float(os.environ.get("MAX_FILE_MB", "10"))
INTERNAL_KEY = os.environ.get("INTERNAL_KEY", "")
LLM_FALLBACK_ENABLED = os.environ.get("LLM_FALLBACK_ENABLED", "false").lower() == "true"

PARSERS: list[QuoteParser] = [ExcelTableParser(), PdfTableParser()]

app = FastAPI(title="IdleInvoice Parser", version="0.1.0")


def check_internal_key(x_internal_key: str | None = Header(default=None)) -> None:
    if not INTERNAL_KEY:
        return  # dev không cấu hình key: cho qua
    if x_internal_key != INTERNAL_KEY:
        raise HTTPException(status_code=401, detail="Sai X-Internal-Key")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


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
        return JSONResponse(
            status_code=422,
            content={
                "error": "Định dạng file không hỗ trợ",
                "error_code": "UNSUPPORTED_FORMAT",
                "message": f"Chỉ hỗ trợ .pdf, .xlsx, .xls (nhận: {name})",
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


@app.post("/parse-file-path")
def parse_file_path() -> JSONResponse:
    return JSONResponse(status_code=404, content={"error": "Dùng /parse với multipart file"})


def _tmp() -> str:
    fd, path = tempfile.mkstemp(prefix="idleinvoice-")
    os.close(fd)
    return path
