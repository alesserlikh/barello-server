import { prisma } from '../../lib/prisma'
import { externalIdWhere } from '../../lib/public-id'

export async function getAllSuppliers() {
  return prisma.supplier.findMany({
    where: {
      isActive: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
      publicId: true,
      name: true,
      catalogName: true,
      business: {
        select: {
          name: true,
          taxNumber: true,
        },
      },
      city: true,
      address: true,
      contactName: true,
      phone: true,
      email: true,
      website: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  }).then((suppliers) =>
    suppliers.map((supplier) => ({
      id: supplier.id,
      publicId: supplier.publicId,
      name: supplier.catalogName?.trim() || supplier.business?.name?.trim() || supplier.name,
      companyName: supplier.catalogName || supplier.business?.name || null,
      inn: supplier.business?.taxNumber || null,
      city: supplier.city,
      address: supplier.address,
      contactName: supplier.contactName,
      phone: supplier.phone,
      email: supplier.email,
      website: supplier.website,
      isActive: supplier.isActive,
      createdAt: supplier.createdAt,
      updatedAt: supplier.updatedAt,
    }))
  )
}

export async function getSupplierById(id: string) {
  return prisma.supplier.findUnique({
    where: externalIdWhere(id, '2'),
    select: {
      id: true,
      publicId: true,
      name: true,
      catalogName: true,
      business: {
        select: {
          name: true,
          taxNumber: true,
        },
      },
      city: true,
      address: true,
      latitude: true,
      longitude: true,
      contactName: true,
      phone: true,
      email: true,
      website: true,
      mainPhotoFileId: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  }).then((supplier) => {
    if (!supplier) {
      return null
    }

    return {
      id: supplier.id,
      publicId: supplier.publicId,
      name: supplier.catalogName?.trim() || supplier.business?.name?.trim() || supplier.name,
      companyName: supplier.catalogName || supplier.business?.name || null,
      inn: supplier.business?.taxNumber || null,
      city: supplier.city,
      address: supplier.address,
      latitude: supplier.latitude,
      longitude: supplier.longitude,
      contactName: supplier.contactName,
      phone: supplier.phone,
      email: supplier.email,
      website: supplier.website,
      mainPhotoFileId: supplier.mainPhotoFileId,
      isActive: supplier.isActive,
      createdAt: supplier.createdAt,
      updatedAt: supplier.updatedAt,
    }
  })
}
