"""Đọc file Word 97-2003 (.doc) bằng Python thuần (olefile), không cần LibreOffice.

Trả về cùng dạng với ``docx_parser.read_docx``: (các đoạn văn, các bảng dạng grid).

1. Mở container OLE, lấy stream ``WordDocument`` và ``0Table``/``1Table``.
2. FIB cho biết độ dài văn bản chính (ccpText), vị trí CLX và PlcfBtePapx.
3. CLX (piece table) cho biết chữ nằm ở đâu: cp1252 (1 byte) hoặc UTF-16.
4. PAPX (thuộc tính đoạn) cho biết đoạn nào nằm trong bảng, đâu là hết dòng bảng
   và ranh giới cột (TDefTable), nhờ đó dựng grid đúng cột khi có ô gộp.

Giới hạn: bảng lồng nhau được làm phẳng thành chữ trong ô ngoài; không đọc
header/footer, text box, file Word 6/95 hoặc file đặt mật khẩu.
"""
from __future__ import annotations

import io
import struct
from bisect import bisect_right
from dataclasses import dataclass

import olefile

# Ranh giới cột lệch nhau không quá ngần này (twip, ~0,07 cm) coi là cùng một cột.
COL_TOLERANCE = 40

SPRM_PFINTABLE = 0x2416
SPRM_PFTTP = 0x2417
SPRM_PITAP = 0x6649
SPRM_PCHGTABS = 0xC615
SPRM_TDEFTABLE = 0xD608

# Kích thước toán hạng theo 3 bit cao (spra) của mã sprm; spra=6 có độ dài thay đổi.
_SPRA_SIZE = {0: 1, 1: 1, 2: 2, 3: 4, 4: 2, 5: 2, 7: 3}

_VERT_MERGE = 0x20  # ô gộp dọc với ô phía trên
_VERT_RESTART = 0x40  # ô đầu của một vùng gộp dọc


class DocReadError(RuntimeError):
    """File .doc không đọc được (hỏng, có mật khẩu hoặc định dạng quá cũ)."""


def _u16(b: bytes, o: int) -> int:
    return struct.unpack_from('<H', b, o)[0]


def _u32(b: bytes, o: int) -> int:
    return struct.unpack_from('<I', b, o)[0]


@dataclass
class _Piece:
    cp_start: int
    cp_end: int
    fc: int  # offset byte trong stream WordDocument
    unit: int  # 1 = cp1252 (nén), 2 = UTF-16LE


@dataclass
class _Row:
    cells: list[str]
    xs: list[int] | None  # ranh giới cột (twip), len = số ô + 1
    vflags: list[int] | None  # cờ TC từng ô (gộp dọc)


def _cell_text(text: str) -> str:
    return ' '.join((text or '').split())


def _read_streams(data: bytes) -> tuple[bytes, bytes]:
    if data[:8] != olefile.MAGIC:
        raise DocReadError('Không phải file .doc (Word 97-2003)')
    ole = olefile.OleFileIO(io.BytesIO(data))
    try:
        if not ole.exists('WordDocument'):
            raise DocReadError('File .doc thiếu stream WordDocument')
        wd = ole.openstream('WordDocument').read()
        if len(wd) < 0x20 or _u16(wd, 0) != 0xA5EC:
            raise DocReadError('Header Word không hợp lệ')
        flags = _u16(wd, 0x0A)
        if flags & 0x0100:
            raise DocReadError('File .doc đặt mật khẩu nên không đọc được')
        name = '1Table' if flags & 0x0200 else '0Table'
        if not ole.exists(name):
            raise DocReadError('File .doc thiếu stream ' + name)
        return wd, ole.openstream(name).read()
    finally:
        ole.close()


