import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';

type Language = 'ar' | 'en';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const translations: Record<Language, Record<string, string>> = {
  ar: {
    'header.cart': 'السلة',
    'header.profile': 'الملف الشخصي',
    'common.currency': 'ج',
    'cart.title': 'سلة الطلبات',
    'cart.empty': 'السلة فارغة',
    'cart.emptyHint': 'أضف بعض الأصناف للبدء',
    'cart.checkout': 'إتمام الطلب',
    'checkout.title': 'إتمام الطلب',
    'checkout.customerInfo': 'بياناتك',
    'checkout.name': 'الاسم',
    'checkout.phone': 'رقم الهاتف',
    'checkout.street': 'الشارع',
    'checkout.area': 'المنطقة',
    'checkout.city': 'المدينة',
    'checkout.paymentMethod': 'طريقة الدفع',
    'checkout.cash': 'نقدي',
    'checkout.instantTransfer': 'تحويل فوري',
    'checkout.confirm': 'تأكيد الطلب',
    'menuItem.addToCart': 'إضافة',
    'menuItem.specialOffer': 'عرض خاص!',
    'common.total': 'الإجمالي المطلوب',
    'cart.items': 'أصناف',
    'common.unavailable': 'غير متوفر حالياً',
  },
  en: {
    'header.cart': 'Cart',
    'header.profile': 'Profile',
    'common.currency': 'EG',
    'cart.title': 'My Cart',
    'cart.empty': 'Your cart is empty',
    'cart.emptyHint': 'Add some items to get started',
    'cart.checkout': 'Checkout',
    'checkout.title': 'Complete Order',
    'checkout.customerInfo': 'Your Information',
    'checkout.name': 'Name',
    'checkout.phone': 'Phone Number',
    'checkout.street': 'Street',
    'checkout.area': 'Area',
    'checkout.city': 'City',
    'checkout.paymentMethod': 'Payment Method',
    'checkout.cash': 'Cash',
    'checkout.instantTransfer': 'Instant Transfer',
    'checkout.confirm': 'Confirm Order',
    'menuItem.addToCart': 'Add',
    'menuItem.specialOffer': 'Special Offer!',
    'common.total': 'Grand Total',
    'cart.items': 'Items',
    'common.unavailable': 'Currently Unavailable',
  },
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const savedLang = localStorage.getItem('language');
    return (savedLang === 'ar' || savedLang === 'en') ? savedLang : 'ar';
  });

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('language', language);
  }, [language]);

  const t = (key: string): string => {
    return translations[language][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
