"""Sinh file .expected.json từ kết quả parser hiện tại của các file mẫu.

Chạy: python tests/make_expected.py  (từ thư mục parser/)
Sau đó soát lại nội dung JSON trước khi commit.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.excel_parser import ExcelTableParser  # noqa: E402
from app.pdf_parser import PdfTableParser  # noqa: E402

FIX = ROOT / "tests" / "fixtures"

for path in sorted(FIX.glob("*")):
    if path.suffix.lower() not in (".pdf", ".xls", ".xlsx"):
        continue
    if path.name in ("ExportFast.xlsx", "HĐ-_mẫu.xlsx"):
        continue  # file danh mục, không phải báo giá
    parser = PdfTableParser() if path.suffix.lower() == ".pdf" else ExcelTableParser()
    result = parser.parse(path.read_bytes(), path.name)
    out = FIX / (path.name + ".expected.json")
    out.write_text(json.dumps(result.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", out.name, "lines=", len(result.lines))
