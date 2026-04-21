# تعليمات تشغيل Migration

## المشكلة
إذا ظهرت رسالة خطأ عند إنشاء الطلب، فمن المحتمل أن migration الجديد لم يتم تشغيله بعد.

## الحل

### 1. تشغيل Migration في Supabase

افتح Supabase Dashboard وانتقل إلى:
- SQL Editor
- New Query
- انسخ محتوى الملف: `supabase/migrations/20260115000000_add_notes_archive_device_search.sql`
- الصق المحتوى في SQL Editor
- اضغط Run

### 2. التحقق من Migration

بعد تشغيل Migration، تأكد من:
- ✅ جدول `orders` يحتوي على عمود `order_note`
- ✅ جدول `customers` يحتوي على عمود `device_fingerprint`
- ✅ جدول `customer_notes` يسمح بـ `order_id` كـ NULL
- ✅ الجداول التالية موجودة:
  - `archive_orders`
  - `archive_order_items`
  - `archive_customer_notes`

### 3. التحقق من RLS Policies

تأكد من أن RLS Policies تسمح بالكتابة في الجداول المطلوبة.

## ملاحظة
الكود الآن محسّن ليعمل حتى لو لم يتم تشغيل migration بعد، لكن بعض الميزات لن تعمل بشكل كامل.
