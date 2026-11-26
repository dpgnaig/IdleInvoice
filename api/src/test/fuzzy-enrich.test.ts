import { afterAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';

const env = setupTestEnv();
// import sau khi env đã set
const { __fuzzyInternals } = await import('../services/fuzzy-enrich.js');
const { lineConfident } = __fuzzyInternals;

type Cand = Parameters<typeof lineConfident>[0][number];

function cand(code: string, score: number, codeScore: number): Cand {
  return {
    id: 1,
    code,
    name: 'Đĩa',
    unit: 'Cái',
    score,
    codeScore,
    textScore: 0.9,
  } as unknown as Cand;
}

afterAll(() => env.cleanup());

describe('lineConfident (dòng có model)', () => {
  it('mã trùng khít dạng viết (HD-270 = HD-270) -> tự gắn', () => {
    expect(lineConfident([cand('HD-270', 1.0, 1.0)], true)).toBe(true);
  });

  it('biến thể hậu tố cùng dạng viết (HD-270 ~ HD-270(TQ)) -> tự gắn', () => {
    expect(lineConfident([cand('HD-270(TQ)', 0.97, 0.97)], true)).toBe(true);
  });

  it('chỉ khác ký tự đặc biệt (HD270 ~ HD-270, codeScore 0.9) -> KHÔNG tự gắn, chỉ gợi ý', () => {
    expect(lineConfident([cand('HD-270', 0.92, 0.9)], true)).toBe(false);
  });

  it('mã trùng khít + biến thể sát điểm (HD-270 vs HD-270A) -> vẫn chọn mã trùng khít', () => {
    expect(
      lineConfident([cand('HD-270', 1.0, 1.0), cand('HD-270A', 0.98, 0.97)], true),
    ).toBe(true);
  });

  it('hai biến thể sát điểm, không mã nào trùng khít -> không tự gắn', () => {
    expect(
      lineConfident([cand('HD-270(TQ)', 0.97, 0.97), cand('HD-270(VN)', 0.96, 0.97)], true),
    ).toBe(false);
  });

  it('hai mã đều trùng khít -> không tự gắn (mơ hồ)', () => {
    expect(
      lineConfident([cand('HD-270', 1.0, 1.0), cand('HD-270', 1.0, 1.0)], true),
    ).toBe(false);
  });

  it('điểm gộp thấp dù codeScore cao -> không tự gắn', () => {
    expect(lineConfident([cand('HD-270', 0.8, 0.97)], true)).toBe(false);
  });

  it('không có ứng viên -> false', () => {
    expect(lineConfident([], true)).toBe(false);
  });
});

describe('lineConfident (dòng không có model)', () => {
  it('không bị ảnh hưởng bởi codeScore, chỉ cần điểm gộp >= 0.72', () => {
    expect(lineConfident([cand('HD-270', 0.75, 0)], false)).toBe(true);
    expect(lineConfident([cand('HD-270', 0.7, 0)], false)).toBe(false);
  });
});
