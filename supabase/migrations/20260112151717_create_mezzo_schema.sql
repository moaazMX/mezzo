/*
  # MEZZO Online Orders System - Complete Database Schema

  ## New Tables
  
  ### 1. categories
  - `id` (uuid, primary key)
  - `name` (text) - Category name in Arabic
  - `name_en` (text) - Category name in English
  - `icon` (text) - Emoji or icon identifier
  - `display_order` (integer) - Order of display
  - `is_active` (boolean) - Whether category is active
  - `image_url` (text) - Category image
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 2. items
  - `id` (uuid, primary key)
  - `category_id` (uuid, foreign key)
  - `name` (text) - Item name
  - `name_en` (text) - Item name in English
  - `price` (decimal) - Item price
  - `image_url` (text) - Item image
  - `is_available` (boolean) - Whether item is currently available
  - `is_active` (boolean) - Whether item is active
  - `has_offer` (boolean) - Whether item has special offer
  - `offer_price` (decimal) - Offer price if applicable
  - `display_order` (integer) - Order within category
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 3. customers
  - `id` (uuid, primary key)
  - `name` (text) - Customer name
  - `phone` (text) - Phone number
  - `street` (text) - Street address
  - `area` (text) - Area
  - `city` (text) - City
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 4. customer_notes
  - `id` (uuid, primary key)
  - `customer_id` (uuid, foreign key)
  - `order_id` (uuid, foreign key)
  - `note` (text) - Note content
  - `created_by` (text) - 'operator' or 'system'
  - `created_at` (timestamptz)

  ### 5. orders
  - `id` (uuid, primary key)
  - `customer_id` (uuid, foreign key)
  - `order_number` (text) - Human-readable order number
  - `status` (text) - under_review, preparing, on_way, arrived, completed, cancelled, cancellation_pending
  - `payment_method` (text) - cash or instant_transfer
  - `total_amount` (decimal) - Total order amount
  - `cancellation_reason` (text) - Reason for cancellation
  - `cancelled_by` (text) - 'customer' or 'operator'
  - `cancellation_stage` (text) - Stage when cancelled
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 6. order_items
  - `id` (uuid, primary key)
  - `order_id` (uuid, foreign key)
  - `item_id` (uuid, foreign key)
  - `item_name` (text) - Snapshot of item name
  - `quantity` (integer)
  - `unit_price` (decimal) - Price at time of order
  - `subtotal` (decimal)

  ### 7. settings
  - `id` (uuid, primary key)
  - `key` (text, unique) - Setting key
  - `value` (text) - Setting value
  - `updated_at` (timestamptz)

  ## Security
  - Enable RLS on all tables
  - Public read access for categories and items (customer facing)
  - No direct write access (all writes through edge functions)
*/

-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_en text NOT NULL,
  icon text DEFAULT '',
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  image_url text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create items table
CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  name_en text NOT NULL,
  price decimal(10,2) NOT NULL,
  image_url text DEFAULT '',
  is_available boolean DEFAULT true,
  is_active boolean DEFAULT true,
  has_offer boolean DEFAULT false,
  offer_price decimal(10,2),
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create customers table
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  street text DEFAULT '',
  area text DEFAULT '',
  city text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  order_number text UNIQUE NOT NULL,
  status text DEFAULT 'under_review',
  payment_method text NOT NULL,
  total_amount decimal(10,2) NOT NULL,
  cancellation_reason text DEFAULT '',
  cancelled_by text DEFAULT '',
  cancellation_stage text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create order_items table
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  quantity integer NOT NULL,
  unit_price decimal(10,2) NOT NULL,
  subtotal decimal(10,2) NOT NULL
);

-- Create customer_notes table
CREATE TABLE IF NOT EXISTS customer_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by text DEFAULT 'operator',
  created_at timestamptz DEFAULT now()
);

-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_customer_notes_customer ON customer_notes(customer_id);

-- Enable Row Level Security
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for public read access
CREATE POLICY "Allow public read access to active categories"
  ON categories FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "Allow public read access to active items"
  ON items FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "Allow public read access to settings"
  ON settings FOR SELECT
  TO anon, authenticated
  USING (key IN ('instant_transfer_number'));

