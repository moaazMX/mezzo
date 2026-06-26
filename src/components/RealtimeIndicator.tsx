import { useRealtimeStatus } from '../contexts/RealtimeContext';

interface RealtimeIndicatorProps {
  className?: string;
  label?: string;
  showDot?: boolean;
}

export default function RealtimeIndicator({ className = '', label, showDot = true }: RealtimeIndicatorProps) {
  const { isLive } = useRealtimeStatus();

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-bold text-white/70 ${className}`}
      title={isLive ? 'متصل — التحديثات فورية' : 'جاري الاتصال…'}
      aria-live="polite"
    >
      {showDot ? (
        <span
          className={`h-2 w-2 rounded-full transition-colors duration-300 ${
            isLive ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.9)]' : 'bg-amber-400/80 animate-pulse'
          }`}
          aria-hidden
        />
      ) : null}
      {label ? <span>{label}</span> : null}
    </span>
  );
}
