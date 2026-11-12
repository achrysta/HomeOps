// Локальные ссылки документации. Не читает пользовательскую data/, не ходит в сеть.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md', 'src/*'], { encoding: 'utf8' }).trim().split('\n'))]
  .filter((f) => f && !f.startsWith('data/') && !f.startsWith('incidents/_shared/gpu/models/') && existsSync(f))
const errors: string[] = []
let links = 0
const slug = (heading: string) => heading.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}_\-\s]/gu, '').trim().replace(/\s/g, '-')
const anchors = new Map<string, Set<string>>()

function documentAnchors(file: string): Set<string> {
  let result = anchors.get(file)
  if (result) return result
  result = new Set<string>()
  const text = readFileSync(file, 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '')
  const counts = new Map<string, number>()
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slug(m[1]), count = counts.get(base) ?? 0
    result.add(count ? `${base}-${count}` : base)
    counts.set(base, count + 1)
  }
  for (const m of text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) result.add(m[1])
  anchors.set(file, result)
  return result
}

function check(file: string, target: string): void {
  target = target.replace(/^<|>$/g, '')
  if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return
  links++
  const [raw, fragment] = target.split('#', 2)
  let decoded: string, anchor: string
  try { decoded = decodeURIComponent(raw.split('?')[0]); anchor = decodeURIComponent(fragment ?? '') }
  catch { errors.push(`${file}: некорректный URL ${target}`); return }
  const resolved = raw ? path.resolve(path.dirname(path.resolve(root, file)), decoded) : path.resolve(root, file)
  const relative = path.relative(root, resolved)
  // Ссылки за пределы репозитория и в data не открываем даже при проверке.
  if (relative.startsWith('..') || relative === 'data' || relative.startsWith(`data${path.sep}`)) {
    errors.push(`${file}: ссылка вне доступной документации ${target}`); return
  }
  if (!existsSync(resolved)) { errors.push(`${file}: отсутствует ${target}`); return }
  if (anchor && /\.(?:md|html)$/.test(resolved) && statSync(resolved).isFile() && !documentAnchors(resolved).has(anchor))
    errors.push(`${file}: отсутствует якорь ${target}`)
}

function markdownLinks(file: string, text: string): void {
  for (const m of text.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)/g)) check(file, m[1])
}

for (const file of files) {
  if (file.endsWith('.md')) {
    const text = readFileSync(file, 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '')
    markdownLinks(file, text)
    for (const m of text.matchAll(/^\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm)) check(file, m[1])
    for (const m of text.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) check(file, m[1])
  } else if (/^src\/.*\.(?:ts|tsx)$/.test(file)) {
    // Учебные команды/артефакты ai-platform-labs не являются ссылками HomeOps.
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    function visit(node: ts.Node): void {
      if (ts.isStringLiteralLike(node)) {
        markdownLinks(file, node.text)
        const parent = node.parent
        const field = ts.isPropertyAssignment(parent) || ts.isJsxAttribute(parent) ? parent.name.getText(source).replace(/["']/g, '') : ''
        if (['url', 'href', 'src', 'ru'].includes(field) && /\.(?:md|html)(?:#.*)?$/.test(node.text) && !node.text.startsWith('#')) check(file, node.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
else console.log(`Ссылки: ${links} локальных целей, ${files.filter((f) => f.endsWith('.md')).length} Markdown-файлов; ошибок нет.`)
