import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface TimePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (hour: number, minute: number, ampm: 'AM' | 'PM') => void;
  initialHour: number;
  initialMinute: number;
  initialAmPm: 'AM' | 'PM';
  language: 'ar' | 'en';
  onDelete?: () => void;
}

const TimePicker: React.FC<TimePickerProps> = ({
  isOpen,
  onClose,
  onConfirm,
  initialHour,
  initialMinute,
  initialAmPm,
  language,
  onDelete
}) => {
  const [hour, setHour] = useState(initialHour);
  const [minute, setMinute] = useState(initialMinute);
  const [ampm, setAmPm] = useState<'AM' | 'PM'>(initialAmPm);
  const [mode, setMode] = useState<'hour' | 'minute'>('hour');
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [isClosing, setIsClosing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dragY, setDragY] = useState(0);
  const startYRef = useRef(0);
  const isDraggingRef = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const hourInputRef = useRef<HTMLInputElement>(null);
  const minuteInputRef = useRef<HTMLInputElement>(null);

  const [hourInput, setHourInput] = useState(initialHour.toString());
  const [minuteInput, setMinuteInput] = useState(initialMinute.toString().padStart(2, '0'));
  const [isEditing, setIsEditing] = useState<'hour' | 'minute' | null>(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setHour(initialHour);
      setMinute(initialMinute);
      setHourInput(initialHour.toString());
      setMinuteInput(initialMinute.toString().padStart(2, '0'));
      setAmPm(initialAmPm);
      setMode('hour');
      setIsEditing(null);
      setIsClosing(false);
      setDragY(0);
      // Trigger entrance animation with a small delay to ensure initial state is rendered
      setTimeout(() => setMounted(true), 10);
    } else {
      setMounted(false);
    }
  }, [isOpen, initialHour, initialMinute, initialAmPm]);

  useEffect(() => {
    // Keep it simple. Avoid aggressive body scaling as it causes layout jumps and flickering in the parent Cart component.
    if (isOpen && isMobile) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, isMobile]);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false); // Reset for next opening
    }, 300);
  }, [onClose]);

  const handleConfirm = () => {
    onConfirm(hour, minute, ampm);
    handleClose();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobile) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, .clock-dial')) return;
    startYRef.current = e.touches[0].clientY;
    isDraggingRef.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDraggingRef.current) return;
    const delta = e.touches[0].clientY - startYRef.current;
    if (delta > 0) setDragY(delta);
  };

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
    if (dragY > 100) {
      handleClose();
    } else {
      setDragY(0);
    }
  };

  // Clock Dial Logic
  const RADIUS = 90;
  const CENTER = 125;

  const handleDialMove = (clientX: number, clientY: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();

    const x = clientX - rect.left - CENTER;
    const y = clientY - rect.top - CENTER;

    let angle = Math.atan2(y, x) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;

    if (mode === 'hour') {
      let h = Math.round(angle / 30);
      if (h === 0) h = 12;
      if (h !== hour) {
        setHour(h);
        setHourInput(h.toString());
      }
    } else {
      let m = Math.round(angle / 6) % 60;
      if (m !== minute) {
        setMinute(m);
        setMinuteInput(m.toString().padStart(2, '0'));
      }
    }
  };

  const handleDialClick = (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    handleDialMove(clientX, clientY);
    if (mode === 'hour') {
      setTimeout(() => setMode('minute'), 300);
    }
  };

  const renderClockNumbers = () => {
    const numbers = mode === 'hour' ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
    return numbers.map((num, i) => {
      const angle = (i * 30) * (Math.PI / 180) - Math.PI / 2;
      const x = CENTER + RADIUS * Math.cos(angle);
      const y = CENTER + RADIUS * Math.sin(angle);
      const isSelected = mode === 'hour' ? hour === num : minute === num;

      return (
        <g key={num}>
          {isSelected && (
            <circle cx={x} cy={y} r="16" className="fill-primary" />
          )}
          <text
            x={x}
            y={y}
            dy="0.35em"
            textAnchor="middle"
            className={`text-sm font-bold pointer-events-none ${isSelected ? 'fill-white' : 'fill-muted'}`}
          >
            {mode === 'hour' ? num : num.toString().padStart(2, '0')}
          </text>
        </g>
      );
    });
  };

  const handAngle = mode === 'hour'
    ? (hour % 12) * 30
    : (minute * 6);

  if (!isOpen && !isClosing) return null;

  const content = (
    <div className={`fixed inset-0 z-[2000] flex ${isMobile ? 'items-end' : 'items-center justify-center'} transition-all duration-300 ${isClosing ? 'pointer-events-none' : ''}`}>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${!mounted || isClosing ? 'opacity-0' : 'opacity-100'} ${!isMobile ? 'backdrop-blur-sm' : ''}`}
        onClick={handleClose}
      />

      {/* Container */}
      <div
        className={`relative bg-surface w-full max-w-md overflow-hidden transition-all duration-500 cubic-bezier(0.32, 0.72, 0, 1)
          ${!mounted || isClosing ? 'translate-y-[110%]' : 'translate-y-0'}
          ${isMobile ? 'rounded-t-[32px] h-auto max-h-[85dvh]' : 'rounded-3xl shadow-2xl shadow-black/50'}
          `}
        style={isMobile ? { transform: `translateY(${(!mounted || isClosing) ? '110%' : `${dragY}px`})` } : {}}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {isMobile && (
          <div className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing">
            <div className="w-12 h-1.5 rounded-full bg-white/20" />
          </div>
        )}

        <div className="p-6">
          {/* Header Display */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <div 
                className="flex flex-col items-center gap-2 cursor-pointer"
                onClick={() => {
                  if (mode !== 'hour') {
                    setMode('hour');
                  } else if (isEditing !== 'hour') {
                    setIsEditing('hour');
                    setTimeout(() => hourInputRef.current?.focus(), 0);
                  }
                }}
              >
                <span className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">
                  {language === 'ar' ? 'الساعة' : 'Hour'}
                </span>
                <input
                  ref={hourInputRef}
                  type="text"
                  inputMode="numeric"
                  value={isEditing === 'hour' ? hourInput : hour.toString().padStart(2, '0')}
                  readOnly={isEditing !== 'hour'}
                  onChange={(e) => {
                    let val = e.target.value.replace(/\D/g, '');
                    if (val.length > 2) val = val.slice(-2);
                    const n = parseInt(val);
                    if (n > 12) val = "12";
                    
                    setHourInput(val);
                    if (!isNaN(parseInt(val))) {
                      setHour(Math.min(12, Math.max(1, parseInt(val))));
                    }
                  }}
                  onBlur={() => {
                    setIsEditing(null);
                    let n = parseInt(hourInput) || 12;
                    if (n < 1) n = 12;
                    if (n > 12) n = 12;
                    setHour(n);
                    setHourInput(n.toString());
                  }}
                  className={`w-24 text-4xl font-black text-center py-4 rounded-2xl transition-all outline-none border-none
                    ${mode === 'hour' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'bg-dark/40 text-muted'}
                    ${isEditing === 'hour' ? 'cursor-text' : 'cursor-pointer'}`}
                />
              </div>

              <span className="text-4xl font-bold text-muted mt-6">:</span>

              <div 
                className="flex flex-col items-center gap-2 cursor-pointer"
                onClick={() => {
                  if (mode !== 'minute') {
                    setMode('minute');
                  } else if (isEditing !== 'minute') {
                    setIsEditing('minute');
                    setTimeout(() => minuteInputRef.current?.focus(), 0);
                  }
                }}
              >
                <span className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">
                  {language === 'ar' ? 'الدقائق' : 'Minute'}
                </span>
                <input
                  ref={minuteInputRef}
                  type="text"
                  inputMode="numeric"
                  value={isEditing === 'minute' ? minuteInput : minute.toString().padStart(2, '0')}
                  readOnly={isEditing !== 'minute'}
                  onChange={(e) => {
                    let val = e.target.value.replace(/\D/g, '');
                    if (val.length > 2) val = val.slice(-2);
                    const n = parseInt(val);
                    if (n > 59) val = "59";

                    setMinuteInput(val);
                    if (!isNaN(parseInt(val))) {
                      setMinute(Math.min(59, Math.max(0, parseInt(val))));
                    }
                  }}
                  onBlur={() => {
                    setIsEditing(null);
                    let n = parseInt(minuteInput) || 0;
                    if (n < 0) n = 0;
                    if (n > 59) n = 59;
                    setMinute(n);
                    setMinuteInput(n.toString().padStart(2, '0'));
                  }}
                  className={`w-24 text-4xl font-black text-center py-4 rounded-2xl transition-all outline-none border-none
                    ${mode === 'minute' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'bg-dark/40 text-muted'}
                    ${isEditing === 'minute' ? 'cursor-text' : 'cursor-pointer'}`}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => setAmPm('AM')}
                className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${ampm === 'AM' ? 'bg-primary border-primary text-white shadow-md' : 'border-muted/30 text-muted'}`}
              >
                AM
              </button>
              <button
                onClick={() => setAmPm('PM')}
                className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${ampm === 'PM' ? 'bg-primary border-primary text-white shadow-md' : 'border-muted/30 text-muted'}`}
              >
                PM
              </button>
            </div>
          </div>

          {/* Main Area: Dial */}
          <div className="flex justify-center mb-8 h-[250px] items-center">
            <div className="relative w-[250px] h-[250px] bg-dark/20 rounded-full clock-dial">
              <svg
                ref={svgRef}
                width="250"
                height="250"
                viewBox="0 0 250 250"
                onMouseDown={(e) => {
                  handleDialClick(e);
                  const onMouseMove = (moveEvent: MouseEvent) => handleDialMove(moveEvent.clientX, moveEvent.clientY);
                  const onMouseUp = () => {
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                  };
                  window.addEventListener('mousemove', onMouseMove);
                  window.addEventListener('mouseup', onMouseUp);
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  handleDialClick(e);
                }}
                onTouchMove={(e) => {
                  e.stopPropagation();
                  handleDialMove(e.touches[0].clientX, e.touches[0].clientY);
                }}
                className="cursor-pointer touch-none"
              >
                <circle cx="125" cy="125" r="115" className="fill-dark/30 stroke-primary/10 stroke-1" />

                {/* Hand */}
                <line
                  x1="125"
                  y1="125"
                  x2={CENTER + RADIUS * Math.sin(handAngle * (Math.PI / 180))}
                  y2={CENTER - RADIUS * Math.cos(handAngle * (Math.PI / 180))}
                  className="stroke-primary stroke-[2]"
                />
                <circle 
                  cx={CENTER + RADIUS * Math.sin(handAngle * (Math.PI / 180))} 
                  cy={CENTER - RADIUS * Math.cos(handAngle * (Math.PI / 180))} 
                  r="4" 
                  className="fill-primary" 
                />
                <circle cx="125" cy="125" r="4" className="fill-primary" />

                {renderClockNumbers()}
              </svg>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between">
            <div>
              {onDelete && (
                <button
                  onClick={() => {
                    onDelete();
                    handleClose();
                  }}
                  className="px-6 py-2 text-red-400 font-bold hover:text-red-300 transition-all text-sm"
                >
                  {language === 'ar' ? 'حذف' : 'Delete'}
                </button>
              )}
            </div>

            <div className="flex gap-4">
              <button
                onClick={handleClose}
                className="px-6 py-2 text-muted font-bold hover:text-white transition-all"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                onClick={handleConfirm}
                className="px-6 py-2 text-primary font-black hover:text-primary/80 transition-all"
              >
                {language === 'ar' ? 'تأكيد' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .clock-dial {
          box-shadow: inset 0 2px 10px rgba(0,0,0,0.3);
        }
      `}</style>
    </div>
  );

  return createPortal(content, document.body);
};

export default TimePicker;
