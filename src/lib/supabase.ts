import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export interface Category {
  id: string;
  name: string;
  name_en: string;
  icon: string;
  display_order: number;
  is_active: boolean;
  image_url: string;
  created_at: string;
  updated_at: string;
}

export interface Item {
  id: string;
  category_id: string;
  name: string;
  name_en: string;
  description?: string;
  description_en?: string;
  price: number;
  image_url: string;
  is_available: boolean;
  is_active: boolean;
  has_offer: boolean;
  offer_price?: number;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address_type?: 'apartment' | 'house' | 'workplace' | 'custom';
  address_label?: string;
  street: string;
  area: string;
  city: string;
  apartment?: string;
  floor?: string;
  house_name?: string;
  company_name?: string;
  device_fingerprint?: string;
  latitude?: number;
  longitude?: number;
  building_number?: string;
  landmark?: string;
  /** SHA-256 hex — إن وُجد يُطلب عند الطلب بنفس الرقم */
  phone_password_hash?: string | null;
  /** SHA-256 hex — كود أرقام للاسترجاع عند نسيان كلمة المرور */
  phone_recovery_code_hash?: string | null;
  /** بصمة الجهاز المالك لكلمة المرور (لا تتغير مع تحديثات العنوان) */
  phone_password_owner_fingerprint?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  customer_id: string;
  order_number: string;
  status: 'under_review' | 'preparing' | 'on_way' | 'arrived' | 'completed' | 'cancelled' | 'cancellation_pending';
  payment_method: 'cash' | 'instant_transfer';
  total_amount: number;
  cancellation_reason: string;
  cancelled_by: string;
  cancellation_stage: string;
  order_note?: string;
  applied_coupon_id?: string | null;
  applied_coupon_code?: string | null;
  applied_coupon_discount_percent?: number | null;
  delivery_method?: 'delivery' | 'pickup';
  building_number?: string;
  landmark?: string;
  customer_address_type?: 'apartment' | 'house' | 'workplace' | 'custom';
  customer_address_label?: string;
  customer_house_name?: string;
  customer_company_name?: string;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  item_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface CustomerNote {
  id: string;
  customer_id: string;
  order_id: string | null;
  general_note_id?: string | null;
  note: string;
  created_by: string;
  is_public?: boolean;
  created_at: string;
}

export interface Setting {
  id: string;
  key: string;
  value: string;
  updated_at: string;
}

export interface CustomerGeneralNote {
  id: string;
  general_note_id?: string | null;
  customer_phone: string;
  customer_name: string;
  note: string;
  created_by: string;
  is_public?: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeviceCoupon {
  id: string;
  device_fingerprint: string;
  code: string;
  discount_percent: number;
  expires_at?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  is_used: boolean;
  is_disabled?: boolean;
  created_at: string;
}

export interface PolygonPoint {
  lat: number;
  lng: number;
}

export interface DeliveryZoneLayer {
  id: string;
  zone_id?: string;
  service_id?: string;
  name: string | null;
  order_index: number;
  polygon_points: PolygonPoint[];
  delivery_price: number;
  created_at: string;
}

export type BranchLocation = PolygonPoint;

export interface DeliveryService {
  id: string;
  name: string;
  branch_location: BranchLocation | null;
  is_active: boolean;
  created_at: string;
  // Nested delivery layers (priced polygons) for this service
  layers?: DeliveryZoneLayer[];
}

export interface DeliveryZone {
  id: string;
  name: string;
  polygon_points: PolygonPoint[]; // Array of {lat, lng} points forming the zone boundary
  is_active: boolean;
  created_at: string;
  base_delivery_price?: number;
  // Legacy fields (for migration compatibility)
  min_lat?: number;
  max_lat?: number;
  min_lng?: number;
  max_lng?: number;
  // Optional nested delivery service layers (yellow inner polygons)
  layers?: DeliveryZoneLayer[];
}