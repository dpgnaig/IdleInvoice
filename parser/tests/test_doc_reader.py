"""Test hồi quy cho ``app.doc_reader`` (đọc file .doc).

Không commit file .doc thật của khách hàng; thay vào đó giả lập các hàm đọc luồng
bên trong để dựng chuỗi ký tự + thuộc tính đoạn (PAPX) theo từng vị trí ký tự.
"""
from __future__ import annotations

import struct

import pytest

import app.doc_reader as d

CELL = '\x07'
PARA = '\r'

# TDefTable: 2 ô, ranh giới 0 / 1000 / 5000 twip, mỗi ô có 20 byte TC (cờ = 0)
TDEF = bytes([2]) + struct.pack('<3h', 0, 1000, 5000) + b'\x00' * 40

IN_CELL = {d.SPRM_PFINTABLE: b'\x01'}
ROW_END = {d.SPRM_PFINTABLE: b'\x01', d.SPRM_PFTTP: b'\x01', d.SPRM_TDEFTABLE: TDEF}
PLAIN: dict[int, bytes] = {}


class _FakePapx:
    def __init__(self, props: dict[int, dict[int, bytes]]):
        self._props = props

    def __bool__(self) -> bool:
        return True

    def sprms(self, fc: int) -> dict[int, bytes]:
        return self._props.get(fc, {})


def _run(monkeypatch: pytest.MonkeyPatch, segments: list[tuple[str, dict[int, bytes]]]):
    """segments: (chuỗi ký tự, thuộc tính áp cho ký tự kết thúc chuỗi)."""
    text = ''.join(s for s, _ in segments)
    props: dict[int, dict[int, bytes]] = {}
    pos = 0
    for s, sp in segments:
        pos += len(s)
        props[pos - 1] = sp
    piece = d._Piece(cp_start=0, cp_end=len(text), fc=0, unit=1)
    monkeypatch.setattr(d, '_read_streams', lambda data: (b'', b''))
    monkeypatch.setattr(d, '_parse_fib', lambda wd: (len(text), (0, 0), (0, 0)))
    monkeypatch.setattr(d, '_read_pieces', lambda tbl, fc, lcb: [piece])
    monkeypatch.setattr(d, '_read_text', lambda wd, pieces, ccp: text)
    monkeypatch.setattr(d, '_Papx', lambda *a: _FakePapx(props))
    return d.read_doc(b'')


def _cells(*texts: str) -> list[tuple[str, dict[int, bytes]]]:
    return [(t + CELL, IN_CELL) for t in texts]


def test_normal_table_and_paragraph(monkeypatch):
    segs = [('Hợp đồng' + PARA, PLAIN)]
    segs += _cells('STT', 'Tên hàng') + [(CELL, ROW_END)]
    segs += _cells('1', 'Máy bơm') + [(CELL, ROW_END)]
    segs += [('Cuối' + PARA, PLAIN)]
    paras, grids = _run(monkeypatch, segs)
    assert paras == ['Hợp đồng', 'Cuối']
    assert grids == [[['STT', 'Tên hàng'], ['1', 'Máy bơm']]]


def test_orphan_row_end_does_not_split_table(monkeypatch):
    """Dấu hết hàng mất thuộc tính bảng (đông dương.DOC) không được cắt bảng."""
    segs = _cells('STT', 'Tên hàng') + [(CELL, ROW_END)]
    segs += _cells('1', 'Máy bơm') + [(CELL, PLAIN)]  # dấu hết hàng mồ côi
    segs += _cells('2', 'Máy nén') + [(CELL, ROW_END)]
    paras, grids = _run(monkeypatch, segs)
    assert paras == []
    assert grids == [[['STT', 'Tên hàng'], ['1', 'Máy bơm'], ['2', 'Máy nén']]]


def test_empty_cell_is_not_mistaken_for_row_end(monkeypatch):
    """Ô trống bình thường (vẫn có thuộc tính trong bảng) không bị coi là hết hàng."""
    segs = _cells('STT', 'Tên hàng') + [(CELL, ROW_END)]
    segs += _cells('3', '') + [(CELL, ROW_END)]
    _, grids = _run(monkeypatch, segs)
    assert grids == [[['STT', 'Tên hàng'], ['3', '']]]
