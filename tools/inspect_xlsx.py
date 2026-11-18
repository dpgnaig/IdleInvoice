import sys, openpyxl

path = sys.argv[1]
wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
print("SHEETS:", wb.sheetnames)
for ws in wb.worksheets:
    print(f"===== {ws.title}")
    for i, row in enumerate(ws.iter_rows(values_only=True), 1):
        vals = [(c if c is not None else "") for c in row]
        if all(str(v).strip() == "" for v in vals):
            continue
        print(i, "|", " | ".join(str(v)[:45] for v in vals))
        if i > 40:
            print("... (cut)")
            break
