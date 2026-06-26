import { supabase } from './supabase';

export function normalizePhoneDigits(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

/** Picks one row when legacy duplicates exist; prefers the account with the most orders. */
export async function findCustomerIdByPhone(phoneRaw: string): Promise<string | null> {
  const phone = normalizePhoneDigits(phoneRaw);
  if (!phone) return null;

  const { data, error } = await supabase
    .from('customers')
    .select('id')
    .eq('phone', phone)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('findCustomerIdByPhone:', error);
    return null;
  }

  return data?.[0]?.id ?? null;
}

export async function findCustomerAuthByPhone(phoneRaw: string): Promise<{
  id: string;
  phone_password_hash: string | null;
  phone_password_owner_fingerprint: string | null;
  name?: string | null;
} | null> {
  const phone = normalizePhoneDigits(phoneRaw);
  if (!phone) return null;

  const { data, error } = await supabase
    .from('customers')
    .select('id, name, phone_password_hash, phone_password_owner_fingerprint')
    .eq('phone', phone)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('findCustomerAuthByPhone:', error);
    return null;
  }

  return data?.[0] ?? null;
}

export async function findCustomerSummaryByPhone(phoneRaw: string): Promise<{
  id: string;
  name: string | null;
  device_fingerprint: string | null;
} | null> {
  const phone = normalizePhoneDigits(phoneRaw);
  if (!phone) return null;

  const { data, error } = await supabase
    .from('customers')
    .select('id, name, device_fingerprint')
    .eq('phone', phone)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('findCustomerSummaryByPhone:', error);
    return null;
  }

  return data?.[0] ?? null;
}

const isUniqueViolation = (error: { code?: string } | null) => error?.code === '23505';

/** Update existing customer by phone or insert once; never creates a second row for the same phone. */
export async function ensureCustomerByPhone(
  phoneRaw: string,
  fields: Record<string, unknown>
): Promise<string | null> {
  const phone = normalizePhoneDigits(phoneRaw);
  if (!phone) return null;

  const existingId = await findCustomerIdByPhone(phone);
  const payload = {
    ...fields,
    phone,
    updated_at: new Date().toISOString()
  };

  if (existingId) {
    const { data, error } = await supabase
      .from('customers')
      .update(payload)
      .eq('id', existingId)
      .select('id')
      .single();
    if (error) throw error;
    return data?.id ?? existingId;
  }

  const { data, error } = await supabase
    .from('customers')
    .insert([payload])
    .select('id')
    .single();

  if (!error) return data?.id ?? null;

  if (isUniqueViolation(error)) {
    const retryId = await findCustomerIdByPhone(phone);
    if (!retryId) return null;
    const { data: updated, error: updateError } = await supabase
      .from('customers')
      .update(payload)
      .eq('id', retryId)
      .select('id')
      .single();
    if (updateError) throw updateError;
    return updated?.id ?? retryId;
  }

  throw error;
}
