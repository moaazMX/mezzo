-- Merge duplicate customers that share the same phone, then enforce uniqueness.

WITH ranked AS (
  SELECT
    c.id,
    c.phone,
    ROW_NUMBER() OVER (
      PARTITION BY c.phone
      ORDER BY
        (SELECT COUNT(*)::bigint FROM orders o WHERE o.customer_id = c.id) DESC,
        COALESCE(c.updated_at, c.created_at) DESC,
        c.created_at ASC
    ) AS rn
  FROM customers c
),
mapping AS (
  SELECT
    d.id AS dupe_id,
    k.id AS keep_id
  FROM ranked d
  JOIN ranked k ON k.phone = d.phone AND k.rn = 1
  WHERE d.rn > 1
)
UPDATE orders o
SET customer_id = m.keep_id
FROM mapping m
WHERE o.customer_id = m.dupe_id;

WITH ranked AS (
  SELECT
    c.id,
    c.phone,
    ROW_NUMBER() OVER (
      PARTITION BY c.phone
      ORDER BY
        (SELECT COUNT(*)::bigint FROM orders o WHERE o.customer_id = c.id) DESC,
        COALESCE(c.updated_at, c.created_at) DESC,
        c.created_at ASC
    ) AS rn
  FROM customers c
),
mapping AS (
  SELECT
    d.id AS dupe_id,
    k.id AS keep_id
  FROM ranked d
  JOIN ranked k ON k.phone = d.phone AND k.rn = 1
  WHERE d.rn > 1
)
UPDATE customer_notes cn
SET customer_id = m.keep_id
FROM mapping m
WHERE cn.customer_id = m.dupe_id;

WITH ranked AS (
  SELECT
    c.id,
    c.phone,
    ROW_NUMBER() OVER (
      PARTITION BY c.phone
      ORDER BY
        (SELECT COUNT(*)::bigint FROM orders o WHERE o.customer_id = c.id) DESC,
        COALESCE(c.updated_at, c.created_at) DESC,
        c.created_at ASC
    ) AS rn
  FROM customers c
),
mapping AS (
  SELECT
    d.id AS dupe_id,
    k.id AS keep_id
  FROM ranked d
  JOIN ranked k ON k.phone = d.phone AND k.rn = 1
  WHERE d.rn > 1
)
UPDATE customer_saved_addresses csa
SET customer_id = m.keep_id
FROM mapping m
WHERE csa.customer_id = m.dupe_id;

WITH ranked AS (
  SELECT
    c.id,
    c.phone,
    ROW_NUMBER() OVER (
      PARTITION BY c.phone
      ORDER BY
        (SELECT COUNT(*)::bigint FROM orders o WHERE o.customer_id = c.id) DESC,
        COALESCE(c.updated_at, c.created_at) DESC,
        c.created_at ASC
    ) AS rn
  FROM customers c
),
mapping AS (
  SELECT
    d.id AS dupe_id,
    k.id AS keep_id
  FROM ranked d
  JOIN ranked k ON k.phone = d.phone AND k.rn = 1
  WHERE d.rn > 1
)
UPDATE device_coupons dc
SET customer_id = m.keep_id
FROM mapping m
WHERE dc.customer_id = m.dupe_id;

DO $$
BEGIN
  IF to_regclass('public.archive_orders') IS NOT NULL THEN
    EXECUTE $sql$
      WITH ranked AS (
        SELECT
          c.id,
          c.phone,
          ROW_NUMBER() OVER (
            PARTITION BY c.phone
            ORDER BY
              (SELECT COUNT(*)::bigint FROM orders o WHERE o.customer_id = c.id) DESC,
              COALESCE(c.updated_at, c.created_at) DESC,
              c.created_at ASC
          ) AS rn
        FROM customers c
      ),
      mapping AS (
        SELECT
          d.id AS dupe_id,
          k.id AS keep_id
        FROM ranked d
        JOIN ranked k ON k.phone = d.phone AND k.rn = 1
        WHERE d.rn > 1
      )
      UPDATE archive_orders ao
      SET customer_id = m.keep_id
      FROM mapping m
      WHERE ao.customer_id = m.dupe_id
    $sql$;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.archive_customer_notes') IS NOT NULL THEN
    EXECUTE $sql$
      WITH ranked AS (
        SELECT
          c.id,
          c.phone,
          ROW_NUMBER() OVER (
            PARTITION BY c.phone
            ORDER BY
              (SELECT COUNT(*)::bigint FROM orders o WHERE o.customer_id = c.id) DESC,
              COALESCE(c.updated_at, c.created_at) DESC,
              c.created_at ASC
          ) AS rn
        FROM customers c
      ),
      mapping AS (
        SELECT
          d.id AS dupe_id,
          k.id AS keep_id
        FROM ranked d
        JOIN ranked k ON k.phone = d.phone AND k.rn = 1
        WHERE d.rn > 1
      )
      UPDATE archive_customer_notes acn
      SET customer_id = m.keep_id
      FROM mapping m
      WHERE acn.customer_id = m.dupe_id
    $sql$;
  END IF;
END
$$;

WITH ranked AS (
  SELECT
    c.id,
    c.phone,
    ROW_NUMBER() OVER (
      PARTITION BY c.phone
      ORDER BY
        (SELECT COUNT(*)::bigint FROM orders o WHERE o.customer_id = c.id) DESC,
        COALESCE(c.updated_at, c.created_at) DESC,
        c.created_at ASC
    ) AS rn
  FROM customers c
)
DELETE FROM customers c
USING ranked r
WHERE c.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique ON customers (phone);
