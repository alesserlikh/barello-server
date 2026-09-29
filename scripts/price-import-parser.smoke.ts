import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { PriceImportSourceFormat } from '../src/generated/prisma'
import { parseRowsFromFile } from '../src/modules/price-imports/price-import-parser.service'

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'price-import-parser-'))
  const filePath = path.join(tempDir, 'sample.csv')

  fs.writeFileSync(
    filePath,
    ['name,category,sku,barcode,price,stock,deliveryDays,volume', 'Вино Красное,Алкоголь,SKU-1,12345,1200,10,3,750'].join('\n'),
    'utf8',
  )

  const rows = await parseRowsFromFile(filePath, PriceImportSourceFormat.CSV)

  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].rawName, 'Вино Красное')
  assert.strictEqual(rows[0].supplierSku, 'SKU-1')
  assert.strictEqual(rows[0].barcode, '12345')
  assert.strictEqual(rows[0].price, 1200)
  assert.strictEqual(rows[0].stock, 10)
  assert.strictEqual(rows[0].deliveryDaysMin, 3)
  assert.strictEqual(rows[0].volumeMl, 750)

  console.log('price import parser smoke passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
