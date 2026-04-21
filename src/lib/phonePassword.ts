/** Salt bundled in app — same string must be used when verifying */
const APP_SALT = 'mezzo-phone-auth-v1';
const RECOVERY_SALT = 'mezzo-phone-recovery-v1';

export async function hashPhonePassword(phone: string, password: string): Promise<string> {
  const normalized = `${phone.trim()}|${password}|${APP_SALT}`;
  const enc = new TextEncoder().encode(normalized);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashRecoveryCode(phone: string, code: string): Promise<string> {
  const normalized = `${phone.trim()}|${code.trim()}|${RECOVERY_SALT}`;
  const enc = new TextEncoder().encode(normalized);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateEasyRecoveryCode(): string {
  // 6 digits easy to type & remember
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}
