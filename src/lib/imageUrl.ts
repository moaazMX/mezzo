export type ImagePreset = 'thumb' | 'card' | 'modal' | 'full';

function parseSupabasePublicPath(url: string): { origin: string; path: string } | null {
  try {
    const parsed = new URL(url);
    const objectMatch = parsed.pathname.match(/^\/storage\/v1\/object\/public\/(.+)$/);
    if (objectMatch) {
      return { origin: parsed.origin, path: objectMatch[1] };
    }
  } catch {
    /* ignore invalid URLs */
  }

  return null;
}

/** Companion thumb uploaded alongside full webp images (items/foo.webp → items/foo_thumb.webp). */
export function getThumbCompanionUrl(url: string): string | null {
  const supabasePath = parseSupabasePublicPath(url);
  if (!supabasePath) return null;
  if (!supabasePath.path.endsWith('.webp') || supabasePath.path.endsWith('_thumb.webp')) {
    return null;
  }

  const thumbPath = supabasePath.path.replace(/\.webp$/, '_thumb.webp');
  return `${supabasePath.origin}/storage/v1/object/public/${thumbPath}`;
}

/** Returns the fastest URL for the requested display size. Never uses Supabase render API (avoids failed double-fetch on free tier). */
export function getOptimizedImageUrl(url: string, preset: ImagePreset = 'card'): string {
  if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/')) {
    return url;
  }

  if (preset === 'thumb' || preset === 'card') {
    const thumbUrl = getThumbCompanionUrl(url);
    if (thumbUrl) return thumbUrl;
  }

  if (url.includes('unsplash.com')) {
    try {
      const parsed = new URL(url);
      const width = preset === 'thumb' ? 112 : preset === 'card' ? 420 : 1280;
      const quality = preset === 'thumb' ? 50 : preset === 'card' ? 55 : 82;
      parsed.searchParams.set('w', String(width));
      parsed.searchParams.set('q', String(quality));
      parsed.searchParams.set('auto', 'format');
      return parsed.toString();
    } catch {
      /* fall through */
    }
  }

  return url;
}
