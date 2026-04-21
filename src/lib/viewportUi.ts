/**
 * True "phone" UI chrome: narrow viewport + coarse pointer (touch).
 * Avoids treating a desktop browser resized to a small width as mobile.
 */
export function isTouchPhoneChrome(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.innerWidth > 768) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
