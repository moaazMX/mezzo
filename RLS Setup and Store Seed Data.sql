-- ملف لإصلاح RLS وإضافة البيانات
-- نفذ هذا الملف في Supabase SQL Editor

-- 1. تفعيل RLS على جميع الجداول
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- 2. إنشاء Policies للقراءة العامة (للعملاء)
-- السماح للجميع بقراءة الفئات النشطة
DROP POLICY IF EXISTS "Public can view active categories" ON categories;
CREATE POLICY "Public can view active categories" ON categories
  FOR SELECT
  USING (is_active = true);

-- السماح للجميع بقراءة المنتجات النشطة
DROP POLICY IF EXISTS "Public can view active items" ON items;
CREATE POLICY "Public can view active items" ON items
  FOR SELECT
  USING (is_active = true);

-- السماح للجميع بقراءة الإعدادات
DROP POLICY IF EXISTS "Public can view settings" ON settings;
CREATE POLICY "Public can view settings" ON settings
  FOR SELECT
  USING (true);

-- 3. إنشاء Policies للكتابة (لإنشاء الطلبات)
-- السماح للجميع بإنشاء عملاء
DROP POLICY IF EXISTS "Public can insert customers" ON customers;
CREATE POLICY "Public can insert customers" ON customers
  FOR INSERT
  WITH CHECK (true);

-- السماح للجميع بتحديث بياناتهم
DROP POLICY IF EXISTS "Public can update own customer data" ON customers;
CREATE POLICY "Public can update own customer data" ON customers
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- السماح للجميع بإنشاء طلبات
DROP POLICY IF EXISTS "Public can insert orders" ON orders;
CREATE POLICY "Public can insert orders" ON orders
  FOR INSERT
  WITH CHECK (true);

-- السماح للجميع بإنشاء عناصر الطلب
DROP POLICY IF EXISTS "Public can insert order items" ON order_items;
CREATE POLICY "Public can insert order items" ON order_items
  FOR INSERT
  WITH CHECK (true);

-- 4. التحقق من وجود البيانات
-- إذا لم تكن موجودة، أضفها
DO $$
BEGIN
    -- التحقق من الفئات
    IF NOT EXISTS (SELECT 1 FROM categories LIMIT 1) THEN
        INSERT INTO categories (name, name_en, icon, display_order, is_active) VALUES
        ('برجر ليفل الوحش', 'BOSS BURGERS', '🔥', 1, true),
        ('الامدادات الجانبية', 'LOOT BOX - SIDES', '🎁', 2, true),
        ('شاورما السرعة', 'RUSH SHAWERMA', '⚡', 3, true),
        ('جرعات الطاقة', 'MANA & POTIONS', '🧪', 4, true);
    END IF;

    -- إضافة المنتجات إذا لم تكن موجودة
    IF NOT EXISTS (SELECT 1 FROM items LIMIT 1) THEN
        -- برجر ليفل الوحش
        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'برجر "ميزو" الكلاسيك', 'Noob Burger', 85, 1, true, true
        FROM categories c WHERE c.name_en = 'BOSS BURGERS' LIMIT 1;

        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'دبل دامبج', 'Double Damage', 110, 2, true, true
        FROM categories c WHERE c.name_en = 'BOSS BURGERS' LIMIT 1;

        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'تشيكن سنايبر', 'Sniper Chicken', 90, 3, true, true
        FROM categories c WHERE c.name_en = 'BOSS BURGERS' LIMIT 1;

        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'ذا تانك', 'The Tank', 140, 4, true, true
        FROM categories c WHERE c.name_en = 'BOSS BURGERS' LIMIT 1;

        -- الامدادات الجانبية
        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'بطاطس مقلية', 'Golden Fries', 25, 1, true, true
        FROM categories c WHERE c.name_en = 'LOOT BOX - SIDES' LIMIT 1;

        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'بطاطس وعليها جبنة', 'Magma Fries', 40, 2, true, true
        FROM categories c WHERE c.name_en = 'LOOT BOX - SIDES' LIMIT 1;

        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'اصابع موتزاريلا', 'Mozzarella Sticks', 50, 3, true, true
        FROM categories c WHERE c.name_en = 'LOOT BOX - SIDES' LIMIT 1;

        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'حلقات بصل', 'Sonic Rings', 35, 4, true, true
        FROM categories c WHERE c.name_en = 'LOOT BOX - SIDES' LIMIT 1;

        -- شاورما السرعة
        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'ساندويش "كويك سكوب"', 'Quick Scope', 55, 1, true, true
        FROM categories c WHERE c.name_en = 'RUSH SHAWERMA' LIMIT 1;

        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'فتة "الأوبن ورلد"', 'Open World Fatteh', 75, 2, true, true
        FROM categories c WHERE c.name_en = 'RUSH SHAWERMA' LIMIT 1;

        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'صاروخ "كومبو"', 'Combo Rocket', 65, 3, true, true
        FROM categories c WHERE c.name_en = 'RUSH SHAWERMA' LIMIT 1;

        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'وجبة "السكواد"', 'Squad Meal', 200, 4, true, true
        FROM categories c WHERE c.name_en = 'RUSH SHAWERMA' LIMIT 1;

        -- جرعات الطاقة
        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'موهيتو "ميزو"', 'Purple Potion', 35, 1, true, true
        FROM categories c WHERE c.name_en = 'MANA & POTIONS' LIMIT 1;

        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'مشروب الطاقة', 'XP Boost', 30, 2, true, true
        FROM categories c WHERE c.name_en = 'MANA & POTIONS' LIMIT 1;

        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'ميلك شيك اوريو', 'Dark Matter', 45, 3, true, true
        FROM categories c WHERE c.name_en = 'MANA & POTIONS' LIMIT 1;

        INSERT INTO items (category_id, name, name_en, price, display_order, is_active, is_available)
        SELECT c.id, 'مياه غازية', 'Soft Drinks', 15, 4, true, true
        FROM categories c WHERE c.name_en = 'MANA & POTIONS' LIMIT 1;
    END IF;

    -- إضافة الإعدادات إذا لم تكن موجودة
    INSERT INTO settings (key, value) VALUES
    ('cheat_code', 'admin123123'),
    ('instant_transfer_number', '0501234567')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END $$;

-- 5. التحقق من البيانات
SELECT '=== Categories ===' as info;
SELECT id, name, name_en, is_active FROM categories ORDER BY display_order;

SELECT '=== Items ===' as info;
SELECT i.id, i.name, c.name as category, i.price, i.is_active, i.is_available 
FROM items i 
LEFT JOIN categories c ON i.category_id = c.id 
ORDER BY c.display_order, i.display_order;

SELECT '=== Settings ===' as info;
SELECT key, value FROM settings;
