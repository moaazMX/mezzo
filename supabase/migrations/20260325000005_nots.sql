-- 1. التأكد من وجود الأعمدة اللازمة وسهولة الربط
-- (نفترض أن الجداول موجودة بالفعل: customer_notes و customer_general_notes)

-- 2. وظيفة لتحديث الملاحظة العامة عند تعديل ملاحظة في طلب معين
CREATE OR REPLACE FUNCTION update_general_note_from_order_note()
RETURNS TRIGGER AS $$
BEGIN
    -- تحديث الملاحظة العامة المطابقة (بناءً على النص القديم ورقم العميل)
    UPDATE customer_general_notes
    SET note = NEW.note,
        updated_at = NOW()
    WHERE customer_phone = (SELECT phone FROM customers WHERE id = NEW.customer_id)
      AND note = OLD.note;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. تفعيل المشغل (Trigger) للتحديث التلقائي
DROP TRIGGER IF EXISTS tr_update_general_note ON customer_notes;
CREATE TRIGGER tr_update_general_note
    AFTER UPDATE ON customer_notes
    FOR EACH ROW
    WHEN (OLD.note IS DISTINCT FROM NEW.note)
    EXECUTE FUNCTION update_general_note_from_order_note();

-- 4. وظيفة لحذف الملاحظة العامة عند حذفها من الطلب (إختياري حسب رغبتك)
CREATE OR REPLACE FUNCTION delete_general_note_from_order_note()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM customer_general_notes
    WHERE customer_phone = (SELECT phone FROM customers WHERE id = OLD.customer_id)
      AND note = OLD.note;
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 5. تفعيل مشغل الحذف
DROP TRIGGER IF EXISTS tr_delete_general_note ON customer_notes;
CREATE TRIGGER tr_delete_general_note
    AFTER DELETE ON customer_notes
    FOR EACH ROW
    EXECUTE FUNCTION delete_general_note_from_order_note();

-- 6. إضافة منطق "المراجعة" لضمان التزامن
-- هذا يضمن أن أي تعديل يتم من الـ Dashboard يمر عبر هذه القواعد البرمجية (SQL)
-- لضمان سلامة البيانات حتى خارج تطبيق الويب.
