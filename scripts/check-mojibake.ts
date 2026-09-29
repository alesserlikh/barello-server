import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOTS = ['src', 'prisma', 'scripts']
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'generated', '__snapshots__'])
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.sql',
  '.md',
])

type Finding = {
  file: string
  line: number
  reason: string
  text: string
}

const COMMON_CYRILLIC_MOJIBAKE_MARKERS = [
  'Рђ',
  'Р‘',
  'Р’',
  'Р“',
  'Р”',
  'Р•',
  'Р–',
  'Р—',
  'Р™',
  'Рљ',
  'Р›',
  'Рњ',
  'Рќ',
  'Рћ',
  'Рџ',
  'Р ',
  'РЎ',
  'Рў',
  'РЈ',
  'Р¤',
  'РҐ',
  'Р¦',
  'Р§',
  'РЁ',
  'Р©',
  'РЄ',
  'Р«',
  'Р¬',
  'Р­',
  'Р®',
  'РЇ',
]

function walk(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      if (!IGNORED_DIRS.has(entry)) {
        files.push(...walk(fullPath))
      }
      continue
    }

    if (TEXT_EXTENSIONS.has(path.extname(entry))) {
      files.push(fullPath)
    }
  }

  return files
}

function isAllowedMojibakeDetectorLine(file: string, line: string) {
  return (
    (
      file.endsWith(path.join('src', 'modules', 'price-imports', 'upload-file-name.ts')) &&
      line.includes('/[ÃÂÐÑ]/')
    ) ||
    file === path.join('scripts', 'check-db-mojibake.ts') ||
    (
      file.startsWith(path.join('prisma', 'migrations')) &&
      (
        file.includes('repair_remaining_mojibake_text_data') ||
        file.includes('repair_additional_mojibake_text_data')
      )
    )
  )
}

function latinOrPunctuationMojibakePairCount(line: string) {
  return (line.match(/[РС][\u0080-\u00ff\u2018-\u203a]/g) ?? []).length
}

function findMojibakeReason(file: string, line: string) {
  if (isAllowedMojibakeDetectorLine(file, line)) {
    return null
  }

  if (line.includes('�')) {
    return 'replacement character'
  }

  if (/['"`][^'"`]*\?{3,}[^'"`]*['"`]/.test(line)) {
    return 'question-mark replacement text'
  }

  if (line.includes('вЂ')) {
    return 'utf8 punctuation mojibake'
  }

  if (line.includes('РІР‚В¦')) {
    return 'mojibake ellipsis'
  }

  if (COMMON_CYRILLIC_MOJIBAKE_MARKERS.some((marker) => line.includes(marker))) {
    return 'common cyrillic mojibake marker'
  }

  if (/[ÐÑ][\u0080-\u00ff\u0400-\u04ff]/.test(line)) {
    return 'latin/cyrillic mojibake marker'
  }

  if (latinOrPunctuationMojibakePairCount(line) >= 1) {
    return 'cp1251/utf8 mojibake pair'
  }

  return null
}

const findings: Finding[] = []

for (const root of ROOTS) {
  for (const file of walk(path.resolve(root))) {
    const relativeFile = path.relative(process.cwd(), file)

    if (relativeFile === path.join('scripts', 'check-mojibake.ts')) {
      continue
    }

    const lines = readFileSync(file, 'utf8').split(/\r?\n/)

    lines.forEach((line, index) => {
      const reason = findMojibakeReason(relativeFile, line)

      if (reason) {
        findings.push({
          file: relativeFile,
          line: index + 1,
          reason,
          text: line.trim(),
        })
      }
    })
  }
}

if (findings.length > 0) {
  console.error('Mojibake-like text found:')
  for (const finding of findings) {
    console.error(
      `${finding.file}:${finding.line} ${finding.reason}: ${finding.text}`
    )
  }
  process.exit(1)
}

console.log('No mojibake-like text found.')
