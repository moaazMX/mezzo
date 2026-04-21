import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  isOperator: boolean;
  login: (password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isOperator, setIsOperator] = useState(false);

  useEffect(() => {
    const operatorSession = localStorage.getItem('operator_session');
    if (operatorSession === 'active') {
      setIsOperator(true);
    }
  }, []);

  const login = async (password: string): Promise<boolean> => {
    // Fetch the admin password from the database
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'admin_password')
      .maybeSingle();

    const adminPassword = data?.value || 'moaazMXpl011#'; // fallback to default

    if (password === adminPassword) {
      setIsOperator(true);
      localStorage.setItem('operator_session', 'active');
      return true;
    }
    return false;
  };

  const logout = () => {
    setIsOperator(false);
    localStorage.removeItem('operator_session');
  };

  return (
    <AuthContext.Provider value={{ isOperator, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}