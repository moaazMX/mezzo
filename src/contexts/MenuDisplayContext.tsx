import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { DEFAULT_MENU_DISPLAY, fetchMenuDisplaySettings, type MenuDisplaySettings } from '../lib/menuDisplaySettings';
import { useRealtimeRefetch } from '../hooks/useRealtimeSubscription';

const MenuDisplayContext = createContext<MenuDisplaySettings>(DEFAULT_MENU_DISPLAY);

export function MenuDisplayProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<MenuDisplaySettings>(DEFAULT_MENU_DISPLAY);

  const reload = () => {
    void fetchMenuDisplaySettings().then(setSettings);
  };

  useEffect(() => {
    reload();
  }, []);

  useRealtimeRefetch('menu-display-settings', ['settings'], reload);

  return (
    <MenuDisplayContext.Provider value={settings}>
      {children}
    </MenuDisplayContext.Provider>
  );
}

export function useMenuDisplay() {
  return useContext(MenuDisplayContext);
}
