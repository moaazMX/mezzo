
import type { CustomerData } from './supabase';

const STORAGE_KEY = 'mx_shared_address';

export const saveSharedAddress = (data: Partial<CustomerData>) => {
  try {
    const existing = getSharedAddress();
    const updated = { ...existing, ...data };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    
    // Dispatch a custom event to notify other components in the same tab
    window.dispatchEvent(new CustomEvent('mx_address_updated', { detail: updated }));
  } catch (e) {
    console.error('Error saving shared address:', e);
  }
};

const TABS_STORAGE_KEY = 'mx_shared_address_tabs';

export const saveSharedAddressTabs = (tabs: any[]) => {
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
    window.dispatchEvent(new CustomEvent('mx_tabs_updated', { detail: tabs }));
  } catch (e) {
    console.error('Error saving shared address tabs:', e);
  }
};

export const getSharedAddressTabs = (): any[] => {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Error getting shared address tabs:', e);
    return [];
  }
};

export const getSharedAddress = (): Partial<CustomerData> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('Error getting shared address:', e);
    return {};
  }
};

export const subscribeToAddressSync = (
  onAddressUpdate: (data: Partial<CustomerData>) => void,
  onTabsUpdate?: (tabs: any[]) => void
) => {
  const handler = (e: any) => {
    if (e instanceof CustomEvent) {
      if (e.type === 'mx_address_updated') {
        onAddressUpdate(e.detail);
      } else if (e.type === 'mx_tabs_updated' && onTabsUpdate) {
        onTabsUpdate(e.detail);
      }
    }
  };
  
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      onAddressUpdate(JSON.parse(e.newValue));
    } else if (e.key === TABS_STORAGE_KEY && e.newValue && onTabsUpdate) {
      onTabsUpdate(JSON.parse(e.newValue));
    }
  };

  window.addEventListener('mx_address_updated', handler);
  window.addEventListener('mx_tabs_updated', handler);
  window.addEventListener('storage', storageHandler);
  
  return () => {
    window.removeEventListener('mx_address_updated', handler);
    window.removeEventListener('mx_tabs_updated', handler);
    window.removeEventListener('storage', storageHandler);
  };
};
