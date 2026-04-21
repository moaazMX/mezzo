-- ============================================
-- إعداد Supabase Storage لرفع صور الأصناف
-- نفذ هذا الملف في Supabase SQL Editor
-- ============================================

-- 1. إنشاء bucket جديد لصور الأصناف
-- ملاحظة: إذا كان الـ bucket موجود بالفعل، سيتم تجاهل هذا الأمر
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'item-images', 
  'item-images', 
  true,
  5, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

-- ============================================
-- 2. حذف Policies القديمة إن وجدت
-- ============================================
DROP POLICY IF EXISTS "Public can view item images" ON storage.objects;
DROP POLICY IF EXISTS "Public can upload item images" ON storage.objects;
DROP POLICY IF EXISTS "Public can update item images" ON storage.objects;
DROP POLICY IF EXISTS "Public can delete item images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access" ON storage.objects;
DROP POLICY IF EXISTS "Allow public upload" ON storage.objects;

-- ============================================
-- 3. إعداد RLS Policies للـ Storage
-- ============================================

-- السماح للجميع بقراءة الصور (public read)
CREATE POLICY "Public can view item images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'item-images');

-- السماح للجميع برفع الصور (public upload)
CREATE POLICY "Public can upload item images"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'item-images');

-- السماح للجميع بتحديث الصور (public update)
CREATE POLICY "Public can update item images"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'item-images')
WITH CHECK (bucket_id = 'item-images');

-- السماح للجميع بحذف الصور (public delete)
CREATE POLICY "Public can delete item images"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'item-images');

-- ============================================
-- تم الانتهاء
-- ============================================
-- بعد تنفيذ هذا الملف، يمكنك رفع الصور من الواجهة
-- ============================================
