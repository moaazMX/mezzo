-- إضافة الأعمدة المطلوبة لقاعدة البيانات
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS pickup_deadline_updated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS pickup_deadline_operator_seen BOOLEAN DEFAULT FALSE;
