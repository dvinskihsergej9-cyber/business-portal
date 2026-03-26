-- One-time cleanup for legacy categories before schema sync.
-- Safe for both TEXT and ENUM column types.
UPDATE "Item"
SET "category" = 'STOCK'
WHERE "category"::text = 'TMC';
