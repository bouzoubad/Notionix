/**
 * Formula language for database properties, close to Notion's:
 *   prop("Prix") * 1.2
 *   if(prop("Fait"), "✅", "⏳")
 *   dateBetween(prop("Fin"), prop("Début"), "days")
 * Parsed into a tree and evaluated without `eval`. Values are numbers,
 * strings, booleans, dates (JS Date), lists or null.
 */

export type FormulaValue = number | string | boolean | Date | FormulaValue[] | null

export class FormulaError extends Error {}

type Node =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'unary'; op: '-' | 'not'; arg: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] }

interface Token {
  type: 'number' | 'string' | 'ident' | 'op' | 'end'
  value: string
  pos: number
}

const MAX_LENGTH = 5000

function tokenize(src: string): Token[] {
  if (src.length > MAX_LENGTH) throw new FormulaError('Formule trop longue.')
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i += 1
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))
      if (!m) throw new FormulaError(`Nombre invalide à la position ${i + 1}.`)
      tokens.push({ type: 'number', value: m[0], pos: i })
      i += m[0].length
      continue
    }
    if (c === '"' || c === "'" || c === '“' || c === '”') {
      const close = c === '“' ? '”' : c
      let j = i + 1
      let out = ''
      while (j < src.length && src[j] !== close) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const e = src[j + 1]
          out += e === 'n' ? '\n' : e === 't' ? '\t' : e
          j += 2
        } else {
          out += src[j]
          j += 1
        }
      }
      if (j >= src.length) throw new FormulaError('Texte non terminé (guillemet manquant).')
      tokens.push({ type: 'string', value: out, pos: i })
      i = j + 1
      continue
    }
    if (/[A-Za-z_À-ÿ]/.test(c)) {
      const m = /^[A-Za-z_À-ÿ][A-Za-z0-9_À-ÿ]*/.exec(src.slice(i))!
      tokens.push({ type: 'ident', value: m[0], pos: i })
      i += m[0].length
      continue
    }
    const two = src.slice(i, i + 2)
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'op', value: two, pos: i })
      i += 2
      continue
    }
    if ('+-*/%^()<>,!'.includes(c)) {
      tokens.push({ type: 'op', value: c, pos: i })
      i += 1
      continue
    }
    throw new FormulaError(`Caractère inattendu « ${c} » à la position ${i + 1}.`)
  }
  tokens.push({ type: 'end', value: '', pos: src.length })
  return tokens
}

const BINARY: Record<string, { prec: number; right?: boolean }> = {
  or: { prec: 1 },
  '||': { prec: 1 },
  and: { prec: 2 },
  '&&': { prec: 2 },
  '==': { prec: 3 },
  '!=': { prec: 3 },
  '<': { prec: 4 },
  '>': { prec: 4 },
  '<=': { prec: 4 },
  '>=': { prec: 4 },
  '+': { prec: 5 },
  '-': { prec: 5 },
  '*': { prec: 6 },
  '/': { prec: 6 },
  '%': { prec: 6 },
  '^': { prec: 8, right: true }
}

