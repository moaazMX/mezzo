/*
  # Make min_lat/max_lat/min_lng/max_lng nullable in delivery_zones
  
  - These fields are no longer required since we use polygon_points
  - They can be calculated from polygon_points if needed
*/

-- Make the min/max columns nullable
ALTER TABLE delivery_zones
  ALTER COLUMN min_lat DROP NOT NULL,
  ALTER COLUMN max_lat DROP NOT NULL,
  ALTER COLUMN min_lng DROP NOT NULL,
  ALTER COLUMN max_lng DROP NOT NULL;

-- Update existing zones to calculate min/max from polygon_points
UPDATE delivery_zones
SET 
  min_lat = (
    SELECT MIN((point->>'lat')::double precision)
    FROM jsonb_array_elements(polygon_points) AS point
  ),
  max_lat = (
    SELECT MAX((point->>'lat')::double precision)
    FROM jsonb_array_elements(polygon_points) AS point
  ),
  min_lng = (
    SELECT MIN((point->>'lng')::double precision)
    FROM jsonb_array_elements(polygon_points) AS point
  ),
  max_lng = (
    SELECT MAX((point->>'lng')::double precision)
    FROM jsonb_array_elements(polygon_points) AS point
  )
WHERE polygon_points IS NOT NULL 
  AND jsonb_array_length(polygon_points) > 0;
