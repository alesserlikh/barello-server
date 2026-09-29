import { executeDueAccountDeletionRequests } from '../src/modules/account-deletion/account-deletion.service'
import { prisma } from '../src/lib/prisma'

async function main() {
  const result = await executeDueAccountDeletionRequests()
  console.log(
    `[account-deletion-cleanup] processed ${result.processed} due request(s)`
  )
}

main()
  .catch((error) => {
    console.error('[account-deletion-cleanup] failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
