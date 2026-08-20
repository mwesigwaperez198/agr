type ExportCell = string | number | boolean | null | undefined;
type ExportRow = ExportCell[];

function escapeXml(value: ExportCell) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function exportRows(module: string, data: any): ExportRow[] {
  if (data.columns?.length && data.records?.length) {
    return [data.columns.map((column: any) => column.label), ...data.records.map((record: any) => data.columns.map((column: any) => record[column.key] ?? ''))];
  }
  const rows: ExportRow[] = [['Report', module.replaceAll('-', ' ')], ['Generated at', new Date().toISOString()], [], ['Metric', 'Value']];
  for (const item of data.summary || []) rows.push([item.label, item.value]);
  for (const breakdown of data.breakdowns || []) {
    rows.push([], [breakdown.title, '']);
    for (const item of breakdown.items || []) rows.push([item.label, item.value]);
  }
  return rows;
}

function csv(rows: ExportRow[]) {
  const safe = (value: ExportCell) => { const raw = String(value ?? ''); const formulaSafe = typeof value === 'string' && /^[=+\-@]/.test(raw) ? `'${raw}` : raw; return `"${formulaSafe.replaceAll('"', '""')}"`; };
  return Buffer.from(`\uFEFF${rows.map(row => row.map(safe).join(',')).join('\r\n')}`, 'utf8');
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(value: number) { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value); return buffer; }
function u32(value: number) { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value >>> 0); return buffer; }
function zipStore(files: Array<{ name: string; data: Buffer }>) {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name); const crc = crc32(file.data);
    const header = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(file.data.length), u32(file.data.length), u16(name.length), u16(0), name]);
    local.push(header, file.data);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(file.data.length), u32(file.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += header.length + file.data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(directory.length), u32(offset), u16(0)]);
  return Buffer.concat([...local, directory, end]);
}

function columnName(index: number) {
  let value = index + 1; let result = '';
  while (value) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}
function xlsx(rows: ExportRow[]) {
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => {
    const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
    return typeof cell === 'number' && Number.isFinite(cell)
      ? `<c r="${reference}"><v>${cell}</v></c>`
      : `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const files = [
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data export" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`) },
  ];
  return zipStore(files);
}

function escapePdf(value: ExportCell) { return String(value ?? '').replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)').replaceAll(/[^\x20-\x7E]/g, '?'); }
function pdf(rows: ExportRow[], title: string) {
  const allLines = [title, `Generated ${new Date().toISOString()}`, '', ...rows.map(row => row.map(cell => String(cell ?? '')).join('  |  '))];
  const pages: string[][] = []; for (let index = 0; index < allLines.length; index += 46) pages.push(allLines.slice(index, index + 46));
  const pageReferences = pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageReferences}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const lines of pages) {
    const pageObjectId = objects.length + 1; const streamObjectId = pageObjectId + 1;
    const stream = `BT\n/F1 10 Tf\n40 805 Td\n${lines.map((line, index) => `${index ? '0 -16 Td\n' : ''}(${escapePdf(line).slice(0, 105)}) Tj`).join('\n')}\nET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamObjectId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let body = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, 'binary');
}

export function buildAdminExport(module: string, format: 'csv' | 'xlsx' | 'pdf', data: any) {
  const rows = exportRows(module, data);
  if (format === 'xlsx') return { body: xlsx(rows), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
  if (format === 'pdf') return { body: pdf(rows, data.reportTitle || `${module.replaceAll('-', ' ')} administrator report`), contentType: 'application/pdf', extension: 'pdf' };
  return { body: csv(rows), contentType: 'text/csv; charset=utf-8', extension: 'csv' };
}
