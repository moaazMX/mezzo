import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

type Props = {
  images: string[];
  direction: 'horizontal' | 'vertical';
  auto: boolean;
  intervalSeconds: number;
  className?: string;
};

const SWIPE_THRESHOLD = 48;
const TRANSITION_MS = 700;

export default function HeaderSlideshow({
  images,
  direction,
  auto,
  intervalSeconds,
  className = '',
}: Props) {
  const count = images.length;
  const isVertical = direction === 'vertical';
  const hasLoop = count > 1;
  const extendedSlides = hasLoop ? [images[count - 1], ...images, images[0]] : images;

  const [index, setIndex] = useState(hasLoop ? 1 : 0);
  const [animate, setAnimate] = useState(true);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [viewportSize, setViewportSize] = useState(0);

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragOffsetRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const autoTimerRef = useRef<number | null>(null);
  const indexRef = useRef(hasLoop ? 1 : 0);
  const isTransitioningRef = useRef(false);
  const unlockTimerRef = useRef<number | null>(null);

  const realIndex = (idx: number) => {
    if (!hasLoop) return 0;
    if (idx === 0) return count - 1;
    if (idx === count + 1) return 0;
    return idx - 1;
  };

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // Preload every slide so fast swipes don't hit blank frames
  useEffect(() => {
    const unique = [...new Set(images.filter(Boolean))];
    unique.forEach((url) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
    });
  }, [images]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      setViewportSize(isVertical ? el.clientHeight : el.clientWidth);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isVertical]);

  useEffect(() => {
    const start = hasLoop ? 1 : 0;
    setIndex(start);
    indexRef.current = start;
    setAnimate(true);
    setDragOffset(0);
    dragOffsetRef.current = 0;
    isTransitioningRef.current = false;
  }, [images, direction, hasLoop]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const blockScroll = (e: TouchEvent) => {
      if (touchStartRef.current) e.preventDefault();
    };

    el.addEventListener('touchmove', blockScroll, { passive: false });
    return () => el.removeEventListener('touchmove', blockScroll);
  }, []);

  const clearUnlockTimer = useCallback(() => {
    if (unlockTimerRef.current !== null) {
      window.clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = null;
    }
  }, []);

  const unlockTransition = useCallback(() => {
    clearUnlockTimer();
    unlockTimerRef.current = window.setTimeout(() => {
      isTransitioningRef.current = false;
      unlockTimerRef.current = null;
    }, 40);
  }, [clearUnlockTimer]);

  const jumpInstant = useCallback((next: number) => {
    setAnimate(false);
    setIndex(next);
    indexRef.current = next;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimate(true));
    });
  }, []);

  const onLoopEdge = useCallback(() => {
    if (!hasLoop) return;
    const idx = indexRef.current;
    if (idx === 0) jumpInstant(count);
    else if (idx === count + 1) jumpInstant(1);
  }, [count, hasLoop, jumpInstant]);

  const onTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target !== trackRef.current || e.propertyName !== 'transform') return;
    onLoopEdge();
    unlockTransition();
  };

  useEffect(() => {
    if (!hasLoop) return;
    if (index !== 0 && index !== count + 1) return;
    const timer = window.setTimeout(() => {
      onLoopEdge();
      unlockTransition();
    }, TRANSITION_MS + 80);
    return () => window.clearTimeout(timer);
  }, [index, count, hasLoop, onLoopEdge, unlockTransition]);

  const moveBy = useCallback((delta: number) => {
    if (!hasLoop || isTransitioningRef.current) return false;
    isTransitioningRef.current = true;
    setAnimate(true);
    setIndex((prev) => prev + delta);
    return true;
  }, [hasLoop]);

  const advance = useCallback(() => moveBy(1), [moveBy]);
  const goBack = useCallback(() => moveBy(-1), [moveBy]);

  const goToDot = useCallback((dot: number) => {
    if (!hasLoop || isTransitioningRef.current) return;
    isTransitioningRef.current = true;
    setAnimate(true);
    setIndex(dot + 1);
  }, [hasLoop]);

  const clearAutoTimer = useCallback(() => {
    if (autoTimerRef.current !== null) {
      window.clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }, []);

  const scheduleAuto = useCallback(() => {
    clearAutoTimer();
    if (!auto || !hasLoop) return;
    autoTimerRef.current = window.setInterval(() => {
      if (!isTransitioningRef.current) advance();
    }, intervalSeconds * 1000);
  }, [advance, auto, clearAutoTimer, hasLoop, intervalSeconds]);

  useEffect(() => {
    scheduleAuto();
    return () => {
      clearAutoTimer();
      clearUnlockTimer();
    };
  }, [scheduleAuto, clearAutoTimer, clearUnlockTimer]);

  const bumpAutoAfterInteraction = useCallback(() => {
    scheduleAuto();
  }, [scheduleAuto]);

  const clampDrag = (delta: number) => {
    if (viewportSize <= 0) return delta;
    const max = viewportSize * 0.92;
    return Math.max(-max, Math.min(max, delta));
  };

  const baseOffsetPx = viewportSize > 0 ? index * viewportSize : 0;
  const dragTransform = isVertical
    ? `translate3d(0, ${-baseOffsetPx + dragOffset}px, 0)`
    : `translate3d(${-baseOffsetPx + dragOffset}px, 0, 0)`;

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!hasLoop || isTransitioningRef.current) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    dragOffsetRef.current = 0;
    setIsDragging(true);
    clearAutoTimer();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current || !hasLoop || isTransitioningRef.current) return;
    const t = e.touches[0];
    const raw = isVertical
      ? t.clientY - touchStartRef.current.y
      : t.clientX - touchStartRef.current.x;
    const delta = clampDrag(raw);
    dragOffsetRef.current = delta;
    setDragOffset(delta);
  };

  const finishTouch = () => {
    if (!touchStartRef.current || !hasLoop) {
      setIsDragging(false);
      dragOffsetRef.current = 0;
      setDragOffset(0);
      return;
    }

    const delta = dragOffsetRef.current;
    if (delta <= -SWIPE_THRESHOLD) advance();
    else if (delta >= SWIPE_THRESHOLD) goBack();

    touchStartRef.current = null;
    dragOffsetRef.current = 0;
    setIsDragging(false);
    setDragOffset(0);
    bumpAutoAfterInteraction();
  };

  const handleDotClick = (dot: number) => {
    goToDot(dot);
    bumpAutoAfterInteraction();
  };

  if (count === 0) {
    return (
      <div className={`flex items-center justify-center bg-surface/80 text-muted text-sm font-bold ${className}`}>
        Slideshow
      </div>
    );
  }

  const slideStyle = isVertical
    ? { height: viewportSize || '100%', minHeight: viewportSize || '100%' }
    : { width: viewportSize || '100%', minWidth: viewportSize || '100%' };

  const dotActive = realIndex(index);

  return (
    <div
      ref={containerRef}
      dir="ltr"
      className={`relative overflow-hidden overscroll-none ${className}`}
      style={{ touchAction: 'none' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={finishTouch}
      onTouchCancel={finishTouch}
    >
      <div
        ref={trackRef}
        className={`flex h-full will-change-transform ${isVertical ? 'flex-col' : 'flex-row'} ${animate && !isDragging ? 'transition-transform duration-700 ease-in-out' : ''}`}
        style={{ transform: dragTransform }}
        onTransitionEnd={onTransitionEnd}
      >
        {extendedSlides.map((url, idx) => (
          <div key={`${url}-${idx}`} className="shrink-0 grow-0 bg-black/20" style={slideStyle}>
            <img
              src={url}
              alt=""
              draggable={false}
              loading="eager"
              decoding="async"
              className="pointer-events-none h-full w-full select-none object-cover"
            />
          </div>
        ))}
      </div>

      {hasLoop && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-20 hidden items-center justify-center gap-1.5 px-4 md:flex">
          {images.map((_, idx) => (
            <button
              key={idx}
              type="button"
              aria-label={`Slide ${idx + 1}`}
              onClick={() => handleDotClick(idx)}
              className={`pointer-events-auto rounded-full transition-all duration-300 ${
                idx === dotActive
                  ? 'h-2 w-6 bg-white shadow-md'
                  : 'h-2 w-2 bg-white/45 hover:bg-white/70'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