-- Insert default settings
INSERT INTO settings (key, value) VALUES
  ('admin_password', 'moaazMXpl011#'),
  ('instant_transfer_number', '01000000000')
ON CONFLICT (key) DO NOTHING;

-- Insert initial categories
INSERT INTO categories (name, name_en, icon, display_order) VALUES
  ('برجر ليفل الوحش', 'BOSS BURGERS', '🔥', 1),
  ('الامدادات الجانبية', 'LOOT BOX - SIDES', '🎁', 2),
  ('شاورما السرعة', 'RUSH SHAWERMA', '⚡', 3),
  ('جرعات الطاقة', 'MANA & POTIONS', '🧪', 4)
ON CONFLICT DO NOTHING;

-- Insert initial items
INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'برجر "ميزو" الكلاسيك', 'Noob Burger', 85, 1
FROM categories c WHERE c.name_en = 'BOSS BURGERS'
ON CONFLICT DO NOTHING;

INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'دبل دامبج', 'Double Damage', 110, 2
FROM categories c WHERE c.name_en = 'BOSS BURGERS'
ON CONFLICT DO NOTHING;

INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'تشيكن سنايبر', 'Sniper Chicken', 90, 3
FROM categories c WHERE c.name_en = 'BOSS BURGERS'
ON CONFLICT DO NOTHING;

INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'ذا تانك', 'The Tank', 140, 4
FROM categories c WHERE c.name_en = 'BOSS BURGERS'
ON CONFLICT DO NOTHING;

INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'بطاطس مقلية', 'Golden Fries', 25, 1
FROM categories c WHERE c.name_en = 'LOOT BOX - SIDES'
ON CONFLICT DO NOTHING;

INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'بطاطس وعليها جبنة', 'Magma Fries', 40, 2
FROM categories c WHERE c.name_en = 'LOOT BOX - SIDES'
ON CONFLICT DO NOTHING;

INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'اصابع موتزاريلا', 'Mozzarella Sticks', 50, 3
FROM categories c WHERE c.name_en = 'LOOT BOX - SIDES'
ON CONFLICT DO NOTHING;

INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'حلقات بصل', 'Sonic Rings', 35, 4
FROM categories c WHERE c.name_en = 'LOOT BOX - SIDES'
ON CONFLICT DO NOTHING;

INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'ساندويش "كويك سكوب"', 'Quick Scope', 55, 1
FROM categories c WHERE c.name_en = 'RUSH SHAWERMA'
ON CONFLICT DO NOTHING;

INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'فتة "الأوبن ورلد"', 'Open World Fatteh', 75, 2
FROM categories c WHERE c.name_en = 'RUSH SHAWERMA'
ON CONFLICT DO NOTHING;

INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'صاروخ "كومبو"', 'Combo Rocket', 65, 3
FROM categories c WHERE c.name_en = 'RUSH SHAWERMA'
ON CONFLICT DO NOTHING;

INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'وجبة "السكواد"', 'Squad Meal', 200, 4
FROM categories c WHERE c.name_en = 'RUSH SHAWERMA'
ON CONFLICT DO NOTHING;

INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'موهيتو "ميزو"', 'Purple Potion', 35, 1
FROM categories c WHERE c.name_en = 'MANA & POTIONS'
ON CONFLICT DO NOTHING;

INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'مشروب الطاقة', 'XP Boost', 30, 2
FROM categories c WHERE c.name_en = 'MANA & POTIONS'
ON CONFLICT DO NOTHING;

INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'ميلك شيك اوريو', 'Dark Matter', 45, 3
FROM categories c WHERE c.name_en = 'MANA & POTIONS'
ON CONFLICT DO NOTHING;

INSERT INTO items (category_id, name, name_en, price, display_order)
SELECT c.id, 'مياه غازية', 'Soft Drinks', 15, 4
FROM categories c WHERE c.name_en = 'MANA & POTIONS'
ON CONFLICT DO NOTHING;