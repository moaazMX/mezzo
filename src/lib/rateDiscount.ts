import { supabase } from './supabase';

export const RATE_SETTING_KEYS = {
  loginPassword: 'rate_page_password',
  settingsPassword: 'rate_settings_password',
  percent: 'item_rate_discount_percent',
} as const;

export interface RateSettings {
  percent: number;
}

export interface RatePasswordSettings {
  loginPassword: string;
  settingsPassword: string;
}

export interface RateItemLike {
  quantity: number;
  subtotal: number;
  rate_discount_percent?: number | null;
}

export interface OrderRateStats {
  totalDiscountAmount: number;
}

export function getEffectiveItemPercent(item: RateItemLike, fallbackPercent: number): number {
  const stored = item.rate_discount_percent;
  if (stored != null && stored > 0) return stored;
  return fallbackPercent > 0 ? fallbackPercent : 0;
}

/** مبلغ الخصم لصنف واحد = نسبة × subtotal */
export function calcItemDiscountAmount(item: RateItemLike, fallbackPercent: number): number {
  const pct = getEffectiveItemPercent(item, fallbackPercent);
  if (pct <= 0) return 0;
  return Math.round((item.subtotal * pct) / 100);
}

export function calcOrderRateStats(items: RateItemLike[], fallbackPercent: number): OrderRateStats {
  let totalDiscountAmount = 0;
  for (const item of items) {
    totalDiscountAmount += calcItemDiscountAmount(item, fallbackPercent);
  }
  return { totalDiscountAmount };
}

export async function fetchRateSettings(): Promise<RateSettings> {
  const { data } = await supabase
    .from('settings')
    .select('key, value')
    .eq('key', RATE_SETTING_KEYS.percent)
    .maybeSingle();

  const percent = data ? parseInt(data.value, 10) : 25;

  return {
    percent: Number.isFinite(percent) && percent > 0 ? percent : 25,
  };
}

export async function fetchRatePagePassword(): Promise<string> {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', RATE_SETTING_KEYS.loginPassword)
    .maybeSingle();

  return data?.value || 'moaazMXpl011#';
}

export async function fetchRateSettingsPassword(): Promise<string> {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', RATE_SETTING_KEYS.settingsPassword)
    .maybeSingle();

  return data?.value || (await fetchRatePagePassword());
}

async function upsertSetting(key: string, value: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('settings')
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function updateRateSettings(
  updates: Partial<RateSettings>,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  const stored = await fetchRateSettingsPassword();
  if (password !== stored) {
    return { ok: false, error: 'كلمة مرور تعديل النسب غير صحيحة' };
  }

  if (updates.percent != null) {
    if (updates.percent <= 0 || updates.percent > 100) {
      return { ok: false, error: 'نسبة الخصم يجب أن تكون بين 1 و 100' };
    }
    const result = await upsertSetting(RATE_SETTING_KEYS.percent, String(updates.percent));
    if (!result.ok) {
      return result;
    }
  }

  return { ok: true };
}

export async function updateRateLoginPassword(
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  const stored = await fetchRatePagePassword();
  if (currentPassword !== stored) {
    return { ok: false, error: 'كلمة مرور تسجيل الدخول الحالية غير صحيحة' };
  }
  if (newPassword.length < 4) {
    return { ok: false, error: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل' };
  }
  return upsertSetting(RATE_SETTING_KEYS.loginPassword, newPassword);
}

export async function updateRateSettingsPassword(
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  const stored = await fetchRateSettingsPassword();
  if (currentPassword !== stored) {
    return { ok: false, error: 'كلمة مرور تعديل النسب الحالية غير صحيحة' };
  }
  if (newPassword.length < 4) {
    return { ok: false, error: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل' };
  }
  return upsertSetting(RATE_SETTING_KEYS.settingsPassword, newPassword);
}

export function getWeekKey(dateIso: string): string {
  const d = new Date(dateIso);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

export function getMonthKey(dateIso: string): string {
  return dateIso.slice(0, 7);
}

export function formatWeekLabel(weekKey: string): string {
  const start = new Date(weekKey);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (dt: Date) =>
    dt.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
}
