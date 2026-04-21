-- ============================================
-- حذف جميع بيانات الأرشيف يدوياً
-- استخدم هذا الملف إذا فشل الحذف من الواجهة
-- ============================================

-- 1. حذف جميع أصناف الأرشيف
DELETE FROM archive_order_items;

-- 2. حذف جميع ملاحظات الأرشيف
DELETE FROM archive_customer_notes;

-- 3. حذف جميع طلبات الأرشيف
DELETE FROM archive_orders;

-- 4. التحقق من الحذف
SELECT 
  (SELECT COUNT(*) FROM archive_orders) as remaining_orders,
  (SELECT COUNT(*) FROM archive_order_items) as remaining_items,
  (SELECT COUNT(*) FROM archive_customer_notes) as remaining_notes;

-- يجب أن تكون جميع القيم 0 بعد الحذف
