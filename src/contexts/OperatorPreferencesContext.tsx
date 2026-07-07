import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type OperatorTheme = 'light' | 'dark';
export type OperatorLanguage = 'ar' | 'en';

interface OperatorPreferencesContextType {
  theme: OperatorTheme;
  language: OperatorLanguage;
  toggleTheme: () => void;
  setLanguage: (lang: OperatorLanguage) => void;
  t: (ar: string, en: string) => string;
}

const OperatorPreferencesContext = createContext<OperatorPreferencesContextType | undefined>(undefined);

export function OperatorPreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<OperatorTheme>(() => {
    const saved = localStorage.getItem('operator_theme');
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  });

  const [language, setLanguageState] = useState<OperatorLanguage>(() => {
    const saved = localStorage.getItem('operator_language');
    return saved === 'ar' || saved === 'en' ? saved : 'ar';
  });

  useEffect(() => {
    localStorage.setItem('operator_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('operator_language', language);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [language]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  const setLanguage = (lang: OperatorLanguage) => setLanguageState(lang);
  const t = (ar: string, en: string) => (language === 'ar' ? ar : en);

  return (
    <OperatorPreferencesContext.Provider value={{ theme, language, toggleTheme, setLanguage, t }}>
      {children}
    </OperatorPreferencesContext.Provider>
  );
}

export function useOperatorPreferences() {
  const ctx = useContext(OperatorPreferencesContext);
  if (!ctx) throw new Error('useOperatorPreferences must be used within OperatorPreferencesProvider');
  return ctx;
}
