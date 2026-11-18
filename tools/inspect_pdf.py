import sys, pdfplumber

path = sys.argv[1]
with pdfplumber.open(path) as pdf:
    print("PAGES:", len(pdf.pages))
    for pi, page in enumerate(pdf.pages[:2]):
        print(f"--- page {pi+1} size={page.width}x{page.height}")
        text = page.extract_text() or ""
        print(text[:3000])
        tables = page.extract_tables()
        print("TABLES:", len(tables))
        for t in tables[:2]:
            for row in t[:15]:
                print(row)
