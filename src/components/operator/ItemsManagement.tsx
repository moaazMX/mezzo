import { useState, useEffect, useRef } from 'react';
import { supabase, Category, Item } from '../../lib/supabase';
import { useRealtimeRefetch } from '../../hooks/useRealtimeSubscription';
import { uploadItemImage, isItemImageOptimized, reoptimizeRemoteItemImage } from '../../lib/imageUpload';
import { Plus, Edit2, Trash2, ArrowUp, ArrowDown, Upload, X, Loader2, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react';

export default function ItemsManagement() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [itemForm, setItemForm] = useState({
    name: '',
    name_en: '',
    description: '',
    description_en: '',
    price: '',
    category_id: '',
    image_url: '',
    has_offer: false,
    offer_price: ''
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [activeMainTab, setActiveMainTab] = useState<'items' | 'categories'>('items');
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    name_en: '',
    icon: 'Package'
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchData();
  }, []);

  useRealtimeRefetch('op-menu', ['categories', 'items'], () => {
    void fetchData();
  });

  const fetchData = async () => {
    const [categoriesRes, itemsRes] = await Promise.all([
      supabase.from('categories').select('*').order('display_order'),
      supabase.from('items').select('*').order('display_order')
    ]);

    if (categoriesRes.data) setCategories(categoriesRes.data);
    if (itemsRes.data) setItems(itemsRes.data);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        alert('الرجاء اختيار ملف صورة صحيح');
        return;
      }
      
      if (file.size > 5 * 1024 * 1024) {
        alert('حجم الصورة يجب أن يكون أقل من 5 ميجابايت');
        return;
      }

      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const uploadImage = async (file: File): Promise<string> => {
    return uploadItemImage(supabase, file);
  };

  const handleSaveItem = async () => {
    setIsUploading(true);
    let imageUrl = itemForm.image_url;

    try {
      if (imageFile) {
        imageUrl = await uploadImage(imageFile);
      }

      const itemData = {
        name: itemForm.name,
        name_en: itemForm.name_en,
        description: itemForm.description || null,
        description_en: itemForm.description_en || null,
        price: Number(itemForm.price || 0),
        category_id: itemForm.category_id,
        image_url: imageUrl,
        has_offer: Boolean(itemForm.has_offer),
        offer_price: itemForm.has_offer ? Number(itemForm.offer_price || 0) : null,
        updated_at: new Date().toISOString()
      };

      if (editingItem) {
        await supabase.from('items').update(itemData).eq('id', editingItem.id);
      } else {
        await supabase.from('items').insert([{ ...itemData, is_active: true, is_available: true }]);
      }

      fetchData();
      setShowItemModal(false);
      setEditingItem(null);
      resetForm();
      setImageFile(null);
      setImagePreview(null);
    } catch (error) {
      console.error('Error saving item:', error);
      alert('حدث خطأ أثناء حفظ الصنف. تأكد من أن الصورة تم رفعها بنجاح.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleEditItem = (item: Item) => {
    setEditingItem(item);
    setItemForm({
      name: item.name,
      name_en: item.name_en,
      description: item.description || '',
      description_en: item.description_en || '',
      price: item.price.toString(),
      category_id: item.category_id,
      image_url: item.image_url,
      has_offer: item.has_offer,
      offer_price: item.offer_price?.toString() || ''
    });
    setShowItemModal(true);
  };

  const handleDeleteItem = async (id: string) => {
    if (confirm('هل أنت متأكد من حذف هذا الصنف؟')) {
      await supabase.from('items').delete().eq('id', id);
      fetchData();
    }
  };

  const toggleItemActive = async (item: Item) => {
    await supabase.from('items').update({ is_active: !item.is_active }).eq('id', item.id);
    fetchData();
  };

  const toggleItemAvailable = async (item: Item) => {
    await supabase.from('items').update({ is_available: !item.is_available }).eq('id', item.id);
    fetchData();
  };

  const moveItem = async (item: Item, direction: 'up' | 'down') => {
    const categoryItems = items.filter(i => i.category_id === item.category_id).sort((a, b) => a.display_order - b.display_order);
    const currentIndex = categoryItems.findIndex(i => i.id === item.id);

    if ((direction === 'up' && currentIndex === 0) || (direction === 'down' && currentIndex === categoryItems.length - 1)) {
      return;
    }

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    const targetItem = categoryItems[targetIndex];

    await Promise.all([
      supabase.from('items').update({ display_order: targetItem.display_order }).eq('id', item.id),
      supabase.from('items').update({ display_order: item.display_order }).eq('id', targetItem.id)
    ]);

    fetchData();
  };

  const resetForm = () => {
    setItemForm({
      name: '',
      name_en: '',
      description: '',
      description_en: '',
      price: '',
      category_id: '',
      image_url: '',
      has_offer: false,
      offer_price: ''
    });
    setEditingItem(null);
    setImageFile(null);
    setImagePreview(null);
  };

  const handleSaveCategory = async () => {
    try {
      if (editingCategory) {
        const { error } = await supabase.from('categories').update({
          name: categoryForm.name,
          name_en: categoryForm.name_en,
          icon: categoryForm.icon,
          updated_at: new Date().toISOString()
        }).eq('id', editingCategory.id);
        if (error) throw error;
      } else {
        // Get max display order
        const maxOrder = Math.max(...categories.map(c => c.display_order || 0), 0);
        const { error } = await supabase.from('categories').insert([{
          name: categoryForm.name,
          name_en: categoryForm.name_en,
          icon: categoryForm.icon,
          display_order: maxOrder + 1,
          is_active: true
        }]);
        if (error) throw error;
      }
      fetchData();
      setShowCategoryModal(false);
      setEditingCategory(null);
      setCategoryForm({ name: '', name_en: '', icon: 'Package' });
    } catch (e) {
      console.error(e);
      const msg = (e as any)?.message || 'حدث خطأ أثناء حفظ القسم';
      alert(msg);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا القسم؟ سيتم حذف جميع الأصناف التابعة له')) return;
    try {
      await supabase.from('categories').delete().eq('id', id);
      fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  const moveCategory = async (id: string, direction: 'up' | 'down') => {
    const index = categories.findIndex(c => c.id === id);
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === categories.length - 1) return;

    const otherIndex = direction === 'up' ? index - 1 : index + 1;
    const current = categories[index];
    const other = categories[otherIndex];

    const currentOrder = current.display_order || 0;
    const otherOrder = other.display_order || 0;

    await Promise.all([
      supabase.from('categories').update({ display_order: otherOrder }).eq('id', current.id),
      supabase.from('categories').update({ display_order: currentOrder }).eq('id', other.id)
    ]);

    fetchData();
  };

  const filteredItems = selectedCategory === 'all'
    ? items
    : items.filter(item => item.category_id === selectedCategory);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-2 bg-gray-900/50 p-1 rounded-lg border border-purple-500/30">
          <button
            onClick={() => setActiveMainTab('items')}
            className={`px-6 py-2 rounded-md font-bold transition-all ${activeMainTab === 'items' ? 'bg-purple-600 text-white' : 'text-purple-300 hover:text-white'}`}
          >
            الأصناف
          </button>
          <button
            onClick={() => setActiveMainTab('categories')}
            className={`px-6 py-2 rounded-md font-bold transition-all ${activeMainTab === 'categories' ? 'bg-purple-600 text-white' : 'text-purple-300 hover:text-white'}`}
          >
            الأقسام
          </button>
        </div>
        <h2 className="text-3xl font-black text-white text-right">إدارة القائمة</h2>
      </div>

      {activeMainTab === 'items' ? (
        <>
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-gray-900/50 p-4 rounded-xl border border-purple-500/30">
            <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
              <button
                onClick={() => {
                  setEditingItem(null);
                  resetForm();
                  setShowItemModal(true);
                }}
                className="w-full sm:w-auto bg-purple-600 hover:bg-purple-500 text-white px-6 py-3 rounded-lg flex items-center justify-center gap-2 transition-all font-bold shadow-lg shadow-purple-900/20"
              >
                <Plus className="w-5 h-5" />
                <span>إضافة صنف جديد</span>
              </button>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 w-full md:w-auto scrollbar-hide">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`px-4 py-2 rounded-lg font-bold transition-all whitespace-nowrap ${selectedCategory === 'all'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/40'
                  : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
              >
                الكل
              </button>
              {categories.map(category => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={`px-4 py-2 rounded-lg font-bold transition-all whitespace-nowrap ${selectedCategory === category.id
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/40'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                    }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredItems.map(item => (
              <div key={item.id} className="bg-gray-900/50 border border-purple-500/30 rounded-xl overflow-hidden flex flex-col group hover:border-purple-400/50 transition-all">
                <div className="aspect-video relative overflow-hidden bg-gray-800">
                  <img
                    src={item.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500'}
                    alt={item.name}
                    className="w-full h-full object-cover"
                  />
                  {!item.is_active && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center">
                      <span className="bg-red-600 text-white px-3 py-1 rounded-full font-bold text-sm">معطل</span>
                    </div>
                  )}
                  {item.has_offer && (
                    <div className="absolute top-2 right-2 bg-yellow-500 text-black px-2 py-1 rounded-md font-black text-xs shadow-lg">
                      عرض خاص
                    </div>
                  )}
                </div>

                <div className="p-4 flex-1 flex flex-col">
                  <div className="flex items-start justify-between mb-2">
                    <div className="text-right flex-1">
                      <h3 className="text-lg font-bold text-white line-clamp-1">{item.name}</h3>
                      <p className="text-xs text-purple-400 font-bold mb-1">{item.name_en}</p>
                    </div>
                    <div className="text-left ml-4">
                      <p className="text-primary font-black text-xl leading-none">
                        {item.price} <span className="text-xs font-bold text-muted">ج</span>
                      </p>
                      {item.has_offer && (
                        <p className="text-green-500 font-bold text-sm">
                          {item.offer_price} <span className="text-[10px]">ج</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <p className="text-gray-400 text-sm line-clamp-2 text-right mb-4 flex-1">
                    {item.description || 'لا يوجد وصف'}
                  </p>

                  <div className="flex items-center justify-between pt-4 border-t border-purple-500/20">
                    <div className="flex gap-2">
                      <button
                        onClick={() => toggleItemActive(item)}
                        className={`p-2 rounded-lg transition-all shadow-lg ${item.is_active ? 'bg-green-600/30 text-green-400 hover:bg-green-600 hover:text-white shadow-green-900/20' : 'bg-gray-600/30 text-gray-400 hover:bg-gray-600 hover:text-white shadow-gray-900/20'}`}
                        title={item.is_active ? "إخفاء الصنف" : "إظهار الصنف"}
                      >
                        {item.is_active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => toggleItemAvailable(item)}
                        className={`p-2 rounded-lg transition-all shadow-lg ${item.is_available ? 'bg-emerald-600/30 text-emerald-400 hover:bg-emerald-600 hover:text-white shadow-emerald-900/20' : 'bg-orange-600/30 text-orange-400 hover:bg-orange-600 hover:text-white shadow-orange-900/20'}`}
                        title={item.is_available ? "جعل الصنف غير متوفر" : "جعل الصنف متوفر"}
                      >
                        {item.is_available ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => handleEditItem(item)}
                        className="p-2 bg-blue-600/30 text-blue-400 rounded-lg hover:bg-blue-600 hover:text-white transition-all shadow-lg shadow-blue-900/20"
                        title="تعديل"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        className="p-2 bg-red-600/30 text-red-400 rounded-lg hover:bg-red-600 hover:text-white transition-all shadow-lg shadow-red-900/20"
                        title="حذف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => moveItem(item, 'up')}
                        className="p-2 bg-gray-800 text-gray-400 rounded-lg hover:bg-purple-600 hover:text-white transition-all"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => moveItem(item, 'down')}
                        className="p-2 bg-gray-800 text-gray-400 rounded-lg hover:bg-purple-600 hover:text-white transition-all"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between bg-gray-900/50 p-4 rounded-xl border border-purple-500/30">
            <button
              onClick={() => {
                setEditingCategory(null);
                setCategoryForm({ name: '', name_en: '', icon: 'Package' });
                setShowCategoryModal(true);
              }}
              className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-3 rounded-lg flex items-center gap-2 transition-all font-bold"
            >
              <Plus className="w-5 h-5" />
              <span>إضافة قسم جديد</span>
            </button>
            <p className="text-gray-400 font-bold">إدارة أقسام المنيو والترتيب</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map((category, index) => (
              <div key={category.id} className="bg-gray-900/50 border border-purple-500/30 rounded-xl p-4 flex items-center justify-between group">
                <div className="flex items-center gap-4">
                  <div className="flex flex-col">
                    <button
                      onClick={() => moveCategory(category.id, 'up')}
                      disabled={index === 0}
                      className="p-1 text-gray-500 hover:text-purple-400 disabled:opacity-0"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => moveCategory(category.id, 'down')}
                      disabled={index === categories.length - 1}
                      className="p-1 text-gray-500 hover:text-purple-400 disabled:opacity-0"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="text-right">
                    <h3 className="text-white font-bold">{category.name}</h3>
                    <p className="text-purple-400 text-xs uppercase font-black">{category.name_en}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingCategory(category);
                      setCategoryForm({
                        name: category.name,
                        name_en: category.name_en,
                        icon: category.icon
                      });
                      setShowCategoryModal(true);
                    }}
                    className="p-2 bg-blue-600/20 text-blue-400 rounded-lg hover:bg-blue-600 hover:text-white transition-all"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteCategory(category.id)}
                    className="p-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600 hover:text-white transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Item Modal */}
      {showItemModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-gray-900 border-2 border-purple-500 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="bg-purple-600 p-4 flex items-center justify-between sticky top-0 z-10">
              <button 
                onClick={() => {
                  setShowItemModal(false);
                  setEditingItem(null);
                  resetForm();
                  setImageFile(null);
                  setImagePreview(null);
                }} 
                className="text-white hover:text-red-300"
              >
                <X className="w-6 h-6" />
              </button>
              <h3 className="text-xl font-bold text-white">
                {editingItem ? 'تعديل صنف' : 'إضافة صنف جديد'}
              </h3>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-purple-300 mb-2 text-right">عنوان العنصر (عربي)</label>
                  <input
                    type="text"
                    value={itemForm.name}
                    onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                    className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-right"
                    dir="rtl"
                  />
                </div>
                <div>
                  <label className="block text-purple-300 mb-2 text-right">Item Name (English)</label>
                  <input
                    type="text"
                    value={itemForm.name_en}
                    onChange={(e) => setItemForm({ ...itemForm, name_en: e.target.value })}
                    className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-purple-300 mb-2 text-right">الوصف (عربي)</label>
                  <textarea
                    value={itemForm.description}
                    onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                    className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-right resize-none"
                    rows={3}
                    dir="rtl"
                  />
                </div>
                <div>
                  <label className="block text-purple-300 mb-2 text-right">Description (English)</label>
                  <textarea
                    value={itemForm.description_en}
                    onChange={(e) => setItemForm({ ...itemForm, description_en: e.target.value })}
                    className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white resize-none"
                    rows={3}
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-purple-300 mb-2 text-right">القسم</label>
                  <select
                    value={itemForm.category_id}
                    onChange={(e) => setItemForm({ ...itemForm, category_id: e.target.value })}
                    className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-right font-bold"
                    dir="rtl"
                  >
                    <option value="">اختر القسم</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-purple-300 mb-2 text-right">السعر</label>
                  <input
                    type="number"
                    step="0.01"
                    value={itemForm.price}
                    onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })}
                    className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-right"
                    dir="rtl"
                  />
                </div>
                <div>
                  <label className="block text-purple-300 mb-2 text-right">سعر العرض</label>
                  <input
                    type="number"
                    step="0.01"
                    value={itemForm.offer_price}
                    onChange={(e) => setItemForm({ ...itemForm, offer_price: e.target.value })}
                    disabled={!itemForm.has_offer}
                    className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-right disabled:opacity-50"
                    dir="rtl"
                  />
                </div>
              </div>

              <div>
                <label className="flex items-center justify-end gap-2 text-purple-300 cursor-pointer">
                  <span>يوجد عرض خاص</span>
                  <input
                    type="checkbox"
                    checked={itemForm.has_offer}
                    onChange={(e) => setItemForm({ ...itemForm, has_offer: e.target.checked })}
                    className="w-5 h-5"
                  />
                </label>
              </div>

              <div>
                <label className="block text-purple-300 mb-2 text-right">صورة الصنف</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                  id="item-image-upload"
                />
                <label
                  htmlFor="item-image-upload"
                  className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-4 py-3 rounded-lg cursor-pointer transition-colors font-bold mb-2"
                >
                  <Upload className="w-5 h-5" />
                  <span>{imageFile ? 'تغيير الصورة' : 'اختر صورة من الجهاز'}</span>
                </label>
                
                {!imageFile && itemForm.image_url && (
                  <div className="mt-2">
                    <label className="block text-purple-300 mb-2 text-right text-sm">أو أدخل رابط الصورة</label>
                    <input
                      type="text"
                      value={itemForm.image_url}
                      onChange={(e) => setItemForm({ ...itemForm, image_url: e.target.value })}
                      className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white"
                      placeholder="https://example.com/image.jpg"
                      dir="ltr"
                    />
                  </div>
                )}

                {(imagePreview || itemForm.image_url) && (
                  <div className="relative h-40 bg-gray-800 rounded-lg overflow-hidden mt-2 border-2 border-purple-500/50">
                    <img 
                      src={imagePreview || itemForm.image_url} 
                      alt="Preview" 
                      className="w-full h-full object-cover" 
                    />
                    {imageFile && (
                      <button
                        type="button"
                        onClick={handleRemoveImage}
                        className="absolute top-2 right-2 bg-red-600 hover:bg-red-500 text-white p-2 rounded-full transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  onClick={() => {
                    setShowItemModal(false);
                    setEditingItem(null);
                    resetForm();
                    setImageFile(null);
                    setImagePreview(null);
                  }}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg transition-colors"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleSaveItem}
                  disabled={!itemForm.name || !itemForm.name_en || !itemForm.price || !itemForm.category_id || isUploading}
                  className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>جاري الحفظ...</span>
                    </>
                  ) : (
                    <>
                      {editingItem ? 'حفظ التعديلات' : 'إضافة الصنف'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Category Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-gray-900 border-2 border-purple-500 rounded-2xl w-full max-w-md overflow-hidden">
            <div className="bg-purple-600 p-4 flex items-center justify-between">
              <button onClick={() => setShowCategoryModal(false)} className="text-white hover:text-red-300">
                <X className="w-6 h-6" />
              </button>
              <h3 className="text-xl font-bold text-white">
                {editingCategory ? 'تعديل قسم' : 'إضافة قسم جديد'}
              </h3>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-purple-300 mb-2 text-right font-bold">اسم القسم (بالعربي)</label>
                <input
                  type="text"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-right"
                  placeholder="مثال: بيتزا، برجر، مشروبات"
                />
              </div>
              <div>
                <label className="block text-purple-300 mb-2 text-right font-bold">اسم القسم (بالإنجليزية)</label>
                <input
                  type="text"
                  value={categoryForm.name_en}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name_en: e.target.value })}
                  className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white"
                  placeholder="e.g. Pizza, Burger, Drinks"
                  dir="ltr"
                />
              </div>
              <div className="pt-4 flex gap-3">
                <button
                  onClick={() => setShowCategoryModal(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-xl font-bold"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleSaveCategory}
                  disabled={!categoryForm.name || !categoryForm.name_en}
                  className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 text-white py-3 rounded-xl font-bold"
                >
                  حفظ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}