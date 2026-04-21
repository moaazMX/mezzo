/*
  # Update delivery_zones to use polygon instead of min/max
  
  - Changes from rectangular zones (min/max lat/lng) to polygon-based zones
  - Polygon is stored as JSON array of {lat, lng} points
*/

-- Add new polygon column
ALTER TABLE delivery_zones
ADD COLUMN IF NOT EXISTS polygon_points jsonb;

-- Migrate existing min/max zones to polygon rectangles
UPDATE delivery_zones
SET polygon_points = jsonb_build_array(
  jsonb_build_object('lat', min_lat, 'lng', min_lng),
  jsonb_build_object('lat', max_lat, 'lng', min_lng),
  jsonb_build_object('lat', max_lat, 'lng', max_lng),
  jsonb_build_object('lat', min_lat, 'lng', max_lng)
)
WHERE polygon_points IS NULL;

-- Make polygon_points required for new zones (but keep old columns for migration period)
-- We'll drop min/max columns in a future migration if needed

-- Add constraint to ensure polygon has at least 3 points
ALTER TABLE delivery_zones
ADD CONSTRAINT check_polygon_min_points 
CHECK (
  polygon_points IS NULL OR 
  jsonb_array_length(polygon_points) >= 3
);
