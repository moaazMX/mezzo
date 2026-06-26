import { createContext, useContext, useEffect, useState } from 'react';
import { fetchRatePagePassword } from '../lib/rateDiscount';

interface RateAuthContextType {
  isRateAdmin: boolean;
  login: (password: string) => Promise<boolean>;
  logout: () => void;
}

const RateAuthContext = createContext<RateAuthContextType | undefined>(undefined);

export function RateAuthProvider({ children }: { children: React.ReactNode }) {
  const [isRateAdmin, setIsRateAdmin] = useState(false);

  useEffect(() => {
    const session = localStorage.getItem('rate_session');
    if (session === 'active') {
      setIsRateAdmin(true);
    }
  }, []);

  const login = async (password: string): Promise<boolean> => {
    const stored = await fetchRatePagePassword();
    if (password === stored) {
      setIsRateAdmin(true);
      localStorage.setItem('rate_session', 'active');
      return true;
    }
    return false;
  };

  const logout = () => {
    setIsRateAdmin(false);
    localStorage.removeItem('rate_session');
  };

  return (
    <RateAuthContext.Provider value={{ isRateAdmin, login, logout }}>
      {children}
    </RateAuthContext.Provider>
  );
}

export function useRateAuth() {
  const context = useContext(RateAuthContext);
  if (!context) {
    throw new Error('useRateAuth must be used within RateAuthProvider');
  }
  return context;
}
