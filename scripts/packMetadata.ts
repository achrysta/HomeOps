import ts from 'typescript'
import { interviewQuestion, resource, task } from '../src/data/builders.ts'
import type { ContentPack } from '../src/data/packs/index.ts'
import type { DesignCase, ExerciseSet } from '../src/types.ts'

const exerciseConstructors = {
  order: (id: string, text: string, steps: string[], explanation: string) => ({ kind: 'order', id, text, steps, explanation }),
  match: (id: string, text: string, pairs: string[][], extra: string[], explanation: string) => ({ kind: 'match', id, text, pairs, extra, explanation }),
  error: (id: string, text: string, lines: string[], errors: number[], fix: string, explanation: string) => ({ kind: 'error', id, text, lines, errors, fix, explanation }),
  arch: (id: string, text: string, zones: string[], blocks: [string, number | null, string][], explanation: string) => ({ kind: 'arch', id, text, zones, blocks: blocks.map(([title, zone, note]) => ({ title, zone, note })), explanation }),
}

/** Data-only AST: не исполняем произвольный код пакетов при сборке. */
export function readCatalogData(source: string, exportName: string): unknown {
  const ast = ts.createSourceFile('pack.ts', source, ts.ScriptTarget.Latest, true)
  const constructors: Record<string, (...args: never[]) => unknown> = {}
  if (exportName === 'exerciseSets') Object.assign(constructors, exerciseConstructors)
  const known = { interviewQuestion, resource, task }
  for (const statement of ast.statements) if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.getText(ast).includes('/builders')) {
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
      const name = (binding.propertyName ?? binding.name).text as keyof typeof known
      if (known[name]) constructors[binding.name.text] = known[name] as (...args: never[]) => unknown
    }
  }
  const value = (node: ts.Expression): unknown => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    if (node.kind === ts.SyntaxKind.NullKeyword) return null
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(value)
    if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map((p) => {
      if (!ts.isPropertyAssignment(p) || (!ts.isIdentifier(p.name) && !ts.isStringLiteral(p.name))) throw new Error('Pack catalog: ожидалось поле литерала')
      return [p.name.text, value(p.initializer)]
    }))
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && constructors[node.expression.text]) return constructors[node.expression.text](...node.arguments.map(value) as never[])
    throw new Error(`Pack catalog: неподдерживаемое выражение ${node.getText(ast).slice(0, 80)}`)
  }
  for (const statement of ast.statements) if (ts.isVariableStatement(statement)) {
    const decl = statement.declarationList.declarations.find((d) => d.name.getText(ast) === exportName)
    if (decl?.initializer) return value(decl.initializer)
  }
  throw new Error(`Pack catalog: export ${exportName} не найден`)
}

export const readPack = (source: string): ContentPack => readCatalogData(source, 'pack') as ContentPack

export function exerciseMetadata(sets: ExerciseSet[]): ExerciseSet[] {
  return sets.map((set) => ({ ...set, exercises: set.exercises.map((e) => ({ ...e, explanation: '',
    ...(e.kind === 'error' ? { fix: '' } : {}),
    ...(e.kind === 'arch' ? { blocks: e.blocks.map((b) => ({ ...b, note: '' })) } : {}),
  })) }))
}

export function designMetadata(cases: DesignCase[]): DesignCase[] {
  return cases.map((c) => ({ ...c, pitfalls: [], outline: Object.fromEntries(Object.keys(c.outline).map((id) => [id, []])) }))
}

/** Условия зачёта и расчётов сохраняются; тексты восстановит ленивый contentStore. */
export function packMetadata(pack: ContentPack): ContentPack {
  const question = <T extends { points: string[]; pitfall: string }>(q: T): T => ({ ...q, points: [], pitfall: '' })
  return {
    ...pack,
    ...(pack.tracks ? { tracks: pack.tracks.map((t) => ({ ...t, goal: '', workProblem: '', entryRequirements: [], topics: [], learned: [], nextSteps: [], ...(t.note === undefined ? {} : { note: '' }) })) } : {}),
    ...(pack.tasks ? { tasks: pack.tasks.map((t) => ({ ...t, description: '' })) } : {}),
    ...(pack.skills ? { skills: pack.skills.map((s) => ({ ...s, description: '' })) } : {}),
    ...(pack.resources ? { resources: pack.resources.map((r) => ({ ...r, note: '' })) } : {}),
    ...(pack.interviewTopics ? { interviewTopics: pack.interviewTopics.map((t) => ({ ...t, questions: t.questions.map(question) })) } : {}),
    ...(pack.interviewExtras ? { interviewExtras: Object.fromEntries(Object.entries(pack.interviewExtras).map(([id, e]) => [id, { ...e, ...(e.questions ? { questions: e.questions.map(question) } : {}) }])) } : {}),
  }
}
