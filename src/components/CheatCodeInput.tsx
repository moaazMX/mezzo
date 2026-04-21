import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getOrCreateDeviceFingerprint } from '../lib/deviceFingerprint';

interface CheatCodeInputProps {
  couponSecretCode?: string | null;
  couponDiscountPercent?: number;
  onCouponUnlocked?: () => void;
  enabled?: boolean;
}

interface PressedKey {
  id: number;
  char: string;
}

const isArabicChar = (char: string) => /[\u0600-\u06FF]/.test(char);

export default function CheatCodeInput({
  couponSecretCode: _couponSecretCode,
  couponDiscountPercent: _couponDiscountPercent,
  onCouponUnlocked,
  enabled = true
}: CheatCodeInputProps) {
  const [keysPressed, setKeysPressed] = useState<PressedKey[]>([]);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'already'>('success');
  const [showToast, setShowToast] = useState(false);
  const keyIdRef = useRef(0);
  const GLOBAL_COUPON_FINGERPRINT = 'GLOBAL_TEMPLATE';
  const typedCodeRef = useRef<string>('');
  const unlockTimeoutRef = useRef<number | null>(null);

  const MIN_COUPON_LEN = 2;
  const MAX_COUPON_LEN = 24;

  const showNotification = useCallback((message: string, type: 'success' | 'error' | 'already') => {
    setToastMessage(message);
    setToastType(type);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 4000);
  }, []);

  const handleCodeMatch = useCallback(async (codeToMatch: string) => {
    const typed = (codeToMatch || '').trim();
    if (typed.length < MIN_COUPON_LEN) return;
    try {
      const fingerprint = getOrCreateDeviceFingerprint();
      const now = new Date();
      const suffixes: string[] = [];
      for (let i = Math.max(0, typed.length - MAX_COUPON_LEN); i <= typed.length - MIN_COUPON_LEN; i++) {
        suffixes.push(typed.slice(i));
      }
      suffixes.sort((a, b) => b.length - a.length);

      const { data: templateRows, error: templateError } = await supabase
        .from('device_coupons')
        .select('*')
        .eq('device_fingerprint', GLOBAL_COUPON_FINGERPRINT)
        .eq('is_disabled', false)
        .limit(80);

      if (templateError) {
        console.error('Error loading coupon template:', templateError);
        return;
      }

      const template = (templateRows || [])
        .filter((t) => suffixes.includes(t.code || ''))
        .sort((a, b) => (b.code?.length || 0) - (a.code?.length || 0))[0];
      if (!template) return;

      if (template.expires_at && new Date(template.expires_at) <= now) return;

      const codeExact = template.code || typed;
      const savedPhone = (localStorage.getItem('customer_phone') || '').trim();
      let linkedCustomerId: string | null = null;
      let linkedCustomerName: string | null = null;
      let linkedCustomerPhone: string | null = null;
      if (savedPhone) {
        const { data: customerRow } = await supabase
          .from('customers')
          .select('id, name, phone')
          .eq('phone', savedPhone)
          .maybeSingle();
        if (customerRow?.id) {
          linkedCustomerId = customerRow.id;
          linkedCustomerName = (customerRow as any).name || null;
          linkedCustomerPhone = (customerRow as any).phone || savedPhone;
        }
      }

      const normalizePhone = (p?: string | null) => (p || '').replace(/\D/g, '').replace(/^0+/, '');
      const existingForCurrentAccount = linkedCustomerId
        ? await supabase
            .from('device_coupons')
            .select('*')
            .eq('code', codeExact)
            .or(`customer_id.eq.${linkedCustomerId},device_fingerprint.eq.${fingerprint},customer_phone.eq.${linkedCustomerPhone || ''}`)
        : await supabase
            .from('device_coupons')
            .select('*')
            .eq('device_fingerprint', fingerprint)
            .eq('code', codeExact);
      const { data: existingRows, error: existingErr } = existingForCurrentAccount;

      if (existingErr) {
        console.error('Error checking existing coupon:', existingErr);
        return;
      }

      let rows = (existingRows || []) as any[];
      if (linkedCustomerId || linkedCustomerPhone) {
        const targetPhone = normalizePhone(linkedCustomerPhone || savedPhone);
        rows = rows.filter((r) => {
          const byCid = linkedCustomerId && r.customer_id === linkedCustomerId;
          const byPhone = targetPhone && normalizePhone(r.customer_phone) === targetPhone;
          // IMPORTANT: when account/phone is known, do not use plain fingerprint fallback,
          // so old-number coupons on same device are not treated as "already owned".
          return !!(byCid || byPhone);
        });
      }
      if (rows.some((r) => r.is_disabled)) return;

      const reusable = rows.find((r) => !r.expires_at || new Date(r.expires_at) > now);
      if (reusable) {
        showNotification('لقد حصلت على هذا الكوبون من قبل', 'already');
        return;
      }

      const { error } = await supabase.from('device_coupons').insert([
        {
          device_fingerprint: fingerprint,
          code: codeExact,
          discount_percent: template.discount_percent,
          expires_at: template.expires_at || null,
          customer_id: linkedCustomerId,
          customer_name: linkedCustomerName,
          customer_phone: linkedCustomerPhone
        }
      ]);

      if (error) {
        console.error('Error creating coupon from cheat code:', error);
        return;
      }

      showNotification(`مبروك! حصلت على كوبون خصم ${template.discount_percent}%`, 'success');
      if (onCouponUnlocked) onCouponUnlocked();
    } catch (err) {
      console.error('Unexpected error creating coupon:', err);
    }
  }, [onCouponUnlocked, showNotification]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      const key = e.key;
      if (key.length !== 1) return;

      const newKey: PressedKey = {
        id: keyIdRef.current++,
        char: key
      };

      typedCodeRef.current = (typedCodeRef.current + key).slice(-MAX_COUPON_LEN);
      setKeysPressed(prev => [...prev, newKey].slice(-24));

      if (unlockTimeoutRef.current) window.clearTimeout(unlockTimeoutRef.current);
      const codeToTry = typedCodeRef.current;
      unlockTimeoutRef.current = window.setTimeout(() => {
        handleCodeMatch(codeToTry);
      }, 650);

      window.setTimeout(() => {
        setKeysPressed(prev => prev.filter(k => k.id !== newKey.id));
      }, 5000);
    };

    window.addEventListener('keypress', handleKeyPress);
    return () => {
      window.removeEventListener('keypress', handleKeyPress);
      if (unlockTimeoutRef.current) window.clearTimeout(unlockTimeoutRef.current);
    };
  }, [enabled, handleCodeMatch]);

  const hasArabic = keysPressed.some(k => isArabicChar(k.char));
  const hasLatin = keysPressed.some((k) => /[A-Za-z]/.test(k.char));
  const isMixed = hasArabic && hasLatin;
  const displayUnits = keysPressed.map((k) => ({ char: k.char, arabic: isArabicChar(k.char), id: k.id }));
  const withArabicJoin = (idx: number, ch: string, arabic: boolean) => {
    if (!arabic) return ch;
    const prevArabic = idx > 0 && displayUnits[idx - 1].arabic;
    const nextArabic = idx < displayUnits.length - 1 && displayUnits[idx + 1].arabic;
    if (prevArabic && nextArabic) return `\u200D${ch}\u200D`;
    if (prevArabic) return `\u200D${ch}`;
    if (nextArabic) return `${ch}\u200D`;
    return ch;
  };
  const withBidiSync = (idx: number, ch: string, arabic: boolean) => {
    const joined = withArabicJoin(idx, ch, arabic);
    if (!isMixed) return joined;
    // In mixed mode: force each script direction without flipping the other.
    return arabic ? `\u061C${joined}` : `\u200E${joined}`;
  };

  return (
    <>
      <div className="fixed top-4 left-1/2 transform -translate-x-1/2 pointer-events-none z-[100]">
        {keysPressed.length > 0 && (
          <div
            className="text-purple-200/80 px-6 py-3 rounded-lg backdrop-blur-sm"
            dir="auto"
            style={{ backgroundColor: 'rgba(210, 210, 220, 0.18)' }}
          >
            {hasArabic ? (
              <div
                className="font-mono text-2xl flex items-center justify-center"
                style={{
                  direction: isMixed ? 'ltr' : (hasLatin ? 'ltr' : 'rtl'),
                  unicodeBidi: isMixed ? 'plaintext' : (hasLatin ? 'isolate' : 'plaintext'),
                  letterSpacing: 0
                }}
              >
                {displayUnits.map((u, i) => (
                  <span
                    key={u.id}
                    style={{
                      position: 'relative',
                      display: 'inline-block',
                      animation: u.arabic
                        ? 'cheatKeyBounceArabic 1.05s cubic-bezier(0.22, 0.61, 0.36, 1) infinite'
                        : 'cheatKeyBounce 1s cubic-bezier(0.22, 0.61, 0.36, 1) infinite',
                      animationDelay: `${i * (u.arabic ? 0.045 : 0.08)}s`,
                      willChange: 'transform',
                      direction: u.arabic ? 'rtl' : 'ltr',
                      unicodeBidi: u.arabic ? 'plaintext' : 'isolate',
                      marginInline: u.arabic ? '-0.03em' : '0'
                    }}
                  >
                    {withBidiSync(i, u.char, u.arabic)}
                  </span>
                ))}
              </div>
            ) : (
              <div
                className="font-mono text-2xl tracking-widest flex items-center justify-center gap-0"
                style={{ direction: 'ltr', unicodeBidi: 'plaintext' }}
              >
                {keysPressed.map((pressedKey, i) => (
                  <span
                    key={pressedKey.id}
                    style={{
                      position: 'relative',
                      display: 'inline-block',
                      animation: 'cheatKeyBounce 0.9s ease-in-out infinite',
                      animationDelay: `${i * 0.08}s`
                    }}
                  >
                    {pressedKey.char}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showToast && (
        <div
          className="fixed top-8 left-1/2 -translate-x-1/2 z-[101] pointer-events-none"
          style={{ animation: 'toastSlideIn 0.3s ease-out' }}
        >
          <div className={`px-6 py-3 rounded-2xl shadow-2xl text-white font-bold text-lg backdrop-blur-md border ${toastType === 'success'
            ? 'bg-green-600/90 border-green-400'
            : toastType === 'already'
              ? 'bg-yellow-600/90 border-yellow-400'
              : 'bg-red-600/90 border-red-400'
            }`}>
            {toastMessage}
          </div>
        </div>
      )}

      <style>{`
        @keyframes cheatKeyBounce {
          0% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
          100% { transform: translateY(0); }
        }
        @keyframes cheatKeyBounceArabic {
          0% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
          100% { transform: translateY(0); }
        }
        @keyframes toastSlideIn {
          0% {
            opacity: 0;
            transform: translate(-50%, -20px);
          }
          100% {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
      `}</style>
    </>
  );
}