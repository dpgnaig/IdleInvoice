import sys, xlrd

path = sys.argv[1]
wb = xlrd.open_workbook(path)
print("SHEETS:", wb.sheet_names())
for ws in wb.sheets():
    print(f"===== {ws.name} rows={ws.nrows} cols={ws.ncols}")
    for r in range(min(ws.nrows, 45)):
        vals = []
        for c in range(ws.ncols):
            v = ws.cell_value(r, c)
            if isinstance(v, float) and v == int(v):
                v = int(v)
            vals.append(str(v))
        if all(x.strip() == "" for x in vals):
            continue
        print(r + 1, "|", " | ".join(x[:45] for x in vals))
