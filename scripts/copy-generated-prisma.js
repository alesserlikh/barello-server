const fs = require('fs')
const path = require('path')

const sourceDir = path.resolve(__dirname, '..', 'src', 'generated', 'prisma')
const targetDir = path.resolve(__dirname, '..', 'dist', 'src', 'generated', 'prisma')

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Generated Prisma client not found: ${sourceDir}`)
}

fs.mkdirSync(path.dirname(targetDir), { recursive: true })
fs.cpSync(sourceDir, targetDir, { recursive: true, force: true })

console.log(`Copied Prisma client to ${targetDir}`)
