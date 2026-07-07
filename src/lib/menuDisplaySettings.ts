import { supabase } from './supabase';

export interface MenuDisplaySettings {
  hideDescription: boolean;
  hideImage: boolean;
  hidePrice: boolean;
  hideItemName: boolean;
  hideSectionName: boolean;
  hideSections: boolean;
  squareImages: boolean;
}

export const DEFAULT_MENU_DISPLAY: MenuDisplaySettings = {
  hideDescription: false,
  hideImage: false,
  hidePrice: false,
  hideItemName: false,
  hideSectionName: false,
  hideSections: false,
  squareImages: false,
};

const KEYS: Record<keyof MenuDisplaySettings, string> = {
  hideDescription: 'menu_hide_description',
  hideImage: 'menu_hide_image',
  hidePrice: 'menu_hide_price',
  hideItemName: 'menu_hide_item_name',
  hideSectionName: 'menu_hide_section_name',
  hideSections: 'menu_hide_sections',
  squareImages: 'menu_square_images',
};

export function parseMenuDisplaySettings(rows: { key: string; value: string }[]): MenuDisplaySettings {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const bool = (key: string) => map.get(key) === 'true';
  return {
    hideDescription: bool(KEYS.hideDescription),
    hideImage: bool(KEYS.hideImage),
    hidePrice: bool(KEYS.hidePrice),
    hideItemName: bool(KEYS.hideItemName),
    hideSectionName: bool(KEYS.hideSectionName),
    hideSections: bool(KEYS.hideSections),
    squareImages: bool(KEYS.squareImages),
  };
}

export async function fetchMenuDisplaySettings(): Promise<MenuDisplaySettings> {
  const keys = Object.values(KEYS);
  const { data } = await supabase.from('settings').select('key, value').in('key', keys);
  if (!data?.length) return DEFAULT_MENU_DISPLAY;
  return parseMenuDisplaySettings(data);
}

export async function saveMenuDisplaySettings(settings: MenuDisplaySettings): Promise<void> {
  const entries = (Object.keys(KEYS) as (keyof MenuDisplaySettings)[]).map((field) => ({
    key: KEYS[field],
    value: settings[field] ? 'true' : 'false',
  }));
  for (const entry of entries) {
    const { error } = await supabase.from('settings').upsert(entry, { onConflict: 'key' });
    if (error) throw error;
  }
}

export { KEYS as MENU_DISPLAY_SETTING_KEYS };
