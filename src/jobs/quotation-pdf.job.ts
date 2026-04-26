import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { Quotation, QuotationItem, User, Client } from '@prisma/client';
import { getFile } from '../shared/services/storage.service';

type QuotationWithRelations = Quotation & {
  admin: Pick<User, 'id' | 'name' | 'email' | 'companyName' | 'companyAddress' | 'companyWebsite' | 'companyPhone' | 'companyEmail' | 'companyAbn' | 'logoUrl'>;
  client: Pick<Client, 'name' | 'address' | 'opsContactName' | 'opsContactEmail' | 'opsContactPhone' | 'comContactName' | 'comContactEmail' | 'comContactPhone'> | null;
  items: QuotationItem[];
  parent: Pick<Quotation, 'id' | 'quotationRef' | 'revisionNumber' | 'title'> | null;
};

// ── Colours ──
const NAVY     = '#1C2B41';
const BLUE     = '#0C66E4';
const DARK     = '#1A1A1A';
const MED      = '#4A4A4A';
const LIGHT    = '#888888';
const RULE     = '#CCCCCC';
const BG_ALT   = '#F0F4FF';
const WHITE    = '#FFFFFF';

const FALLBACK_LOGO = path.join(process.cwd(), 'assets', 'logo.png');

// ── Formatting helpers ──

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return (typeof d === 'string' ? new Date(d) : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtCurrency(n: number): string {
  return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return (typeof d === 'string' ? new Date(d) : d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function loadImage(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const m = url.match(/(?:uploads|logos|avatars)\/(.+)$/);
    if (m) return await getFile(m[0]);
    return await getFile(url);
  } catch { /* skip */ }
  return null;
}

export async function generateQuotationPdf(quotation: QuotationWithRelations): Promise<Buffer> {
  const LM = 50;
  const RM = 50;
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 50, bottom: 0, left: LM, right: RM },
    bufferPages: true,
    info: {
      Title: `Quotation — ${quotation.quotationRef}`,
      Author: quotation.admin.companyName || 'Infrava',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const PW = doc.page.width - LM - RM;

  const company = {
    name:    quotation.admin.companyName || 'Infrava',
    address: quotation.admin.companyAddress || '',
    website: quotation.admin.companyWebsite || '',
    phone:   quotation.admin.companyPhone || '',
    email:   quotation.admin.companyEmail || quotation.admin.email,
    abn:     quotation.admin.companyAbn || '',
  };

  // Load logos
  let infravaLogoBuf: Buffer | null = null;
  try {
    if (fs.existsSync(FALLBACK_LOGO)) {
      infravaLogoBuf = fs.readFileSync(FALLBACK_LOGO);
    }
  } catch { /* skip */ }

  let companyLogoBuf: Buffer | null = null;
  if (quotation.admin.logoUrl) {
    companyLogoBuf = await loadImage(quotation.admin.logoUrl);
  }

  // ── Layout helpers ──

  const pageBottom = doc.page.height - 90;

  function ensureSpace(h: number) {
    if (doc.y + h > pageBottom) { doc.addPage(); doc.y = 50; }
  }

  function sectionBar(title: string) {
    ensureSpace(34);
    if (doc.y > 60) doc.y += 6;
    const y = doc.y;
    doc.rect(LM, y, PW, 26).fill(NAVY);
    doc.fontSize(11).font('Helvetica-Bold').fillColor(WHITE).text(title.toUpperCase(), LM + 12, y + 7, { width: PW - 24 });
    doc.y = y + 30;
  }

  function subHead(title: string) {
    ensureSpace(24);
    doc.y += 4;
    const y = doc.y;
    doc.rect(LM, y, 3, 16).fill(BLUE);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(NAVY).text(title, LM + 10, y + 2);
    doc.y = y + 22;
  }

  function kv(label: string, value: string) {
    ensureSpace(18);
    const y = doc.y;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(MED).text(label, LM + 6, y, { width: 130 });
    doc.fontSize(9).font('Helvetica').fillColor(DARK).text(value || '—', LM + 140, y, { width: PW - 146 });
    doc.y = Math.max(doc.y, y + 15);
  }

  function kvTwo(l1: string, v1: string, l2: string, v2: string) {
    ensureSpace(18);
    const y = doc.y;
    const half = PW / 2;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(MED).text(l1, LM + 6, y, { width: 100 });
    doc.fontSize(9).font('Helvetica').fillColor(DARK).text(v1 || '—', LM + 108, y, { width: half - 114 });
    doc.fontSize(9).font('Helvetica-Bold').fillColor(MED).text(l2, LM + half + 6, y, { width: 100 });
    doc.fontSize(9).font('Helvetica').fillColor(DARK).text(v2 || '—', LM + half + 108, y, { width: half - 114 });
    doc.y = y + 16;
  }

  function para(text: string) {
    ensureSpace(16);
    doc.fontSize(9).font('Helvetica').fillColor(DARK).text(text, LM + 6, doc.y, { width: PW - 12, lineGap: 2.5 });
  }

  function tHead(cols: { label: string; w: number; align?: string }[]) {
    ensureSpace(22);
    const y = doc.y;
    doc.rect(LM, y, PW, 20).fill(NAVY);
    let x = LM;
    for (const c of cols) {
      doc.fontSize(8).font('Helvetica-Bold').fillColor(WHITE).text(c.label, x + 6, y + 5, { width: c.w - 12, align: (c.align as any) || 'left' });
      x += c.w;
    }
    doc.y = y + 20;
  }

  function tRow(cols: { val: string; w: number; align?: string; bold?: boolean }[], alt: boolean) {
    ensureSpace(18);
    const y = doc.y;
    if (alt) doc.rect(LM, y, PW, 18).fill(BG_ALT);
    doc.moveTo(LM, y + 18).lineTo(LM + PW, y + 18).lineWidth(0.3).strokeColor(RULE).stroke();
    let x = LM;
    for (const c of cols) {
      doc.fontSize(8).font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(DARK).text(c.val, x + 6, y + 4, { width: c.w - 12, align: (c.align as any) || 'left' });
      x += c.w;
    }
    doc.y = y + 18;
  }

  function divider() {
    ensureSpace(10);
    doc.y += 4;
    doc.moveTo(LM, doc.y).lineTo(LM + PW, doc.y).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.y += 4;
  }

  function totalRow(label: string, value: string, bold = false) {
    ensureSpace(20);
    const y = doc.y;
    const font = bold ? 'Helvetica-Bold' : 'Helvetica';
    const size = bold ? 10 : 9;
    doc.fontSize(size).font(font).fillColor(MED).text(label, LM + 6, y, { width: PW * 0.65 - 6, align: 'right' });
    doc.fontSize(size).font(font).fillColor(DARK).text(value, LM + PW * 0.65, y, { width: PW * 0.35 - 6, align: 'right' });
    doc.y = y + (bold ? 18 : 16);
  }

  // ════════════════════════════════════════════════════════════
  // PAGE HEADER
  // ════════════════════════════════════════════════════════════

  doc.rect(0, 0, doc.page.width, 5).fill(NAVY);

  const headerTop = 20;

  if (infravaLogoBuf) {
    try { doc.image(infravaLogoBuf, LM, headerTop, { height: 36 }); } catch { /* skip */ }
  } else {
    doc.roundedRect(LM, headerTop, 36, 36, 4).fill(NAVY);
    doc.fontSize(18).font('Helvetica-Bold').fillColor(WHITE).text('I', LM + 11, headerTop + 8);
  }

  const rightW = PW * 0.55;
  const rightX = LM + PW - rightW;
  let rightY = headerTop;

  if (companyLogoBuf) {
    try {
      doc.image(companyLogoBuf, LM + PW - 60, headerTop, { height: 36 });
      doc.fontSize(12).font('Helvetica-Bold').fillColor(NAVY).text(company.name, rightX, rightY, { width: rightW - 68, align: 'right' });
      rightY += 16;
    } catch {
      doc.fontSize(12).font('Helvetica-Bold').fillColor(NAVY).text(company.name, rightX, rightY, { width: rightW, align: 'right' });
      rightY += 16;
    }
  } else {
    doc.fontSize(12).font('Helvetica-Bold').fillColor(NAVY).text(company.name, rightX, rightY, { width: rightW, align: 'right' });
    rightY += 16;
  }

  const infoLines: string[] = [];
  if (company.address) infoLines.push(company.address);
  const contactBits: string[] = [];
  if (company.phone) contactBits.push(company.phone);
  if (company.email) contactBits.push(company.email);
  if (contactBits.length) infoLines.push(contactBits.join('  |  '));
  if (company.website) infoLines.push(company.website);
  if (company.abn) infoLines.push(`ABN: ${company.abn}`);
  for (const line of infoLines) {
    doc.fontSize(7).font('Helvetica').fillColor(MED).text(line, rightX, rightY, { width: rightW, align: 'right' });
    rightY += 9;
  }

  // Title bar
  const titleBarY = Math.max(headerTop + 44, rightY + 6);
  const titleLabel = quotation.revisionNumber > 0
    ? `QUOTATION  —  Rev. ${quotation.revisionNumber}`
    : 'QUOTATION';
  doc.rect(LM, titleBarY, PW, 28).fill(NAVY);
  doc.fontSize(13).font('Helvetica-Bold').fillColor(WHITE).text(titleLabel, LM + 14, titleBarY + 7, { width: PW * 0.6 });
  doc.fontSize(9).font('Helvetica').fillColor('#A0B4CF').text(
    `${quotation.quotationRef}  |  ${fmtDate(quotation.createdAt)}`,
    LM + 14, titleBarY + 8, { width: PW - 28, align: 'right' }
  );

  doc.y = titleBarY + 36;

  // ════════════════════════════════════════════════════════════
  // QUOTATION DETAILS
  // ════════════════════════════════════════════════════════════

  sectionBar('Quotation Details');
  kvTwo('Reference', quotation.quotationRef, 'Date', fmtDate(quotation.createdAt));
  kvTwo('Status', quotation.status, 'Revision', quotation.revisionNumber > 0 ? String(quotation.revisionNumber) : 'Original');
  kv('Title', quotation.title);
  if (quotation.parent) {
    kv('Revision Of', `${quotation.parent.quotationRef} — ${quotation.parent.title}`);
  }

  // ════════════════════════════════════════════════════════════
  // CLIENT INFORMATION
  // ════════════════════════════════════════════════════════════

  if (quotation.client) {
    sectionBar('Client Information');
    kv('Client', quotation.client.name);
    if (quotation.client.address) kv('Address', quotation.client.address);

    if (quotation.client.opsContactName || quotation.client.opsContactEmail || quotation.client.opsContactPhone) {
      subHead('Operations Contact');
      if (quotation.client.opsContactName) kv('Name', quotation.client.opsContactName);
      if (quotation.client.opsContactEmail) kv('Email', quotation.client.opsContactEmail);
      if (quotation.client.opsContactPhone) kv('Phone', quotation.client.opsContactPhone);
    }

    if (quotation.client.comContactName || quotation.client.comContactEmail || quotation.client.comContactPhone) {
      subHead('Commercial Contact');
      if (quotation.client.comContactName) kv('Name', quotation.client.comContactName);
      if (quotation.client.comContactEmail) kv('Email', quotation.client.comContactEmail);
      if (quotation.client.comContactPhone) kv('Phone', quotation.client.comContactPhone);
    }
  }

  // ════════════════════════════════════════════════════════════
  // WORK DESCRIPTION
  // ════════════════════════════════════════════════════════════

  if (quotation.workDescription) {
    sectionBar('Work Description');
    para(quotation.workDescription);
  }

  // ════════════════════════════════════════════════════════════
  // METHODOLOGY SECTIONS
  // ════════════════════════════════════════════════════════════

  const methodology = quotation.methodology as { title: string; content: string; sortOrder: number }[] | null;
  if (methodology && Array.isArray(methodology) && methodology.length > 0) {
    const sorted = [...methodology].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (const section of sorted) {
      sectionBar(section.title);
      para(section.content);
    }
  }

  // ════════════════════════════════════════════════════════════
  // ESTIMATE TABLES BY CATEGORY
  // ════════════════════════════════════════════════════════════

  const enabledCategories = quotation.enabledCategories as string[];
  const colDefs = [
    { label: '#',           w: PW * 0.06, align: 'left' },
    { label: 'Description', w: PW * 0.30, align: 'left' },
    { label: 'Qty',         w: PW * 0.10, align: 'right' },
    { label: 'Unit',        w: PW * 0.10, align: 'left' },
    { label: 'Rate',        w: PW * 0.14, align: 'right' },
    { label: 'Uplift',      w: PW * 0.12, align: 'right' },
    { label: 'Amount',      w: PW * 0.18, align: 'right' },
  ];

  for (const cat of enabledCategories) {
    const catItems = quotation.items.filter(i => i.category === cat);
    if (catItems.length === 0) continue;

    sectionBar(`${cat} Estimate`);
    tHead(colDefs);

    let catSubtotal = 0;
    catItems.forEach((item, idx) => {
      catSubtotal += item.amount;
      tRow([
        { val: String(idx + 1),           w: colDefs[0].w },
        { val: item.description,           w: colDefs[1].w },
        { val: String(item.quantity),      w: colDefs[2].w, align: 'right' },
        { val: item.unit,                  w: colDefs[3].w },
        { val: fmtCurrency(item.rate),     w: colDefs[4].w, align: 'right' },
        { val: item.uplift > 0 ? `${item.uplift}%` : '—', w: colDefs[5].w, align: 'right' },
        { val: fmtCurrency(item.amount),   w: colDefs[6].w, align: 'right' },
      ], idx % 2 === 1);
    });

    // Sub-total row
    ensureSpace(22);
    const stY = doc.y;
    doc.rect(LM, stY, PW, 20).fill('#E8ECF4');
    const stLabelW = colDefs[0].w + colDefs[1].w + colDefs[2].w + colDefs[3].w + colDefs[4].w + colDefs[5].w;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY).text('Sub-Total', LM + 6, stY + 5, { width: stLabelW - 12, align: 'right' });
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY).text(fmtCurrency(catSubtotal), LM + stLabelW + 6, stY + 5, { width: colDefs[6].w - 12, align: 'right' });
    doc.y = stY + 22;
  }

  // ════════════════════════════════════════════════════════════
  // GRAND TOTALS
  // ════════════════════════════════════════════════════════════

  const totalExclVat = quotation.items.reduce((sum, i) => sum + i.amount, 0);
  const vatPercent = quotation.vatPercent;
  const vatAmount = vatPercent ? Math.round(totalExclVat * vatPercent / 100 * 100) / 100 : 0;
  const totalInclVat = totalExclVat + vatAmount;

  sectionBar('Summary');

  // Per-category subtotals
  for (const cat of enabledCategories) {
    const catItems = quotation.items.filter(i => i.category === cat);
    if (catItems.length === 0) continue;
    const catTotal = catItems.reduce((sum, i) => sum + i.amount, 0);
    totalRow(cat, fmtCurrency(catTotal));
  }

  divider();
  totalRow('Total Excl. VAT', fmtCurrency(totalExclVat));

  if (vatPercent && vatPercent > 0) {
    totalRow(`VAT (${vatPercent}%)`, fmtCurrency(vatAmount));
    divider();
    totalRow('Total Incl. VAT', fmtCurrency(totalInclVat), true);
  } else {
    divider();
    totalRow('Grand Total', fmtCurrency(totalExclVat), true);
  }

  // ════════════════════════════════════════════════════════════
  // PAGE FOOTERS
  // ════════════════════════════════════════════════════════════

  const now = fmtDateTime(new Date());
  const pages = doc.bufferedPageRange().count;

  for (let i = 0; i < pages; i++) {
    doc.switchToPage(i);

    if (i > 0) doc.rect(0, 0, doc.page.width, 5).fill(NAVY);

    const fy = doc.page.height - 58;

    doc.moveTo(LM, fy).lineTo(LM + PW, fy).lineWidth(0.5).strokeColor(NAVY).stroke();

    let footY = fy + 5;
    doc.fontSize(7).font('Helvetica-Bold').fillColor(NAVY).text(company.name, LM, footY, { width: PW * 0.6 });
    footY += 9;
    const footerBits: string[] = [];
    if (company.address) footerBits.push(company.address);
    if (company.phone) footerBits.push(company.phone);
    if (footerBits.length) {
      doc.fontSize(6.5).font('Helvetica').fillColor(LIGHT).text(footerBits.join('  |  '), LM, footY, { width: PW * 0.6 });
      footY += 8;
    }
    const footerBits2: string[] = [];
    if (company.email) footerBits2.push(company.email);
    if (company.website) footerBits2.push(company.website);
    if (company.abn) footerBits2.push(`ABN: ${company.abn}`);
    if (footerBits2.length) {
      doc.fontSize(6.5).font('Helvetica').fillColor(LIGHT).text(footerBits2.join('  |  '), LM, footY, { width: PW * 0.6 });
    }

    doc.fontSize(7).font('Helvetica').fillColor(LIGHT).text(
      `Page ${i + 1} of ${pages}`,
      LM, fy + 5, { width: PW, align: 'right' }
    );
    doc.fontSize(6.5).font('Helvetica').fillColor(LIGHT).text(
      `Generated: ${now}`,
      LM, fy + 14, { width: PW, align: 'right' }
    );
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(NAVY).text(
      'Powered by Infrava',
      LM, fy + 23, { width: PW, align: 'right' }
    );
  }

  doc.end();
  return new Promise<Buffer>((resolve) => { doc.on('end', () => resolve(Buffer.concat(chunks))); });
}
