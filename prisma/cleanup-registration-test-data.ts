import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Starting registration cleanup for test data...')

  const before = await prisma.$transaction([
    prisma.user.count(),
    prisma.supplier.count(),
    prisma.userVenueMembership.count(),
    prisma.venue.count(),
    prisma.business.count(),
  ])

  console.log(
    JSON.stringify(
      {
        before: {
          users: before[0],
          suppliers: before[1],
          venueMemberships: before[2],
          venues: before[3],
          businesses: before[4],
        },
      },
      null,
      2
    )
  )

  // We intentionally truncate only registration-domain roots. CASCADE clears
  // dependent rows created through user/supplier/venue/business relationships.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "CompanyModerationRequest",
      "RegistrationDraft",
      "StaffInvitation",
      "SupplierMembership",
      "User",
      "Supplier",
      "UserVenueMembership",
      "Venue",
      "Business"
    RESTART IDENTITY CASCADE
  `)

  const after = await prisma.$transaction([
    prisma.user.count(),
    prisma.supplier.count(),
    prisma.userVenueMembership.count(),
    prisma.venue.count(),
    prisma.business.count(),
  ])

  console.log(
    JSON.stringify(
      {
        after: {
          users: after[0],
          suppliers: after[1],
          venueMemberships: after[2],
          venues: after[3],
          businesses: after[4],
        },
      },
      null,
      2
    )
  )

  console.log('Registration cleanup completed.')
}

main()
  .catch((error) => {
    console.error('Registration cleanup failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
