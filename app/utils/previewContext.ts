import { javascriptLanguage } from '@codemirror/lang-javascript'
import type { SyntaxNode } from '@lezer/common'
import originalScript from '../data/snowfro-script.formatted.js?raw'

const names = ['speed', 'loops', 'backgroundIndex', 'backgroundArray'] as const
type ManagedName = typeof names[number]
const arrayReads = new Set(['at', 'concat', 'entries', 'every', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flat', 'flatMap', 'forEach', 'includes', 'indexOf', 'join', 'keys', 'lastIndexOf', 'map', 'reduce', 'reduceRight', 'slice', 'some', 'toLocaleString', 'toString', 'values', 'with', 'toReversed', 'toSorted', 'toSpliced'])

function targetNames(node: SyntaxNode | null, source: string): string[] {
  if (!node) return []
  if (node.name === 'VariableName' || node.name === 'VariableDefinition') return [source.slice(node.from, node.to)]
  if (node.name === 'MemberExpression') return targetNames(node.firstChild, source)
  if (['ArrayPattern', 'ObjectPattern', 'PatternProperty'].includes(node.name)) {
    return Array.from(node.getChildren('VariableDefinition'), child => source.slice(child.from, child.to))
      .concat(Array.from(node.getChildren('PatternProperty'), child => targetNames(child, source)).flat())
  }
  return []
}

function tokens(node: SyntaxNode, source: string): string {
  const parts: string[] = []
  const cursor = node.cursor()
  cursor.iterate(current => {
    if (current.name === 'LineComment' || current.name === 'BlockComment') return false
    if (!current.node.firstChild) parts.push(`${current.name}:${source.slice(current.from, current.to)}`)
  })
  return parts.join('|')
}

function writes(source: string): Record<ManagedName, string[]> {
  const result: Record<ManagedName, string[]> = { speed: [], loops: [], backgroundIndex: [], backgroundArray: [] }
  javascriptLanguage.parser.parse(source).iterate({ enter(ref) {
    const node = ref.node
    let targets: string[] = []
    if (node.name === 'VariableDeclaration') {
      targets = node.getChildren('VariableDefinition').map(child => source.slice(child.from, child.to))
    } else if (node.name === 'AssignmentExpression' || node.name === 'PostfixExpression') {
      targets = targetNames(node.firstChild, source)
    } else if (node.name === 'UnaryExpression' && /^(?:\+\+|--)/.test(source.slice(node.from, node.to))) {
      targets = targetNames(node.lastChild, source)
    } else if (node.name === 'CallExpression' && node.firstChild?.name === 'MemberExpression') {
      const member = node.firstChild
      const property = member.getChild('PropertyName') ?? member.getChild('String')
      const method = property ? source.slice(property.from, property.to).replace(/^['"]|['"]$/g, '') : ''
      // Primitive method calls are reads; known array readers do not assign an
      // input. Mutators and unknown array methods conservatively own the array.
      if (!arrayReads.has(method) && targetNames(member, source).includes('backgroundArray')) targets = ['backgroundArray']
    }
    for (const name of names) if (targets.includes(name)) result[name].push(tokens(node, source))
  } })
  return result
}

const canonicalWrites = writes(originalScript)

/** Extra declarations or writes belong to the custom script, even at default values.
 * Scope and dynamic data flow are intentionally conservative: custom code wins.
 */
export function managedPreviewInputs(source: string) {
  const sourceWrites = writes(source)
  const unchanged = (name: ManagedName) => JSON.stringify(sourceWrites[name]) === JSON.stringify(canonicalWrites[name])
  return { speed: unchanged('speed'), playing: unchanged('loops'), background: unchanged('backgroundIndex') && unchanged('backgroundArray') }
}
