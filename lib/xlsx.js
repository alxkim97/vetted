// Reads the first sheet of an .xlsx / .xlsm into rows of strings, with no
// dependency: an .xlsx is a zip of XML files. Read-only; the workbook is only
// ever opened as bytes, never written back.
import { inflateRawSync } from 'node:zlib'

function unzip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('Not a zip file')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const files = {}
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    files[name] = () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + size)
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8')
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

const unxml = s => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1))
    : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()])
// Text of an <si> or <is>, leaving out phonetic hints.
const textOf = xml => [...xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unxml(m[1])).join('')
const colIndex = letters => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1

export function readSheet(buf) {
  const zip = unzip(buf)
  const shared = zip['xl/sharedStrings.xml'] ? [...zip['xl/sharedStrings.xml']().matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1])) : []
  // The first sheet in workbook order, through the workbook's relationships.
  let path = 'xl/worksheets/sheet1.xml'
  const rid = zip['xl/workbook.xml']?.().match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1]
  const target = rid && zip['xl/_rels/workbook.xml.rels']?.().match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
  if (target) path = target.startsWith('/') ? target.slice(1) : `xl/${target}`
  if (!zip[path]) throw new Error(`No sheet at ${path}`)
  const rows = []
  for (const [, num, body] of zip[path]().replace(/<row\b[^>]*\/>/g, '').matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = []
    for (const [, col, attrs, inner = ''] of body.matchAll(/<c\b[^>]*?\br="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const type = attrs.match(/\bt="([^"]+)"/)?.[1]
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      row[colIndex(col)] = type === 's' ? shared[+v] ?? null : type === 'inlineStr' ? textOf(inner) : v != null ? unxml(v) : null
    }
    rows[+num - 1] = row
  }
  return Array.from(rows, r => r || [])
}
