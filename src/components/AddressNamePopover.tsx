interface AddressNamePopoverProps {
  mode: 'create' | 'rename';
  language: 'ar' | 'en';
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  position: { top: number; left: number };
}

export default function AddressNamePopover({
  mode,
  language,
  value,
  onChange,
  onSave,
  onCancel,
  position
}: AddressNamePopoverProps) {
  return (
    <div
      data-address-name-popover
      className="rounded-lg border border-primary/45 bg-[hsl(var(--color-surface))]/98 p-2 shadow-2xl backdrop-blur-sm w-[min(13.5rem,calc(100vw-1.5rem))]"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        transform: 'translateX(-50%)',
        zIndex: 450
      }}
    >
      <p className="text-[10px] font-black text-white text-right mb-1.5 leading-tight">
        {mode === 'rename'
          ? (language === 'ar' ? 'تعديل الاسم' : 'Rename')
          : (language === 'ar' ? 'اسم العنوان' : 'Address label')}
      </p>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-dark border border-primary/35 rounded-md px-2 py-1.5 text-white text-right focus:outline-none focus:border-primary text-xs font-bold"
        placeholder={mode === 'create' ? (language === 'ar' ? 'الاسم' : 'Name') : undefined}
        dir={language === 'ar' ? 'rtl' : 'ltr'}
        autoFocus
      />
      <div className="flex gap-1.5 flex-row-reverse mt-2">
        <button
          type="button"
          onClick={onSave}
          className="flex-1 py-1.5 rounded-md bg-primary hover:bg-primary/85 text-white text-[11px] font-black"
        >
          {language === 'ar' ? 'حفظ' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-1.5 rounded-md border border-white/20 text-muted text-[11px] font-bold"
        >
          {language === 'ar' ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
