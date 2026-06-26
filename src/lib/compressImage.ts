interface CompressOptions {
  maxWidth: number;
  maxHeight?: number;
  quality?: number;
  mimeType?: string;
}

async function loadImageBitmap(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode image'));
      el.src = objectUrl;
    });

    return createImageBitmap(img);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function compressImageFile(
  file: File,
  { maxWidth, maxHeight = maxWidth, quality = 0.8, mimeType = 'image/webp' }: CompressOptions
): Promise<File> {
  const bitmap = await loadImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    throw new Error('Canvas not supported');
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Compression failed'))),
      mimeType,
      quality
    );
  });

  const ext = mimeType === 'image/webp' ? 'webp' : 'jpg';
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
  return new File([blob], `${baseName}.${ext}`, { type: mimeType });
}

export async function prepareItemImageUpload(file: File): Promise<{ full: File; thumb: File }> {
  const full = await compressImageFile(file, {
    maxWidth: 960,
    quality: 0.85,
    mimeType: 'image/webp',
  });

  const thumb = await compressImageFile(file, {
    maxWidth: 360,
    quality: 0.75,
    mimeType: 'image/webp',
  });

  return { full, thumb };
}
