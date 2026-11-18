import argon2 from 'argon2';

export const hashPassword = (plain: string) =>
  argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

export const verifyPassword = async (hash: string, plain: string): Promise<boolean> => {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
};

/** Kiểm tra độ mạnh: >= 8 ký tự, có chữ và số. Trả danh sách lỗi (rỗng = đạt). */
export function passwordProblems(pw: string): string[] {
  const problems: string[] = [];
  if (pw.length < 8) problems.push('Mật khẩu phải có ít nhất 8 ký tự');
  if (!/[A-Za-zÀ-ỹ]/.test(pw)) problems.push('Mật khẩu phải có ít nhất một chữ cái');
  if (!/\d/.test(pw)) problems.push('Mật khẩu phải có ít nhất một chữ số');
  return problems;
}