/** Parses a formula; throws FormulaError with a readable message. */
export function parseFormula(src: string): Node {
  const tokens = tokenize(src)
  let p = 0
  const peek = (): Token => tokens[p]
  const next = (): Token => tokens[p++]
  const expect = (value: string): void => {
    const t = next()
    if (t.value !== value)
      throw new FormulaError(`« ${value} » attendu à la position ${t.pos + 1}.`)
  }
  const binaryOf = (t: Token): string | null => {
    const key = t.type === 'ident' ? t.value.toLowerCase() : t.value
    if ((t.type === 'op' || t.type === 'ident') && key in BINARY) return key
    return null
  }

  const primary = (): Node => {
    const t = next()
    if (t.type === 'number') return { kind: 'number', value: Number(t.value) }
    if (t.type === 'string') return { kind: 'string', value: t.value }
    if (t.type === 'op' && t.value === '(') {
      const inner = expression(0)
      expect(')')
      return inner
    }
    if (t.type === 'op' && t.value === '-') return { kind: 'unary', op: '-', arg: expression(7) }
    if (t.type === 'op' && t.value === '!') return { kind: 'unary', op: 'not', arg: expression(7) }
    if (t.type === 'ident') {
      const word = t.value.toLowerCase()
      if (word === 'true' || word === 'false') return { kind: 'boolean', value: word === 'true' }
      if (word === 'not') return { kind: 'unary', op: 'not', arg: expression(7) }
      if (peek().value === '(') {
        next()
        const args: Node[] = []
        if (peek().value !== ')') {
          do args.push(expression(0))
          while (peek().value === ',' && next())
        }
        expect(')')
        return { kind: 'call', name: word, args }
      }
      throw new FormulaError(
        `« ${t.value} » inconnu : utilisez prop("${t.value}") pour une propriété.`
      )
    }
    if (t.type === 'end') throw new FormulaError('Formule incomplète.')
    throw new FormulaError(`« ${t.value} » inattendu à la position ${t.pos + 1}.`)
  }

  const expression = (minPrec: number): Node => {
    let left = primary()
    for (;;) {
      const op = binaryOf(peek())
      if (!op || BINARY[op].prec < minPrec) return left
      next()
      const { prec, right } = BINARY[op]
      const rhs = expression(right ? prec : prec + 1)
      left = { kind: 'binary', op, left, right: rhs }
    }
  }

  const tree = expression(0)
  if (peek().type !== 'end')
    throw new FormulaError(`« ${peek().value} » inattendu à la position ${peek().pos + 1}.`)
  return tree
}

export interface FormulaContext {
  /** Value of the property named `name` for the current row; throws if unknown */
  prop(name: string): FormulaValue
  now(): Date
}

const isDate = (v: FormulaValue): v is Date => v instanceof Date

function toNumber(v: FormulaValue): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === null || v === '') return 0
  if (isDate(v)) return v.getTime()
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.'))
    if (Number.isFinite(n)) return n
  }
  throw new FormulaError(`« ${toText(v)} » n’est pas un nombre.`)
}

export function toText(v: FormulaValue): string {
  if (v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number')
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (isDate(v)) return formatDate(v)
  return v.map(toText).join(', ')
}

const truthy = (v: FormulaValue): boolean =>
  v === null
    ? false
    : Array.isArray(v)
      ? v.length > 0
      : typeof v === 'string'
        ? v !== ''
        : typeof v === 'number'
          ? v !== 0
          : isDate(v)
            ? true
            : v

const isEmptyValue = (v: FormulaValue): boolean =>
  v === null || v === '' || (Array.isArray(v) && v.length === 0)

const pad = (n: number): string => String(n).padStart(2, '0')
function formatDate(d: Date, pattern = 'YYYY-MM-DD'): string {
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0
  const p = pattern === 'YYYY-MM-DD' && hasTime ? 'YYYY-MM-DD HH:mm' : pattern
  return p
    .replace('YYYY', String(d.getFullYear()))
    .replace('MM', pad(d.getMonth() + 1))
    .replace('DD', pad(d.getDate()))
    .replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes()))
}

const UNITS: Record<string, string> = {
  year: 'years',
  years: 'years',
  month: 'months',
  months: 'months',
  week: 'weeks',
  weeks: 'weeks',
  day: 'days',
  days: 'days',
  hour: 'hours',
  hours: 'hours',
  minute: 'minutes',
  minutes: 'minutes',
  an: 'years',
  ans: 'years',
  année: 'years',
  années: 'years',
  mois: 'months',
  semaine: 'weeks',
  semaines: 'weeks',
  jour: 'days',
  jours: 'days',
  heure: 'hours',
  heures: 'hours'
}

function unitOf(v: FormulaValue): string {
  const u = UNITS[toText(v).toLowerCase()]
  if (!u)
    throw new FormulaError(
      `Unité inconnue « ${toText(v)} » (days, weeks, months, years, hours, minutes).`
    )
  return u
}

function addToDate(d: Date, n: number, unit: string): Date {
  const r = new Date(d.getTime())
  if (unit === 'years') r.setFullYear(r.getFullYear() + n)
  else if (unit === 'months') r.setMonth(r.getMonth() + n)
  else if (unit === 'weeks') r.setDate(r.getDate() + 7 * n)
  else if (unit === 'days') r.setDate(r.getDate() + n)
  else if (unit === 'hours') r.setHours(r.getHours() + n)
  else r.setMinutes(r.getMinutes() + n)
  return r
}

