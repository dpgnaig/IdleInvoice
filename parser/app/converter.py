"""Chuyển file Office cũ sang định dạng mới để UI xem trước: .xls -> .xlsx, .doc -> .docx.

Chỉ phục vụ hiển thị (không dùng cho parse) và không cần LibreOffice:
- .xls: xlrd đọc giá trị + định dạng cơ bản (font, màu nền, viền, ô gộp, độ rộng cột), openpyxl ghi.
- .doc: doc_reader đọc chữ và bảng, python-docx ghi. Chưa giữ được định dạng chữ và vị trí xen kẽ
  giữa đoạn văn với bảng (đoạn văn ra trước, bảng ra sau).
"""
from __future__ import annotations

import io
import re

from .doc_reader import read_doc

MAX_ROWS = 5000
MAX_COLS = 100

XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

_H_ALIGN = {1: 'left', 2: 'center', 3: 'right'}
_V_ALIGN = {0: 'top', 1: 'center', 2: 'bottom'}
_BORDER = {1: 'thin', 2: 'medium', 3: 'dashed', 4: 'dotted', 5: 'thick', 6: 'double', 7: 'hair'}
_CTRL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')
_BAD_SHEET_CHARS = re.compile(r'[\[\]:*?/\\]')


def _clean(text: str) -> str:
    return _CTRL.sub('', text or '')


def _rgb(book, idx) -> str | None:
    # Chỉ số >= 64 (64, 0x7FFF) là màu mặc định của hệ thống
    if idx is None or idx >= 64:
        return None
    rgb = book.colour_map.get(idx)
    return '%02X%02X%02X' % rgb if rgb else None


def _style_for(book, xf_index: int, cache: dict):
    if xf_index in cache:
        return cache[xf_index]
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    xf = book.xf_list[xf_index]
    font = book.font_list[xf.font_index]
    fmt = book.format_map.get(xf.format_key)

    xl_font = Font(
        name=font.name or None,
        size=(font.height / 20) or None,
        bold=bool(font.bold),
        italic=bool(font.italic),
        underline='single' if font.underline_type else None,
        color=_rgb(book, font.colour_index),
    )
    fill = None
    if xf.background.fill_pattern == 1:
        colour = _rgb(book, xf.background.pattern_colour_index)
        if colour:
            fill = PatternFill('solid', fgColor=colour)
    align = Alignment(
        horizontal=_H_ALIGN.get(xf.alignment.hor_align),
        vertical=_V_ALIGN.get(xf.alignment.vert_align),
        wrap_text=bool(xf.alignment.text_wrapped),
    )
    b = xf.border

    def side(style: int, colour: int) -> Side:
        s = _BORDER.get(style)
        return Side(style=s, color=_rgb(book, colour)) if s else Side()

    border = Border(
        left=side(b.left_line_style, b.left_colour_index),
        right=side(b.right_line_style, b.right_colour_index),
        top=side(b.top_line_style, b.top_colour_index),
        bottom=side(b.bottom_line_style, b.bottom_colour_index),
    )
    visible = fill is not None or any(
        _BORDER.get(s) for s in (b.left_line_style, b.right_line_style, b.top_line_style, b.bottom_line_style)
    )
    result = (xl_font, fill, align, border, fmt.format_str if fmt else 'General', visible)
    cache[xf_index] = result
    return result


def xls_to_xlsx(data: bytes) -> bytes:
    if data[:2] == b'PK':  # đặt đuôi .xls nhưng thực chất là .xlsx
        return data
    import xlrd
    from openpyxl import Workbook
    from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
    from openpyxl.utils import get_column_letter

    try:
        book = xlrd.open_workbook(file_contents=data, formatting_info=True)
        styled = True
    except Exception:  # noqa: BLE001 - một số file không đọc được định dạng: bỏ định dạng, giữ giá trị
        book = xlrd.open_workbook(file_contents=data)
        styled = False

    wb = Workbook()
    wb.remove(wb.active)
    cache: dict = {}
    empty = (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK)

    for sh in book.sheets():
        title = _BAD_SHEET_CHARS.sub('_', sh.name or '')[:31] or 'Sheet'
        ws = wb.create_sheet(title=title)
        nrows, ncols = min(sh.nrows, MAX_ROWS), min(sh.ncols, MAX_COLS)

        for r in range(nrows):
            for c in range(ncols):
                ctype = sh.cell_type(r, c)
                style = _style_for(book, sh.cell_xf_index(r, c), cache) if styled else None
                if ctype in empty and not (style and style[5]):
                    continue
                value = sh.cell_value(r, c)
                if ctype in empty:
                    value = None
                elif ctype == xlrd.XL_CELL_DATE:
                    try:
                        value = xlrd.xldate.xldate_as_datetime(value, book.datemode)
                    except Exception:  # noqa: BLE001
                        pass
                elif ctype == xlrd.XL_CELL_BOOLEAN:
                    value = bool(value)
                elif ctype == xlrd.XL_CELL_ERROR:
                    value = xlrd.error_text_from_code.get(value, '#ERR')
                elif isinstance(value, str):
                    value = ILLEGAL_CHARACTERS_RE.sub('', value)
                cell = ws.cell(row=r + 1, column=c + 1)
                if value is not None:
                    cell.value = value
                if style:
                    cell.font = style[0]
                    if style[1] is not None:
                        cell.fill = style[1]
                    cell.alignment = style[2]
                    cell.border = style[3]
                    cell.number_format = style[4]

        for rlo, rhi, clo, chi in getattr(sh, 'merged_cells', []) or []:
            if rlo < nrows and clo < ncols:
                ws.merge_cells(
                    start_row=rlo + 1,
                    end_row=min(rhi, nrows),
                    start_column=clo + 1,
                    end_column=min(chi, ncols),
                )
        if styled:
            for c, info in sh.colinfo_map.items():
                if c < ncols:
                    dim = ws.column_dimensions[get_column_letter(c + 1)]
                    if info.width:
                        dim.width = info.width / 256
                    dim.hidden = bool(info.hidden)
            for r, info in sh.rowinfo_map.items():
                if r < nrows:
                    dim = ws.row_dimensions[r + 1]
                    if info.height:
                        dim.height = info.height / 20
                    dim.hidden = bool(info.hidden)
            ws.sheet_view.showGridLines = bool(getattr(sh, 'show_grid_lines', 1))

    if not wb.worksheets:
        wb.create_sheet('Sheet')
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def doc_to_docx(data: bytes) -> bytes:
    if data[:2] == b'PK':  # đặt đuôi .doc nhưng thực chất là .docx
        return data
    from docx import Document

    paragraphs, grids = read_doc(data)
    document = Document()
    for text in paragraphs:
        document.add_paragraph(_clean(text))
    for grid in grids:
        ncols = max((len(row) for row in grid), default=0)
        if not ncols:
            continue
        document.add_paragraph()
        table = document.add_table(rows=len(grid), cols=ncols)
        table.style = 'Table Grid'
        for i, row in enumerate(grid):
            for j, text in enumerate(row):
                table.cell(i, j).text = _clean(text)
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()
