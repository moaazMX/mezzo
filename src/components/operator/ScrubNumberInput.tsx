import { useCallback, useRef, useState } from 'react';

interface ScrubNumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  className?: string;
  suffix?: string;
  disabled?: boolean;
}

export default function ScrubNumberInput({
  value,
  onChange,
  min = -360,
  max = 500,
  step = 1,
  decimals = 0,
  className = '',
  suffix,
  disabled = false
}: ScrubNumberInputProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startValue: 0 });

  const clamp = useCallback(
    (v: number) => Math.min(max, Math.max(min, v)),
    [min, max]
  );

  const format = (v: number) => {
    const factor = Math.pow(10, decimals);
    return (Math.round(v * factor) / factor).toFixed(decimals);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragRef.current = { startX: e.clientX, startValue: value };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLInputElement>) => {
    if (!isDragging || disabled) return;
    const deltaX = e.clientX - dragRef.current.startX;
    const sensitivity = e.shiftKey ? step / 5 : step;
    const delta = Math.round(deltaX * sensitivity * 0.5);
    onChange(clamp(dragRef.current.startValue + delta));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={`${format(value)}${suffix ?? ''}`}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value.replace(suffix ?? '', '').trim();
        const parsed = parseFloat(raw);
        if (!Number.isNaN(parsed)) onChange(clamp(parsed));
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`scrub-number-input ${isDragging ? 'scrub-number-input--dragging' : ''} ${className}`}
      title="اسحب يميناً/يساراً لتغيير القيمة"
    />
  );
}