function between(a: Date, b: Date, unit: string): number {
  const ms = a.getTime() - b.getTime()
  if (unit === 'years' || unit === 'months') {
    const months =
      (a.getFullYear() - b.getFullYear()) * 12 +
      (a.getMonth() - b.getMonth()) -
      (a.getDate() < b.getDate() ? 1 : 0)
    return unit === 'years' ? Math.trunc(months / 12) : months
  }
  const size = { weeks: 6048e5, days: 864e5, hours: 36e5, minutes: 6e4 }[unit as 'days']
  return Math.trunc(ms / size)
}

function needDate(v: FormulaValue, fn: string): Date {
  if (!isDate(v)) throw new FormulaError(`${fn} attend une date.`)
  return v
}

/** Reference card shown in the formula editor. */
export const FORMULA_HELP: { syntax: string; description: string }[] = [
  { syntax: 'prop("Nom")', description: 'valeur d’une propriété' },
  { syntax: '+ - * / % ^', description: 'calcul ; + concatène aussi du texte' },
  { syntax: '== != > < >= <=, and, or, not', description: 'comparaisons et logique' },
  { syntax: 'if(condition, si vrai, si faux)', description: 'condition' },
  { syntax: 'empty(x), length(x)', description: 'vide ? longueur d’un texte ou d’une liste' },
  { syntax: 'concat(a, b, …), join(liste, ", ")', description: 'assembler du texte' },
  {
    syntax: 'contains(texte, "mot"), lower, upper, replace(t, a, b), slice(t, début, fin)',
    description: 'texte'
  },
  {
    syntax: 'round(x, décimales), floor, ceil, abs, sqrt, min(…), max(…), sum(…)',
    description: 'nombres'
  },
  { syntax: 'toNumber(x), format(x)', description: 'conversions' },
  {
    syntax: 'now(), today(), dateAdd(d, n, "days"), dateSubtract(d, n, "months")',
    description: 'dates'
  },
  {
    syntax:
      'dateBetween(fin, début, "days"), formatDate(d, "DD/MM/YYYY"), year(d), month(d), day(d)',
    description: 'dates'
  }
]

/** Evaluates a parsed formula for one row. */
export function evaluate(node: Node, ctx: FormulaContext): FormulaValue {
  const ev = (n: Node): FormulaValue => evaluate(n, ctx)
  switch (node.kind) {
    case 'number':
    case 'string':
    case 'boolean':
      return node.value
    case 'unary': {
      const v = ev(node.arg)
      return node.op === '-' ? -toNumber(v) : !truthy(v)
    }
    case 'binary': {
      const { op } = node
      if (op === 'and' || op === '&&') return truthy(ev(node.left)) && truthy(ev(node.right))
      if (op === 'or' || op === '||') return truthy(ev(node.left)) || truthy(ev(node.right))
      const a = ev(node.left)
      const b = ev(node.right)
      switch (op) {
        case '+':
          if (typeof a === 'string' || typeof b === 'string') return toText(a) + toText(b)
          return toNumber(a) + toNumber(b)
        case '-':
          return toNumber(a) - toNumber(b)
        case '*':
          return toNumber(a) * toNumber(b)
        case '/': {
          const d = toNumber(b)
          if (d === 0) throw new FormulaError('Division par zéro.')
          return toNumber(a) / d
        }
        case '%':
          return toNumber(a) % toNumber(b)
        case '^':
          return Math.pow(toNumber(a), toNumber(b))
        case '==':
        case '!=': {
          const eq =
            isDate(a) && isDate(b)
              ? a.getTime() === b.getTime()
              : typeof a === 'number' || typeof b === 'number'
                ? a !== null && b !== null && toNumber(a) === toNumber(b)
                : toText(a) === toText(b)
          return op === '==' ? eq : !eq
        }
        default: {
          const both = typeof a === 'string' && typeof b === 'string'
          const x = both ? a.localeCompare(b) : toNumber(a) - toNumber(b)
          return op === '<' ? x < 0 : op === '>' ? x > 0 : op === '<=' ? x <= 0 : x >= 0
        }
      }
    }
    case 'call':
      return call(node.name, node.args, ev, ctx)
  }
}

