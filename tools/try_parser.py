"""Chạy parser trên các file mẫu và in kết quả tóm tắt. Usage: python -I tools/try_parser.py <file>..."""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "parser"))

from app.excel_parser import ExcelTableParser  # noqa: E402
from app.pdf_parser import PdfTableParser  # noqa: E402

for f in sys.argv[1:]:
    data = pathlib.Path(f).read_bytes()
    p = PdfTableParser() if f.lower().endswith(".pdf") else ExcelTableParser()
    r = p.parse(data, pathlib.Path(f).name)
    print("====", f)
    print(f"  buyer={r.buyer_name!r} mst={r.buyer_tax_code!r} no={r.quote_no!r} date={r.quote_date!r}")
    print(f"  sender={r.sender_name!r} receiver={r.receiver_name!r} validity={r.validity_days} pay={r.payment_terms!r}")
    print(f"  sub={r.declared_subtotal} vat={r.declared_vat} total={r.declared_total} tax={r.tax_rate}")
    for l in r.lines:
        print(f"   #{l.line_no} {l.name[:40]!r} | {l.unit} qty={l.qty} price={l.unit_price} amt={l.amount} model={l.model!r} brand={l.brand!r} origin={l.origin!r} spec_lines={len(l.spec_text.splitlines())}")
    print("  warnings:", r.warnings)
