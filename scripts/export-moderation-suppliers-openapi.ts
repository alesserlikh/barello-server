import fs from 'fs/promises'
import path from 'path'

import {
  moderationSupplierDetailSchema,
  moderationSupplierPriceImportSchema,
  moderationSupplierProductsResponseSchema,
  moderationSupplierSchema,
} from '../src/modules/moderation/moderation-suppliers.contract'

const supplierFields = {
  inn: { type: 'string', pattern: '^\\d{10}(\\d{2})?$' },
  companyName: { type: 'string', minLength: 2, maxLength: 200 },
  ownerFullName: { type: 'string', minLength: 2, maxLength: 200 },
  ownerPhone: { type: 'string', pattern: '^\\+7\\d{10}$' },
  companyPhone: { type: 'string', pattern: '^\\+7\\d{10}$' },
  city: { type: 'string', minLength: 2, maxLength: 100 },
  address: { type: 'string', minLength: 3, maxLength: 300 },
} as const

const writeSupplierPayload = {
  type: 'object',
  additionalProperties: false,
  required: ['inn', 'companyName', 'ownerPhone', 'companyPhone', 'city', 'address'],
  properties: supplierFields,
} as const

const createSupplierPayload = {
  ...writeSupplierPayload,
  required: [...writeSupplierPayload.required, 'accessStatus'],
  properties: {
    ...writeSupplierPayload.properties,
    accessStatus: { type: 'string', enum: ['ACTIVE', 'BLOCKED'] },
  },
} as const

const errorResponse = {
  description: 'Request failed',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: {},
            },
          },
        },
      },
    },
  },
}

const supplierItemResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'supplier'],
  properties: {
    ok: { type: 'boolean', enum: [true] },
    supplier: { $ref: '#/components/schemas/ModerationSupplier' },
  },
}

const supplierDetailResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'supplier'],
  properties: {
    ok: { type: 'boolean', enum: [true] },
    supplier: { $ref: '#/components/schemas/ModerationSupplierDetail' },
  },
}

const jsonBody = (schema: object) => ({
  required: true,
  content: { 'application/json': { schema } },
})

const jsonResponse = (description: string, schema: object) => ({
  description,
  content: { 'application/json': { schema } },
})

