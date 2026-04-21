import { Category, Item } from '../lib/supabase';
import MenuItem from './MenuItem';
import { useLanguage } from '../contexts/LanguageContext';

interface CategorySectionProps {
  category: Category;
  items: Item[];
  onAddToCart: (item: Item) => void;
}

export default function CategorySection({ category, items, onAddToCart }: CategorySectionProps) {
  const { language } = useLanguage();
  const title = language === 'ar' ? category.name : category.name_en;
  const subtitle = language === 'ar' ? category.name_en : category.name;

  return (
    <section className="mb-10 scroll-mt-24" id={`category-${category.id}`}>
      <header className="mb-4 text-right">
        <h2 className="text-lg font-black text-white sm:text-xl">{title}</h2>
        {subtitle && subtitle !== title && (
          <p className="mt-0.5 text-xs font-bold text-primary/80 sm:text-sm">{subtitle}</p>
        )}
      </header>
      {items.length === 0 ? (
        <div className="bg-surface/60 border border-primary/20 rounded-2xl p-6 text-center text-muted font-bold">
          {language === 'ar' ? 'لا توجد أصناف داخل هذا القسم حالياً' : 'No items in this category yet'}
        </div>
      ) : (
        <div className="mx-menu-grid">
          {items.map(item => (
            <MenuItem key={item.id} item={item} onAddToCart={onAddToCart} />
          ))}
        </div>
      )}
    </section>
  );
}