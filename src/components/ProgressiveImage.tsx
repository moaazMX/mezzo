import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { getOptimizedImageUrl, type ImagePreset } from '../lib/imageUrl';

interface ProgressiveImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string;
  preset?: ImagePreset;
  /** Load full-resolution original after showing the lightweight thumb (item detail modal). */
  upgradeOnMount?: boolean;
  onImageError?: () => void;
  wrapperClassName?: string;
}

export default function ProgressiveImage({
  src,
  preset = 'card',
  upgradeOnMount = false,
  onImageError,
  className = '',
  wrapperClassName = '',
  alt = '',
  loading = 'lazy',
  onLoad,
  ...rest
}: ProgressiveImageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(loading === 'eager');
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const [upgradedLoaded, setUpgradedLoaded] = useState(false);

  const lowSrc = getOptimizedImageUrl(src, upgradeOnMount ? 'card' : preset);
  const fullSrc = src;
  const needsUpgrade = upgradeOnMount && lowSrc !== fullSrc;

  useEffect(() => {
    setBroken(false);
    setLoaded(false);
    setUpgradedLoaded(false);
  }, [src, preset, upgradeOnMount]);

  useEffect(() => {
    if (shouldLoad || loading === 'eager') return;

    const node = wrapperRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: '280px 0px', threshold: 0.01 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldLoad, loading]);

  useEffect(() => {
    if (!needsUpgrade || !shouldLoad || broken) return;

    let cancelled = false;
    const preload = new Image();
    preload.onload = () => {
      if (!cancelled) setUpgradedLoaded(true);
    };
    preload.src = fullSrc;

    return () => {
      cancelled = true;
      preload.onload = null;
    };
  }, [needsUpgrade, shouldLoad, fullSrc, broken]);

  const handleError = () => {
    setBroken(true);
    onImageError?.();
  };

  if (broken) return null;

  return (
    <div ref={wrapperRef} className={`relative overflow-hidden ${wrapperClassName}`.trim()}>
      {!loaded && (
        <div
          aria-hidden
          className="absolute inset-0 animate-pulse bg-gradient-to-br from-white/[0.06] to-white/[0.02]"
        />
      )}
      {shouldLoad && (
        <>
          <img
            src={lowSrc}
            alt={alt}
            loading={loading}
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={(event) => {
              setLoaded(true);
              event.currentTarget.classList.add('is-loaded');
              onLoad?.(event);
            }}
            onError={handleError}
            className={`img-fade ${className}`.trim()}
            {...rest}
          />
          {needsUpgrade && upgradedLoaded && (
            <img
              src={fullSrc}
              alt={alt}
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={(event) => {
                event.currentTarget.classList.add('is-loaded');
              }}
              className={`img-fade absolute inset-0 w-full h-full object-cover ${className}`.trim()}
              {...rest}
            />
          )}
        </>
      )}
    </div>
  );
}