const document = {
  openapi: '3.1.0',
  info: {
    title: 'Barello Moderation Suppliers API',
    version: '1.0.0',
  },
  paths: {
    '/moderation/suppliers': {
      get: {
        operationId: 'getModerationSuppliers',
        responses: {
          '200': jsonResponse('Supplier list', {
            type: 'array',
            items: { $ref: '#/components/schemas/ModerationSupplier' },
          }),
          '401': errorResponse,
        },
      },
      post: {
        operationId: 'createModerationSupplier',
        requestBody: jsonBody(createSupplierPayload),
        responses: {
          '201': jsonResponse('Supplier created', supplierItemResponse),
          '400': errorResponse,
          '401': errorResponse,
          '409': errorResponse,
        },
      },
    },
    '/moderation/suppliers/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        operationId: 'getModerationSupplierDetail',
        responses: {
          '200': jsonResponse('Supplier detail', { $ref: '#/components/schemas/ModerationSupplierDetail' }),
          '401': errorResponse,
          '404': errorResponse,
        },
      },
      patch: {
        operationId: 'updateModerationSupplier',
        requestBody: jsonBody(writeSupplierPayload),
        responses: {
          '200': jsonResponse('Supplier updated', supplierDetailResponse),
          '400': errorResponse,
          '401': errorResponse,
          '404': errorResponse,
          '409': errorResponse,
        },
      },
      delete: {
        operationId: 'deleteModerationSupplier',
        responses: {
          '200': jsonResponse('Supplier deleted', {
            type: 'object',
            required: ['ok', 'supplierId', 'archivedUserIds', 'businessDeleted'],
            properties: {
              ok: { type: 'boolean', enum: [true] },
              supplierId: { type: 'string', format: 'uuid' },
              archivedUserIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
              businessDeleted: { type: 'boolean' },
            },
          }),
          '401': errorResponse,
          '404': errorResponse,
          '409': errorResponse,
        },
      },
    },
    '/moderation/suppliers/{id}/access-status': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      patch: {
        operationId: 'updateModerationSupplierAccessStatus',
        requestBody: jsonBody({
          type: 'object',
          additionalProperties: false,
          required: ['accessStatus'],
          properties: { accessStatus: { type: 'string', enum: ['ACTIVE', 'BLOCKED'] } },
        }),
        responses: {
          '200': jsonResponse('Access status updated', supplierDetailResponse),
          '400': errorResponse,
          '401': errorResponse,
          '404': errorResponse,
        },
      },
    },
    '/moderation/suppliers/{id}/products': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        operationId: 'getModerationSupplierProducts',
        responses: {
          '200': jsonResponse('Supplier products', moderationSupplierProductsResponseSchema),
          '401': errorResponse,
          '404': errorResponse,
        },
      },
    },
    '/moderation/suppliers/{id}/price-imports': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        operationId: 'getModerationSupplierPriceImports',
        responses: {
          '200': jsonResponse('Price import history', {
            type: 'object',
            required: ['ok', 'imports'],
            properties: {
              ok: { type: 'boolean', enum: [true] },
              imports: { type: 'array', items: { $ref: '#/components/schemas/ModerationSupplierPriceImport' } },
            },
          }),
          '401': errorResponse,
          '404': errorResponse,
        },
      },
      post: {
        operationId: 'uploadModerationSupplierPrice',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Price imported' },
          '400': errorResponse,
          '401': errorResponse,
          '404': errorResponse,
        },
      },
    },
    '/moderation/suppliers/{id}/price-imports/{importId}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'importId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      get: {
        operationId: 'getModerationSupplierPriceImportOverview',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 100 } },
        ],
        responses: {
          '200': jsonResponse('Price import overview', {
            type: 'object',
            additionalProperties: false,
            required: ['ok', 'import', 'stats', 'rows'],
            properties: {
              ok: { type: 'boolean', enum: [true] },
              import: { $ref: '#/components/schemas/ModerationSupplierPriceImport' },
              stats: {
                type: 'object',
                additionalProperties: false,
                required: ['categories', 'products'],
                properties: {
                  categories: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['total', 'items'],
                    properties: {
                      total: { type: 'integer', minimum: 0 },
                      items: {
                        type: 'array',
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          required: ['name', 'productsCount'],
                          properties: {
                            name: { type: 'string' },
                            productsCount: { type: 'integer', minimum: 0 },
                          },
                        },
                      },
                    },
                  },
                  products: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['total', 'matched', 'unmatched', 'failed'],
                    properties: {
                      total: { type: 'integer', minimum: 0 },
                      matched: { type: 'integer', minimum: 0 },
                      unmatched: { type: 'integer', minimum: 0 },
                      failed: { type: 'integer', minimum: 0 },
                    },
                  },
                },
              },
              rows: {
                type: 'object',
                additionalProperties: false,
                required: ['items', 'total', 'page', 'pageSize', 'hasMore'],
                properties: {
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['id', 'rawName', 'rawCategory', 'mappingStatus', 'errorText'],
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        rawName: { type: 'string' },
                        rawCategory: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                        mappingStatus: { type: 'string', enum: ['MATCHED', 'MANUAL_MATCHED', 'UNMATCHED', 'FAILED'] },
                        errorText: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                      },
                    },
                  },
                  total: { type: 'integer', minimum: 0 },
                  page: { type: 'integer', minimum: 1 },
                  pageSize: { type: 'integer', minimum: 1 },
                  hasMore: { type: 'boolean' },
                },
              },
            },
          }),
          '400': errorResponse,
          '401': errorResponse,
          '404': errorResponse,
        },
      },
      put: {
        operationId: 'replaceModerationSupplierPriceImport',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Price import replaced' },
          '400': errorResponse,
          '401': errorResponse,
          '404': errorResponse,
          '409': errorResponse,
        },
      },
      delete: {
        operationId: 'deleteModerationSupplierPriceImport',
        responses: {
          '200': jsonResponse('Price import deleted', {
            type: 'object',
            additionalProperties: false,
            required: ['ok', 'importId', 'supplier'],
            properties: {
              ok: { type: 'boolean', enum: [true] },
              importId: { type: 'string', format: 'uuid' },
              supplier: { $ref: '#/components/schemas/ModerationSupplierDetail' },
            },
          }),
          '401': errorResponse,
          '404': errorResponse,
          '409': errorResponse,
        },
      },
    },
  },
  components: {
    schemas: {
      ModerationSupplier: moderationSupplierSchema,
      ModerationSupplierDetail: moderationSupplierDetailSchema,
      ModerationSupplierPriceImport: moderationSupplierPriceImportSchema,
    },
  },
}

async function main() {
  const targetDir = path.resolve(process.cwd(), 'docs', 'openapi')
  const targetFile = path.join(targetDir, 'moderation-suppliers.openapi.json')
  await fs.mkdir(targetDir, { recursive: true })
  await fs.writeFile(targetFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  console.info(`Wrote ${targetFile}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
