UPDATE "Product"
SET "name" = replace("name", 'N?12', '№12')
WHERE "name" LIKE '%N?12%';

UPDATE "Product"
SET "name" = replace("name", 'N' || chr(65533) || '12', '№12')
WHERE "name" LIKE '%' || 'N' || chr(65533) || '12' || '%';
