import type { Item } from './supabase';

export type CatalogLookup = Map<string, Pick<Item, 'name' | 'name_en'>>;

export function buildCatalogLookup(items: Pick<Item, 'id' | 'name' | 'name_en'>[]): CatalogLookup {
  return new Map(items.map((item) => [item.id, { name: item.name, name_en: item.name_en }]));
}

export function getLocalizedItemTitle(
  arabicName: string,
  englishName: string | null | undefined,
  language: 'ar' | 'en',
): string {
  if (language === 'ar') return arabicName;
  const en = englishName?.trim();
  return en || arabicName;
}

export function getLocalizedItemSubtitle(
  arabicName: string,
  englishName: string | null | undefined,
  language: 'ar' | 'en',
): string | null {
  const en = englishName?.trim();
  if (!en || en === arabicName) return null;
  return language === 'ar' ? en : arabicName;
}

export function resolveOrderItemNames(
  orderItem: { item_name: string; item_id?: string | null },
  language: 'ar' | 'en',
  catalog?: CatalogLookup,
): { title: string; subtitle: string | null } {
  const entry = orderItem.item_id ? catalog?.get(orderItem.item_id) : undefined;
  const arabicName = entry?.name || orderItem.item_name;
  const englishName = entry?.name_en;
  return {
    title: getLocalizedItemTitle(arabicName, englishName, language),
    subtitle: getLocalizedItemSubtitle(arabicName, englishName, language),
  };
}

export function formatOrderItemsList(
  orderItems: { item_name: string; item_id?: string | null }[],
  language: 'ar' | 'en',
  catalog?: CatalogLookup,
): string {
  const separator = language === 'ar' ? '، ' : ', ';
  return orderItems
    .map((item) => resolveOrderItemNames(item, language, catalog).title)
    .join(separator);
}
