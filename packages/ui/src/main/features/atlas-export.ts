import { zipSync, strToU8 } from 'fflate'
import { canonicalProfile } from './atlas-profile'
const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
export function exportResumeDocx() {
  const p = canonicalProfile()
  if (!p.resumeText.trim()) throw new Error('请先保存简历文本')
  const lines = p.resumeText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  const paragraphs = lines
    .map((line, i) => {
      const title = i === 0,
        heading =
          /^#{1,3}\s|^(个人优势|核心能力|工作经历|项目经历|教育经历|专业技能|专业能力)$/.test(line)
      const subheading = i > 2 && line.length < 65 && !/[：:。；@]/.test(line)
      const text = line.replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '')
      return `<w:p><w:pPr><w:pStyle w:val="${title ? 'Title' : heading ? 'Heading1' : 'Normal'}"/>${heading || title || subheading ? '<w:keepNext/>' : ''}</w:pPr><w:r>${subheading ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`
    })
    .join('')
  const files: Record<string, Uint8Array> = {}
  const add = (key: string, value: string) => {
    files[key] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + value)
  }
  add(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
  )
  add(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  )
  add(
    'word/_rels/document.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
  )
  add(
    'word/styles.xml',
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Noto Sans CJK SC"/><w:sz w:val="21"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="290" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="200"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="000000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="25"/></w:rPr></w:style></w:styles>'
  )
  add(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1050" w:right="1050" w:bottom="1050" w:left="1050"/></w:sectPr></w:body></w:document>`
  )
  return {
    filename: `${p.name || '个人'}_简历.docx`,
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    base64: Buffer.from(zipSync(files)).toString('base64')
  }
}
