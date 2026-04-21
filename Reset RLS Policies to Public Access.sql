-- ============================================
-- إصلاح شامل لجميع RLS Policies
-- نفذ هذا الملف في Supabase SQL Editor
-- ============================================

-- 1. حذف جميع Policies القديمة
DROP POLICY IF EXISTS "Allow public read access to active categories" ON categories;
DROP POLICY IF EXISTS "Allow public read access to active items" ON items;
DROP POLICY IF EXISTS "Allow public read access to settings" ON settings;
DROP POLICY IF EXISTS "Public can view active categories" ON categories;
DROP POLICY IF EXISTS "Public can view active items" ON items;
DROP POLICY IF EXISTS "Public can view settings" ON settings;
DROP POLICY IF EXISTS "Public can read all categories" ON categories;
DROP POLICY IF EXISTS "Public can read all items" ON items;
DROP POLICY IF EXISTS "Public can insert customers" ON customers;
DROP POLICY IF EXISTS "Public can update customers" ON customers;
DROP POLICY IF EXISTS "Public can read customers" ON customers;
DROP POLICY IF EXISTS "Public can insert orders" ON orders;
DROP POLICY IF EXISTS "Public can read orders" ON orders;
DROP POLICY IF EXISTS "Public can update orders" ON orders;
DROP POLICY IF EXISTS "Public can insert order items" ON order_items;
DROP POLICY IF EXISTS "Public can read order items" ON order_items;
DROP POLICY IF EXISTS "Public can insert customer notes" ON customer_notes;
DROP POLICY IF EXISTS "Public can read customer notes" ON customer_notes;
DROP POLICY IF EXISTS "Public can insert categories" ON categories;
DROP POLICY IF EXISTS "Public can update categories" ON categories;
DROP POLICY IF EXISTS "Public can delete categories" ON categories;
DROP POLICY IF EXISTS "Public can insert items" ON items;
DROP POLICY IF EXISTS "Public can update items" ON items;
DROP POLICY IF EXISTS "Public can delete items" ON items;
DROP POLICY IF EXISTS "Public can update settings" ON settings;
DROP POLICY IF EXISTS "Public can insert settings" ON settings;

-- ============================================
-- 2. Policies للفئات (Categories)
-- ============================================

-- القراءة: السماح للجميع بقراءة جميع الفئات
CREATE POLICY "Public can read all categories" ON categories
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- الإدراج: السماح للجميع بإضافة فئات جديدة
CREATE POLICY "Public can insert categories" ON categories
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- التحديث: السماح للجميع بتحديث الفئات
CREATE POLICY "Public can update categories" ON categories
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- الحذف: السماح للجميع بحذف الفئات
CREATE POLICY "Public can delete categories" ON categories
  FOR DELETE
  TO anon, authenticated
  USING (true);

-- ============================================
-- 3. Policies للمنتجات (Items)
-- ============================================

-- القراءة: السماح للجميع بقراءة جميع المنتجات
CREATE POLICY "Public can read all items" ON items
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- الإدراج: السماح للجميع بإضافة منتجات جديدة
CREATE POLICY "Public can insert items" ON items
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- التحديث: السماح للجميع بتحديث المنتجات
CREATE POLICY "Public can update items" ON items
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- الحذف: السماح للجميع بحذف المنتجات
CREATE POLICY "Public can delete items" ON items
  FOR DELETE
  TO anon, authenticated
  USING (true);

-- ============================================
-- 4. Policies للعملاء (Customers)
-- ============================================

-- القراءة: السماح للجميع بقراءة بيانات العملاء
CREATE POLICY "Public can read customers" ON customers
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- الإدراج: السماح للجميع بإنشاء عملاء جدد (مهم جداً!)
CREATE POLICY "Public can insert customers" ON customers
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- التحديث: السماح للجميع بتحديث بيانات العملاء
CREATE POLICY "Public can update customers" ON customers
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 5. Policies للطلبات (Orders)
-- ============================================

-- القراءة: السماح للجميع بقراءة الطلبات
CREATE POLICY "Public can read orders" ON orders
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- الإدراج: السماح للجميع بإنشاء طلبات جديدة
CREATE POLICY "Public can insert orders" ON orders
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- التحديث: السماح للجميع بتحديث الطلبات (للمسؤول)
CREATE POLICY "Public can update orders" ON orders
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 6. Policies لعناصر الطلب (Order Items)
-- ============================================

-- القراءة: السماح للجميع بقراءة عناصر الطلب
CREATE POLICY "Public can read order items" ON order_items
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- الإدراج: السماح للجميع بإنشاء عناصر طلب جديدة
CREATE POLICY "Public can insert order items" ON order_items
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ============================================
-- 7. Policies لملاحظات العملاء (Customer Notes)
-- ============================================

-- القراءة: السماح للجميع بقراءة الملاحظات
CREATE POLICY "Public can read customer notes" ON customer_notes
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- الإدراج: السماح للجميع بإنشاء ملاحظات جديدة
CREATE POLICY "Public can insert customer notes" ON customer_notes
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ============================================
-- 8. Policies للإعدادات (Settings)
-- ============================================

-- القراءة: السماح للجميع بقراءة الإعدادات
CREATE POLICY "Public can read settings" ON settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- الإدراج: السماح للجميع بإضافة إعدادات جديدة
CREATE POLICY "Public can insert settings" ON settings
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- التحديث: السماح للجميع بتحديث الإعدادات
CREATE POLICY "Public can update settings" ON settings
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 9. التحقق من Policies المضافة
-- ============================================

SELECT 
  tablename,
  policyname,
  cmd as operation,
  roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- يجب أن ترى policies لكل جدول:
-- categories: 4 policies (SELECT, INSERT, UPDATE, DELETE)
-- items: 4 policies (SELECT, INSERT, UPDATE, DELETE)
-- customers: 3 policies (SELECT, INSERT, UPDATE)
-- orders: 3 policies (SELECT, INSERT, UPDATE)
-- order_items: 2 policies (SELECT, INSERT)
-- customer_notes: 2 policies (SELECT, INSERT)
-- settings: 3 policies (SELECT, INSERT, UPDATE)
