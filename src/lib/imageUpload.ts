import type { SupabaseClient } from '@supabase/supabase-js';
import { prepareItemImageUpload } from './compressImage';
import { getThumbCompanionUrl } from './imageUrl';

const IMAGE_CACHE_CONTROL = '31536000';

export async function uploadItemImage(supabase: SupabaseClient, file: File): Promise<string> {
  const { full, thumb } = await prepareItemImageUpload(file);
  const baseName = `item_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const fullPath = `items/${baseName}.webp`;
  const thumbPath = `items/${baseName}_thumb.webp`;

  const [fullUpload, thumbUpload] = await Promise.all([
    supabase.storage.from('item-images').upload(fullPath, full, {
      cacheControl: IMAGE_CACHE_CONTROL,
      upsert: false,
      contentType: 'image/webp',
    }),
    supabase.storage.from('item-images').upload(thumbPath, thumb, {
      cacheControl: IMAGE_CACHE_CONTROL,
      upsert: false,
      contentType: 'image/webp',
    }),
  ]);

  if (fullUpload.error) throw fullUpload.error;
  if (thumbUpload.error) throw thumbUpload.error;

  const { data } = supabase.storage.from('item-images').getPublicUrl(fullPath);
  return data.publicUrl;
}

export function isItemImageOptimized(imageUrl: string): boolean {
  return Boolean(getThumbCompanionUrl(imageUrl));
}

/** Re-compress an existing remote item image into webp + thumb pair. */
export async function reoptimizeRemoteItemImage(
  supabase: SupabaseClient,
  imageUrl: string
): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error('تعذّر تحميل الصورة الحالية');
  }

  const blob = await response.blob();
  const file = new File([blob], 'item-source.jpg', { type: blob.type || 'image/jpeg' });
  return uploadItemImage(supabase, file);
}
