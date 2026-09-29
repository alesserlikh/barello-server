UPDATE "Business"
SET "legalAddress" = 'Москва, ул. Примерная, 1'
WHERE "id" = '0396105b-338a-40c8-9ace-e2b9bf40e3ea'
  AND "legalAddress" = 'РњРѕСЃРєРІР°, СѓР». РџСЂРёРјРµСЂРЅР°СЏ, 1';

UPDATE "CatalogCategory"
SET "name" = 'Алкоголь'
WHERE "id" = '67398f2c-800f-48f9-a3e6-6e01e7127b7e'
  AND "name" = 'РђР»РєРѕРіРѕР»СЊ';

DELETE FROM "VenueCuisineType" bad
WHERE bad."cuisineTypeId" = 'a9c214bd-f28e-4aae-aa73-52e4fae68cf9'
  AND EXISTS (
    SELECT 1
    FROM "VenueCuisineType" good
    WHERE good."venueId" = bad."venueId"
      AND good."cuisineTypeId" = 'dfcf06ff-67e6-4f7b-b8c6-a9ca1d4ce7bf'
  );

UPDATE "VenueCuisineType"
SET "cuisineTypeId" = 'dfcf06ff-67e6-4f7b-b8c6-a9ca1d4ce7bf'
WHERE "cuisineTypeId" = 'a9c214bd-f28e-4aae-aa73-52e4fae68cf9';

DELETE FROM "CuisineType"
WHERE "id" = 'a9c214bd-f28e-4aae-aa73-52e4fae68cf9'
  AND "name" = 'Р‘Р°СЂ';

DELETE FROM "VenueCuisineType" bad
WHERE bad."cuisineTypeId" = 'e159324d-2b5a-4aaa-b8f3-d83e4a55c207'
  AND EXISTS (
    SELECT 1
    FROM "VenueCuisineType" good
    WHERE good."venueId" = bad."venueId"
      AND good."cuisineTypeId" = '3a70dd6f-8252-477a-926d-127c5de50a7b'
  );

UPDATE "VenueCuisineType"
SET "cuisineTypeId" = '3a70dd6f-8252-477a-926d-127c5de50a7b'
WHERE "cuisineTypeId" = 'e159324d-2b5a-4aaa-b8f3-d83e4a55c207';

DELETE FROM "CuisineType"
WHERE "id" = 'e159324d-2b5a-4aaa-b8f3-d83e4a55c207'
  AND "name" = 'Р’РёРЅРЅС‹Р№ Р±Р°СЂ';

DELETE FROM "VenueCuisineType" bad
WHERE bad."cuisineTypeId" = '12f6c61c-b698-4b6a-896b-116269ad823a'
  AND EXISTS (
    SELECT 1
    FROM "VenueCuisineType" good
    WHERE good."venueId" = bad."venueId"
      AND good."cuisineTypeId" = 'b9c422be-8560-427a-9b64-d36c0ecae3fa'
  );

UPDATE "VenueCuisineType"
SET "cuisineTypeId" = 'b9c422be-8560-427a-9b64-d36c0ecae3fa'
WHERE "cuisineTypeId" = '12f6c61c-b698-4b6a-896b-116269ad823a';

DELETE FROM "CuisineType"
WHERE "id" = '12f6c61c-b698-4b6a-896b-116269ad823a'
  AND "name" = 'Р РµСЃС‚РѕСЂР°РЅ';

DELETE FROM "VenueCuisineType" bad
WHERE bad."cuisineTypeId" = 'f674c1a4-6e7c-4833-ba03-9c8317a11b42'
  AND EXISTS (
    SELECT 1
    FROM "VenueCuisineType" good
    WHERE good."venueId" = bad."venueId"
      AND good."cuisineTypeId" = 'ba73ef8c-a190-4abc-9b00-8ebec20b5861'
  );

UPDATE "VenueCuisineType"
SET "cuisineTypeId" = 'ba73ef8c-a190-4abc-9b00-8ebec20b5861'
WHERE "cuisineTypeId" = 'f674c1a4-6e7c-4833-ba03-9c8317a11b42';

DELETE FROM "CuisineType"
WHERE "id" = 'f674c1a4-6e7c-4833-ba03-9c8317a11b42'
  AND "name" = 'Р“Р°СЃС‚СЂРѕР±Р°СЂ';

UPDATE "FileAsset"
SET "fileName" = 'Тренинг_Смета_полная.xlsx'
WHERE "id" = '9cdd8764-dd1b-47e6-ad4e-6d928fde199e'
  AND "fileName" = 'Ð¢ÑÐµÐ½Ð¸Ð½Ð³_Ð¡Ð¼ÐµÑÐ°_Ð¿Ð¾Ð»Ð½Ð°Ñ.xlsx';

UPDATE "FileAsset"
SET "fileName" = 'Beluga Прайс-лист от 15.04.2025 PRESS.xlsx'
WHERE "id" = '5f09faea-b7f4-4020-b9bf-1fbc9310d868'
  AND "fileName" = 'Beluga ÐÑÐ°Ð¹Ñ-Ð»Ð¸ÑÑ Ð¾Ñ 15.04.2025 PRESS.xlsx';

UPDATE "Venue"
SET "address" = 'ул. Примерная, 10'
WHERE "id" = '11111111-1111-1111-1111-111111111111'
  AND "address" = 'СѓР». РџСЂРёРјРµСЂРЅР°СЏ, 10';

UPDATE "Venue"
SET "contactPersonName" = 'Александра'
WHERE "id" = '11111111-1111-1111-1111-111111111111'
  AND "contactPersonName" = 'РђР»РµРєСЃР°РЅРґСЂР°';
