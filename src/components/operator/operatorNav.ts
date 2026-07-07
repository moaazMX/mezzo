export type OperatorNavId =
  | 'orders'
  | 'archive.orders'
  | 'archive.customers'
  | 'content.items'
  | 'content.settings'
  | 'analytics'
  | 'coupons'
  | 'delivery'
  | 'payment'
  | 'site-interface'
  | 'security'
  | 'support.end-day'
  | 'support.site-data'
  | 'support.reset';

export type OperatorNavGroup = {
  id: string;
  labelAr: string;
  labelEn: string;
  icon: string;
  children?: { id: OperatorNavId; labelAr: string; labelEn: string }[];
  leaf?: OperatorNavId;
};

export const OPERATOR_NAV: OperatorNavGroup[] = [
  { id: 'orders', labelAr: 'الطلبات', labelEn: 'Orders', icon: 'Package', leaf: 'orders' },
  {
    id: 'archive',
    labelAr: 'الأرشيف',
    labelEn: 'Archive',
    icon: 'Archive',
    children: [
      { id: 'archive.orders', labelAr: 'الطلبات', labelEn: 'Orders' },
      { id: 'archive.customers', labelAr: 'بيانات العملاء', labelEn: 'Customer Data' },
    ],
  },
  {
    id: 'content',
    labelAr: 'إدارة المحتوى',
    labelEn: 'Content',
    icon: 'ShoppingBag',
    children: [
      { id: 'content.items', labelAr: 'المحتوى', labelEn: 'Content' },
      { id: 'content.settings', labelAr: 'إعدادات المحتوى', labelEn: 'Content Settings' },
    ],
  },
  { id: 'analytics', labelAr: 'الإحصائيات', labelEn: 'Analytics', icon: 'BarChart3', leaf: 'analytics' },
  { id: 'coupons', labelAr: 'الخصومات والكوبونات', labelEn: 'Discounts & Coupons', icon: 'TicketPercent', leaf: 'coupons' },
  { id: 'delivery', labelAr: 'أماكن التوصيل والطلب', labelEn: 'Delivery & Pickup', icon: 'MapPinned', leaf: 'delivery' },
  { id: 'payment', labelAr: 'طرق الدفع', labelEn: 'Payment Methods', icon: 'CreditCard', leaf: 'payment' },
  { id: 'site-interface', labelAr: 'واجهة الموقع', labelEn: 'Site Interface', icon: 'Layout', leaf: 'site-interface' },
  { id: 'security', labelAr: 'الأمان', labelEn: 'Security', icon: 'Lock', leaf: 'security' },
  {
    id: 'support',
    labelAr: 'إعدادات الداعم والأوبراتور',
    labelEn: 'Support & Operator',
    icon: 'Settings',
    children: [
      { id: 'support.end-day', labelAr: 'إنهاء اليوم', labelEn: 'End Day' },
      { id: 'support.site-data', labelAr: 'بيانات الموقع', labelEn: 'Site Data' },
      { id: 'support.reset', labelAr: 'إعادة تعيين البيانات', labelEn: 'Reset Data' },
    ],
  },
];

export function navLabel(id: OperatorNavId, lang: 'ar' | 'en'): string {
  for (const group of OPERATOR_NAV) {
    if (group.leaf === id) return lang === 'ar' ? group.labelAr : group.labelEn;
    for (const child of group.children || []) {
      if (child.id === id) return lang === 'ar' ? child.labelAr : child.labelEn;
    }
  }
  return id;
}

export const OPERATOR_NAV_STORAGE_KEY = 'operator_active_nav';

const ALL_NAV_IDS: OperatorNavId[] = [
  'orders', 'archive.orders', 'archive.customers', 'content.items', 'content.settings',
  'analytics', 'coupons', 'delivery', 'payment', 'site-interface', 'security',
  'support.end-day', 'support.site-data', 'support.reset',
];

export function isOperatorNavId(value: string): value is OperatorNavId {
  return ALL_NAV_IDS.includes(value as OperatorNavId);
}

export function readStoredOperatorNav(): OperatorNavId {
  try {
    const raw = localStorage.getItem(OPERATOR_NAV_STORAGE_KEY);
    if (raw && isOperatorNavId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return 'orders';
}

export function storeOperatorNav(id: OperatorNavId) {
  try {
    localStorage.setItem(OPERATOR_NAV_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}