def _parse_fib(wd: bytes) -> tuple[int, tuple[int, int], tuple[int, int]]:
    """Trả (ccpText, (fc, lcb) của PlcfBtePapx, (fc, lcb) của CLX)."""
    if _u16(wd, 2) < 0x65:
        raise DocReadError('File Word 6/95 quá cũ, chưa hỗ trợ')
    pos = 32
    csw = _u16(wd, pos)
    pos += 2 + csw * 2
    cslw = _u16(wd, pos)
    pos += 2
    ccp_text = _u32(wd, pos + 12)
    pos += cslw * 4
    cb_rg = _u16(wd, pos)
    base = pos + 2
    if cb_rg < 34:
        raise DocReadError('FIB thiếu vị trí CLX')
    papx = struct.unpack_from('<II', wd, base + 13 * 8)
    clx = struct.unpack_from('<II', wd, base + 33 * 8)
    return ccp_text, papx, clx


def _read_pieces(tbl: bytes, fc: int, lcb: int) -> list[_Piece]:
    clx = tbl[fc:fc + lcb]
    i = 0
    while i < len(clx):
        kind = clx[i]
        if kind == 1:  # Prc: bỏ qua
            i += 3 + _u16(clx, i + 1)
        elif kind == 2:  # Pcdt chứa PlcPcd
            size = _u32(clx, i + 1)
            return _pieces_from_plc(clx[i + 5:i + 5 + size])
        else:
            break
    raise DocReadError('Không tìm thấy piece table (CLX) trong file .doc')


def _pieces_from_plc(plc: bytes) -> list[_Piece]:
    n = (len(plc) - 4) // 12
    cps = struct.unpack_from('<%dI' % (n + 1), plc, 0)
    base = 4 * (n + 1)
    pieces = []
    for k in range(n):
        raw = _u32(plc, base + 8 * k + 2)
        if raw & 0x40000000:
            fc, unit = (raw & 0x3FFFFFFF) // 2, 1
        else:
            fc, unit = raw & 0x3FFFFFFF, 2
        pieces.append(_Piece(cps[k], cps[k + 1], fc, unit))
    return pieces


