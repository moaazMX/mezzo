/*
  # Default item descriptions

  Add Arabic & English descriptions for seeded menu items so they persist as defaults.
*/

-- BOSS BURGERS
UPDATE items
SET 
  description = 'قطعة لحم بقري مشوية على الجريل، شريحة جبنة شيدر سايحة، خس طازة، طماطم، صوص ميزو الخاص داخل عيش محمص.',
  description_en = 'Grilled beef patty, melted cheddar, fresh lettuce, tomato, and our signature Mizo sauce in a toasted bun.'
WHERE name_en = 'Noob Burger';

UPDATE items
SET 
  description = 'اتنين برجر لحم بقري، دبل شيدر، مخلل مقرمش، بصل، وصوص باربيكيو مدخن يخلي كل قضمة تقيلة.',
  description_en = 'Two grilled beef patties, double cheddar, pickles, onions, and smoky BBQ sauce.'
WHERE name_en = 'Double Damage';

UPDATE items
SET 
  description = 'صدر فراخ بانيه مقرمش، خس، جبنة، وصوص رانش كريمي في عيش طري ومحمص.',
  description_en = 'Crispy fried chicken breast, lettuce, cheddar, and creamy ranch in a soft toasted bun.'
WHERE name_en = 'Sniper Chicken';

UPDATE items
SET 
  description = 'ثلاث طبقات لحم بقري مشوي، دبل شيدر، تركي مدخن، بصل مكرمل، وصوص تشيبوتلي حار خفيف.',
  description_en = 'Triple beef patties, double cheddar, smoked turkey, caramelized onions, and light chipotle sauce.'
WHERE name_en = 'The Tank';

-- LOOT BOX - SIDES
UPDATE items
SET 
  description = 'بطاطس متقطعة طازة ومقلية لحد ما تبقى دهبية ومقرمشة.',
  description_en = 'Fresh-cut fries, fried until golden and crispy.'
WHERE name_en = 'Golden Fries';

UPDATE items
SET 
  description = 'بطاطس سخنة متغطية بطبقة جبنة شيدر سايحة ولمسة صوص خفيف.',
  description_en = 'Hot crispy fries topped with melted cheddar and a light sauce drizzle.'
WHERE name_en = 'Magma Fries';

UPDATE items
SET 
  description = 'أصابع موتزاريلا مقرمشة من بره وسايحة من جوه، تتقدم مع صوص مارينارا.',
  description_en = 'Crispy on the outside, perfectly melted mozzarella inside. Served with marinara sauce.'
WHERE name_en = 'Mozzarella Sticks';

UPDATE items
SET 
  description = 'حلقات بصل متغطية بطبقة مقرمشة، خفيفة وطعمها مظبوط.',
  description_en = 'Crispy battered onion rings, light and flavorful.'
WHERE name_en = 'Sonic Rings';

-- RUSH SHAWERMA
UPDATE items
SET 
  description = 'شاورما فراخ متبلة، طحينة، بطاطس، ومخلل ملفوفين في عيش طري.',
  description_en = 'Marinated chicken shawarma with tahini, fries, and pickles wrapped in soft bread.'
WHERE name_en = 'Quick Scope';

UPDATE items
SET 
  description = 'شاورما فراخ فوق أرز وعيش محمص، طحينة وصوص تومية ولمسة صوص حار.',
  description_en = 'Chicken shawarma over rice and toasted bread, topped with tahini, garlic sauce, and a touch of heat.'
WHERE name_en = 'Open World Fatteh';

UPDATE items
SET 
  description = 'شاورما لحم أو فراخ مع بطاطس وصوص خاص داخل عيش سوري محمص.',
  description_en = 'Chicken or beef shawarma with fries and special sauce in toasted Syrian bread.'
WHERE name_en = 'Combo Rocket';

UPDATE items
SET 
  description = '4 ساندوتشات شاورما + بطاطس كبيرة + 4 مشروبات غازية لتجهيز السكواد بالكامل.',
  description_en = '4 shawarma sandwiches + large fries + 4 soft drinks.'
WHERE name_en = 'Squad Meal';

-- MANA & POTIONS
UPDATE items
SET 
  description = 'ليمون طازة، نعناع، ومشروب غازي بطعم فاكهي منعش.',
  description_en = 'Fresh lemon, mint, and sparkling fruity soda.'
WHERE name_en = 'Purple Potion';

UPDATE items
SET 
  description = 'مشروب طاقة بارد يديك دفعة تركيز سريعة في الجيم وفي الجيمز.',
  description_en = 'Chilled energy drink for a quick boost.'
WHERE name_en = 'XP Boost';

UPDATE items
SET 
  description = 'آيس كريم فانيليا مخفوق مع قطع أوريو وصوص شوكولاتة.',
  description_en = 'Vanilla ice cream blended with Oreo pieces and chocolate sauce.'
WHERE name_en = 'Dark Matter';

UPDATE items
SET 
  description = 'اختيارك من المشروبات الغازية المثلجة بجانب وجبتك المفضلة.',
  description_en = 'Your choice of chilled soft drinks.'
WHERE name_en = 'Soft Drinks';

