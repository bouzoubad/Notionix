/** RFC 4180 CSV: quoted fields may contain commas, quotes ("") and line breaks. A BOM is ignored. */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i]
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += c
      }
    } else if (c === '"' && field === '') {
      quoted = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  // Only truly blank lines are dropped: "," is a row whose cells are all empty (e.g. an untitled page).
  return rows.filter((r) => r.length > 1 || r[0] !== '')
}

const needsQuotes = /[",\r\n]|^\s|\s$/

export function stringifyCsv(rows: string[][]): string {
  const cell = (v: string): string => (needsQuotes.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  // A BOM lets spreadsheet software read the file as UTF-8, as in Notion's exports.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