def _read_text(wd: bytes, pieces: list[_Piece], ccp_text: int) -> str:
    """Văn bản chính; mỗi ký tự ứng đúng một cp (giữ nguyên độ dài để tra PAPX)."""
    parts = []
    for p in pieces:
        n = min(p.cp_end, ccp_text) - p.cp_start
        if n <= 0:
            continue
        if p.unit == 1:
            s = wd[p.fc:p.fc + n].decode('cp1252', errors='replace')
        else:
            m = max(min(n, (len(wd) - p.fc) // 2), 0)
            s = ''.join(map(chr, struct.unpack_from('<%dH' % m, wd, p.fc)))
        parts.append(s.ljust(n, '�'))
    return ''.join(parts)


def _parse_sprms(grpprl: bytes) -> dict[int, bytes]:
    out: dict[int, bytes] = {}
    i, n = 0, len(grpprl)
    try:
        while i + 2 <= n:
            op = _u16(grpprl, i)
            i += 2
            spra = op >> 13
            if spra != 6:
                size = _SPRA_SIZE[spra]
                out[op] = grpprl[i:i + size]
                i += size
            elif op == SPRM_TDEFTABLE:
                cb = _u16(grpprl, i)  # cb tính cả 1 byte; toán hạng bắt đầu sau 2 byte cb
                out[op] = grpprl[i + 2:i + 1 + cb]
                i += cb + 1
            else:
                size = grpprl[i]
                if op == SPRM_PCHGTABS and size == 255:
                    j = i + 1
                    j += 1 + 4 * grpprl[j]
                    j += 1 + 3 * grpprl[j]
                    out[op] = grpprl[i + 1:j]
                    i = j
                else:
                    out[op] = grpprl[i + 1:i + 1 + size]
                    i += 1 + size
    except (IndexError, struct.error):
        pass  # sprm cuối bị cắt: giữ những sprm đã đọc được
    return out


class _Papx:
    """Tra thuộc tính đoạn (sprm) theo vị trí file (fc) qua các FKP."""

    def __init__(self, wd: bytes, tbl: bytes, fc: int, lcb: int) -> None:
        plc = tbl[fc:fc + lcb]
        n = max((len(plc) - 4) // 8, 0)
        runs: list[tuple[int, int, bytes]] = []
        for k in range(n):
            pn = _u32(plc, 4 * (n + 1) + 4 * k) & 0x3FFFFF
            page = wd[pn * 512:(pn + 1) * 512]
            if len(page) < 512:
                continue
            crun = page[511]
            for r in range(crun):
                start = _u32(page, 4 * r)
                end = _u32(page, 4 * (r + 1))
                bx = page[4 * (crun + 1) + 13 * r]
                grp = b''
                if bx:
                    off = bx * 2
                    cb = page[off]
                    if cb == 0:
                        body = page[off + 2:off + 2 + page[off + 1] * 2]
                    else:
                        body = page[off + 1:off + 2 * cb]
                    grp = body[2:]  # bỏ istd
                runs.append((start, end, grp))
        runs.sort(key=lambda x: x[0])
        self._runs = runs
        self._starts = [r[0] for r in runs]

    def __bool__(self) -> bool:
        return bool(self._runs)

    def sprms(self, fc: int) -> dict[int, bytes]:
        i = bisect_right(self._starts, fc) - 1
        if i < 0:
            return {}
        start, end, grp = self._runs[i]
        return _parse_sprms(grp) if start <= fc < end else {}


def _parse_tdef(operand: bytes | None) -> tuple[list[int] | None, list[int] | None]:
    """TDefTable -> (ranh giới cột, cờ TC từng ô)."""
    if not operand or operand[0] == 0:
        return None, None
    itc = operand[0]
    need = 1 + 2 * (itc + 1)
    if len(operand) < need:
        return None, None
    xs = list(struct.unpack_from('<%dh' % (itc + 1), operand, 1))
    flags = []
    for k in range(itc):
        o = need + 20 * k
        flags.append(_u16(operand, o) if o + 2 <= len(operand) else 0)
    return xs, flags


def _build_grid(rows: list[_Row]) -> list[list[str]]:
    """Dựng grid: ô đặt theo ranh giới cột chung, phần ô gộp để trống.

    Cùng quy ước với ``read_docx``: gộp ngang để trống, gộp dọc lấp giá trị từ trên xuống.
    """
    bounds = sorted({x for r in rows if r.xs for x in r.xs})
    cols: list[int] = []
    for x in bounds:
        if not cols or x - cols[-1] > COL_TOLERANCE:
            cols.append(x)

    def col_of(x: int) -> int:
        return max(bisect_right(cols, x) - 1, 0)

    placed: list[list[int]] = []
    ncols = 0
    for r in rows:
        pos: list[int] = []
        for i in range(len(r.cells)):
            if r.xs and i < len(r.xs) - 1:
                c = col_of(r.xs[i])
            else:
                c = pos[-1] + 1 if pos else 0
            pos.append(c)
        if pos:
            ncols = max(ncols, max(pos) + 1)
        placed.append(pos)

    grid: list[list[str]] = []
    prev: dict[int, str] = {}
    for r, pos in zip(rows, placed):
        line = [''] * ncols
        for i, (txt, c) in enumerate(zip(r.cells, pos)):
            fl = r.vflags[i] if r.vflags and i < len(r.vflags) else 0
            if not txt and fl & _VERT_MERGE and not fl & _VERT_RESTART:
                txt = prev.get(c, '')
            if txt:
                prev[c] = txt
            line[c] = (line[c] + ' ' + txt).strip() if line[c] else txt
        if any(line):
            grid.append(line)
    return grid


def _flag(sp: dict[int, bytes], op: int) -> bool:
    v = sp.get(op)
    return bool(v and v[0])


def read_doc(data: bytes) -> tuple[list[str], list[list[list[str]]]]:
    """Trả (các đoạn văn ngoài bảng, các bảng dạng grid) từ nội dung file .doc."""
    try:
        return _read_doc(data)
    except DocReadError:
        raise
    except (struct.error, IndexError, ValueError, OSError) as exc:
        raise DocReadError('File .doc hỏng hoặc có cấu trúc chưa hỗ trợ') from exc


def _read_doc(data: bytes) -> tuple[list[str], list[list[list[str]]]]:
    wd, tbl = _read_streams(data)
    ccp_text, (fc_papx, lcb_papx), (fc_clx, lcb_clx) = _parse_fib(wd)
    pieces = _read_pieces(tbl, fc_clx, lcb_clx)
    text = _read_text(wd, pieces, ccp_text)
    papx = _Papx(wd, tbl, fc_papx, lcb_papx)
    if not papx:
        raise DocReadError('File .doc không có thuộc tính đoạn (PAPX)')
    starts = [p.cp_start for p in pieces]

    def fc_of(cp: int) -> int:
        p = pieces[max(bisect_right(starts, cp) - 1, 0)]
        return p.fc + (cp - p.cp_start) * p.unit

    paragraphs: list[str] = []
    grids: list[list[list[str]]] = []
    rows: list[_Row] = []
    row_cells: list[str] = []
    cell_paras: list[str] = []
    cur: list[str] = []
    fields: list[bool] = []  # True = đang ở phần mã lệnh của field (bỏ qua)
    last_def: tuple[list[int] | None, list[int] | None] = (None, None)

    def flush_table() -> None:
        nonlocal rows, row_cells, cell_paras
        if row_cells:
            rows.append(_Row(row_cells, None, None))
        if rows:
            grid = _build_grid(rows)
            if grid:
                grids.append(grid)
        rows, row_cells, cell_paras = [], [], []

    for cp, ch in enumerate(text):
        if ch == '\x13':
            fields.append(True)
            continue
        if ch == '\x14':
            if fields:
                fields[-1] = False
            continue
        if ch == '\x15':
            if fields:
                fields.pop()
            continue
        if any(fields):
            continue

        if ch in '\r\x07\x0c':
            sp = papx.sprms(fc_of(cp))
            in_table = _flag(sp, SPRM_PFINTABLE)
            itap = int.from_bytes(sp.get(SPRM_PITAP, b'')[:4], 'little')
            nested = itap > 1
            if ch == '\x0c' and in_table:
                cur.append(' ')
            elif in_table and ch == '\x07' and not nested and _flag(sp, SPRM_PFTTP):
                xs, vflags = _parse_tdef(sp.get(SPRM_TDEFTABLE))
                if xs:
                    last_def = (xs, vflags)
                rows.append(_Row(row_cells, xs, vflags))
                row_cells, cell_paras, cur = [], [], []
            elif ch == '\x07' and not in_table and row_cells and not ''.join(cur).strip():
                # Dấu hết hàng bị mất thuộc tính bảng (một số file .doc): coi là hết hàng,
                # không ngắt bảng; dùng lại ranh giới cột của hàng trước.
                rows.append(_Row(row_cells, last_def[0], last_def[1]))
                row_cells, cell_paras, cur = [], [], []
            elif in_table and ch == '\x07' and not nested:
                cell_paras.append(''.join(cur))
                cur = []
                row_cells.append(_cell_text(' '.join(cell_paras)))
                cell_paras = []
            elif in_table:  # hết đoạn trong ô, hoặc ô của bảng lồng nhau
                cell_paras.append(''.join(cur))
                cur = []
            else:
                if rows or row_cells:
                    flush_table()
                s = _cell_text(''.join(cur))
                cur = []
                if s:
                    paragraphs.append(s)
            continue

        if ch in '\x0b\x09':
            cur.append(' ')
        elif ch == '\x1e':
            cur.append('-')
        elif ch >= ' ' and not '\ud800' <= ch <= '\udfff':
            cur.append(ch)

    s = _cell_text(''.join(cur))
    if s and not (rows or row_cells):
        paragraphs.append(s)
    flush_table()
    return paragraphs, grids
