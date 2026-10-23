import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export function passwordIssues(password: string): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'password_too_short';
  if (password.length > 200) return 'password_too_long';
  return null;
}