function call(
  name: string,
  args: Node[],
  ev: (n: Node) => FormulaValue,
  ctx: FormulaContext
): FormulaValue {
  const arity = (min: number, max = min): void => {
    if (args.length < min || args.length > max) {
      throw new FormulaError(
        `${name}() attend ${min === max ? min : `${min} à ${max}`} argument(s).`
      )
    }
  }
  const values = (): FormulaValue[] => args.map(ev).flatMap((v) => (Array.isArray(v) ? v : [v]))
  switch (name) {
    case 'prop': {
      arity(1)
      const key = ev(args[0])
      if (typeof key !== 'string')
        throw new FormulaError('prop() attend un nom de propriété entre guillemets.')
      return ctx.prop(key)
    }
    case 'if':
      arity(3)
      return truthy(ev(args[0])) ? ev(args[1]) : ev(args[2])
    case 'empty':
      arity(1)
      return isEmptyValue(ev(args[0]))
    case 'length': {
      arity(1)
      const v = ev(args[0])
      return Array.isArray(v) ? v.length : toText(v).length
    }
    case 'concat':
      return values().map(toText).join('')
    case 'join': {
      arity(1, 2)
      const v = ev(args[0])
      const sep = args[1] ? toText(ev(args[1])) : ', '
      return (Array.isArray(v) ? v : [v]).map(toText).join(sep)
    }
    case 'contains': {
      arity(2)
      const hay = ev(args[0])
      const needle = toText(ev(args[1]))
      return Array.isArray(hay)
        ? hay.some((x) => toText(x) === needle)
        : toText(hay).includes(needle)
    }
    case 'lower':
      arity(1)
      return toText(ev(args[0])).toLowerCase()
    case 'upper':
      arity(1)
      return toText(ev(args[0])).toUpperCase()
    case 'replace':
      arity(3)
      return toText(ev(args[0]))
        .split(toText(ev(args[1])))
        .join(toText(ev(args[2])))
    case 'slice': {
      arity(2, 3)
      const t = toText(ev(args[0]))
      return t.slice(toNumber(ev(args[1])), args[2] ? toNumber(ev(args[2])) : undefined)
    }
    case 'round': {
      arity(1, 2)
      const f = Math.pow(10, args[1] ? toNumber(ev(args[1])) : 0)
      return Math.round(toNumber(ev(args[0])) * f) / f
    }
    case 'floor':
    case 'ceil':
    case 'abs':
    case 'sqrt':
      arity(1)
      return Math[name](toNumber(ev(args[0])))
    case 'pow':
      arity(2)
      return Math.pow(toNumber(ev(args[0])), toNumber(ev(args[1])))
    case 'min':
    case 'max':
    case 'sum': {
      const nums = values()
        .filter((v) => v !== null && v !== '')
        .map(toNumber)
      if (name === 'sum') return nums.reduce((s, n) => s + n, 0)
      return nums.length ? Math[name](...nums) : null
    }
    case 'tonumber':
      arity(1)
      return toNumber(ev(args[0]))
    case 'format':
      arity(1)
      return toText(ev(args[0]))
    case 'now':
      arity(0)
      return ctx.now()
    case 'today': {
      arity(0)
      const n = ctx.now()
      return new Date(n.getFullYear(), n.getMonth(), n.getDate())
    }
    case 'dateadd':
    case 'datesubtract': {
      arity(3)
      const d = needDate(ev(args[0]), name)
      const n = toNumber(ev(args[1]))
      return addToDate(d, name === 'dateadd' ? n : -n, unitOf(ev(args[2])))
    }
    case 'datebetween':
      arity(3)
      return between(needDate(ev(args[0]), name), needDate(ev(args[1]), name), unitOf(ev(args[2])))
    case 'formatdate':
      arity(1, 2)
      return formatDate(needDate(ev(args[0]), name), args[1] ? toText(ev(args[1])) : 'YYYY-MM-DD')
    case 'year':
      arity(1)
      return needDate(ev(args[0]), name).getFullYear()
    case 'month':
      arity(1)
      return needDate(ev(args[0]), name).getMonth() + 1
    case 'day':
      arity(1)
      return needDate(ev(args[0]), name).getDate()
    default:
      throw new FormulaError(`Fonction inconnue : ${name}().`)
  }
}
