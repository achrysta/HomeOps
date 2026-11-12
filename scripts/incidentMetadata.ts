import ts from 'typescript'
import type { IncidentDef } from '../src/types.ts'

/** Читаем те же литеральные данные; не исполняем файл и не меняем его формат. */
export function incidentMetadata(source: string): IncidentDef[] {
  const ast = ts.createSourceFile('incidents.ts', source, ts.ScriptTarget.Latest, true)
  const value = (node: ts.Expression): unknown => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    if (node.kind === ts.SyntaxKind.NullKeyword) return null
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((e) => value(e))
    if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map((p) => {
      if (!ts.isPropertyAssignment(p) || (!ts.isIdentifier(p.name) && !ts.isStringLiteral(p.name))) throw new Error('Метаданные: ожидалось поле литерала')
      return [p.name.text, value(p.initializer)]
    }))
    throw new Error('Метаданные инцидентов: ожидались литералы; формат исходных данных нужно проверить')
  }
  for (const statement of ast.statements) if (ts.isVariableStatement(statement)) {
    const declaration = statement.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === 'incidents')
    if (!declaration?.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) continue
    return declaration.initializer.elements.map((element) => {
      if (!ts.isObjectLiteralExpression(element)) throw new Error('Метаданные: ожидалось описание инцидента')
      const entries = element.properties.map((p) => {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) throw new Error('Метаданные: ожидалось именованное поле')
        if (p.name.text === 'debrief') return ['debrief', { cause: '', fix: '', lesson: '' }]
        if (p.name.text === 'hints') {
          if (!ts.isArrayLiteralExpression(p.initializer)) throw new Error('Метаданные: ожидался массив подсказок')
          return ['hints', p.initializer.elements.map(() => '')]
        }
        return [p.name.text, value(p.initializer)]
      })
      return Object.fromEntries(entries) as unknown as IncidentDef
    })
  }
  throw new Error('Метаданные: массив incidents не найден')
}
