import PDFDocument from 'pdfkit';
import { Quotation, QuotationItem, User, Client } from '@prisma/client';
import { getFile } from '../shared/services/storage.service';

type QuotationWithRelations = Quotation & {
  admin: Pick<User, 'id' | 'name' | 'email' | 'companyName' | 'companyAddress' | 'companyWebsite' | 'companyPhone' | 'companyEmail' | 'companyAbn' | 'logoUrl'>;
  client: Pick<Client, 'name' | 'address' | 'opsContactName' | 'opsContactEmail' | 'opsContactPhone' | 'comContactName' | 'comContactEmail' | 'comContactPhone'> | null;
  items: QuotationItem[];
  parent: Pick<Quotation, 'id' | 'quotationRef' | 'revisionNumber' | 'title'> | null;
};

// ── Colours ──
const NAVY      = '#1C2B41';
const NAVY_L    = '#2A3F5F';
const BLUE      = '#0C66E4';
const BLUE_L    = '#E9F2FF';
const DARK      = '#1A1A1A';
const MED       = '#4A4A4A';
const LIGHT     = '#888888';
const RULE      = '#D0D5DD';
const BG_ALT    = '#F8FAFC';
const BG_TOTAL  = '#F0F4FF';
const WHITE     = '#FFFFFF';
const ACCENT    = '#0C66E4';

// ── Formatting helpers ──

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return (typeof d === 'string' ? new Date(d) : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtCurrency(n: number): string {
  return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return (typeof d === 'string' ? new Date(d) : d).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
      Title: `Quotation ${quotation.quotationRef} — ${quotation.title}`,
      Author: quotation.admin.companyName || 'Infrava',
      Subject: `Quotation for ${quotation.client?.name || 'Client'}`,
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

  // Load admin company logo
  let companyLogoBuf: Buffer | null = null;
  if (quotation.admin.logoUrl) {
    companyLogoBuf = await loadImage(quotation.admin.logoUrl);
  }

  // ── Layout helpers ──

  const pageBottom = doc.page.height - 80;

  function ensureSpace(h: number) {
    if (doc.y + h > pageBottom) { doc.addPage(); doc.y = 50; }
  }

  function sectionBar(title: string) {
    ensureSpace(36);
    if (doc.y > 60) doc.y += 10;
    const y = doc.y;
    doc.rect(LM, y, PW, 28).fill(NAVY);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(WHITE).text(title.toUpperCase(), LM + 14, y + 8, { width: PW - 28, characterSpacing: 0.8 });
    doc.y = y + 34;
  }

  function subHead(title: string) {
    ensureSpace(26);
    doc.y += 6;
    const y = doc.y;
    doc.rect(LM, y, 3, 16).fill(ACCENT);
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor(NAVY).text(title, LM + 12, y + 2);
    doc.y = y + 22;
  }

  function kv(label: string, value: string) {
    ensureSpace(18);
    const y = doc.y;
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(LIGHT).text(label, LM + 8, y, { width: 120 });
    doc.fontSize(8.5).font('Helvetica').fillColor(DARK).text(value || '—', LM + 132, y, { width: PW - 140 });
    doc.y = Math.max(doc.y, y + 15);
  }

  function kvTwo(l1: string, v1: string, l2: string, v2: string) {
    ensureSpace(18);
    const y = doc.y;
    const half = PW / 2;
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(LIGHT).text(l1, LM + 8, y, { width: 90 });
    doc.fontSize(8.5).font('Helvetica').fillColor(DARK).text(v1 || '—', LM + 100, y, { width: half - 108 });
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(LIGHT).text(l2, LM + half + 8, y, { width: 90 });
    doc.fontSize(8.5).font('Helvetica').fillColor(DARK).text(v2 || '—', LM + half + 100, y, { width: half - 108 });
    doc.y = y + 16;
  }

  function para(text: string) {
    ensureSpace(16);
    doc.fontSize(9).font('Helvetica').fillColor(MED).text(text, LM + 8, doc.y, { width: PW - 16, lineGap: 3 });
    doc.y += 4;
  }

  function tHead(cols: { label: string; w: number; align?: string }[]) {
    ensureSpace(24);
    const y = doc.y;
    doc.rect(LM, y, PW, 22).fill(NAVY);
    let x = LM;
    for (const c of cols) {
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(WHITE).text(c.label.toUpperCase(), x + 6, y + 6, { width: c.w - 12, align: (c.align as any) || 'left', characterSpacing: 0.3 });
      x += c.w;
    }
    doc.y = y + 22;
  }

  function tRow(cols: { val: string; w: number; align?: string; bold?: boolean }[], alt: boolean) {
    ensureSpace(20);
    const y = doc.y;
    if (alt) doc.rect(LM, y, PW, 20).fill(BG_ALT);
    doc.moveTo(LM, y + 20).lineTo(LM + PW, y + 20).lineWidth(0.3).strokeColor(RULE).stroke();
    let x = LM;
    for (const c of cols) {
      doc.fontSize(8).font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(DARK).text(c.val, x + 6, y + 5, { width: c.w - 12, align: (c.align as any) || 'left' });
      x += c.w;
    }
    doc.y = y + 20;
  }

  function divider() {
    ensureSpace(12);
    doc.y += 4;
    doc.moveTo(LM, doc.y).lineTo(LM + PW, doc.y).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.y += 6;
  }

  function totalRow(label: string, value: string, bold = false) {
    ensureSpace(22);
    const y = doc.y;
    const font = bold ? 'Helvetica-Bold' : 'Helvetica';
    const size = bold ? 11 : 9;
    const colour = bold ? NAVY : MED;
    doc.fontSize(size).font(font).fillColor(colour).text(label, LM + 8, y, { width: PW * 0.6 - 8, align: 'right' });
    doc.fontSize(size).font(font).fillColor(bold ? NAVY : DARK).text(value, LM + PW * 0.6, y, { width: PW * 0.4 - 8, align: 'right' });
    doc.y = y + (bold ? 20 : 16);
  }

  // ════════════════════════════════════════════════════════════
  // PAGE 1 — COVER HEADER
  // ════════════════════════════════════════════════════════════

  // Top accent stripe
  doc.rect(0, 0, doc.page.width, 5).fill(NAVY);

  const headerTop = 20;

  // Left side: admin company logo or placeholder
  if (companyLogoBuf) {
    try { doc.image(companyLogoBuf, LM, headerTop, { height: 40 }); } catch { /* skip */ }
  } else {
    const initial = company.name.charAt(0).toUpperCase();
    doc.roundedRect(LM, headerTop, 40, 40, 6).fill(NAVY);
    doc.fontSize(20).font('Helvetica-Bold').fillColor(WHITE).text(initial, LM + 12, headerTop + 10);
  }

  // Right side: company details
  const rightW = PW * 0.58;
  const rightX = LM + PW - rightW;
  let rightY = headerTop;

  doc.fontSize(13).font('Helvetica-Bold').fillColor(NAVY).text(company.name, rightX, rightY, { width: rightW, align: 'right' });
  rightY += 18;

  const infoLines: string[] = [];
  if (company.address) infoLines.push(company.address);
  const contactBits: string[] = [];
  if (company.phone) contactBits.push(company.phone);
  if (company.email) contactBits.push(company.email);
  if (contactBits.length) infoLines.push(contactBits.join('  |  '));
  if (company.website) infoLines.push(company.website);
  if (company.abn) infoLines.push(`Company Reg: ${company.abn}`);
  for (const line of infoLines) {
    doc.fontSize(7.5).font('Helvetica').fillColor(MED).text(line, rightX, rightY, { width: rightW, align: 'right' });
    rightY += 10;
  }

  // Title bar
  const titleBarY = Math.max(headerTop + 50, rightY + 8);
  const titleLabel = quotation.revisionNumber > 0
    ? `QUOTATION  —  Revision ${quotation.revisionNumber}`
    : 'QUOTATION';
  const refDateStr = `${quotation.quotationRef}  |  ${fmtDate(quotation.createdAt)}`;
  doc.rect(LM, titleBarY, PW, 30).fill(NAVY);
  doc.fontSize(14).font('Helvetica-Bold').fillColor(WHITE).text(titleLabel, LM + 16, titleBarY + 8, { width: PW * 0.5, characterSpacing: 0.5 });
  doc.fontSize(9).font('Helvetica').fillColor('#A0B4CF').text(refDateStr, LM + 16, titleBarY + 11, { width: PW - 32, align: 'right' });

  doc.y = titleBarY + 38;

  // ════════════════════════════════════════════════════════════
  // PREPARED FOR / PREPARED BY — side-by-side cards
  // ════════════════════════════════════════════════════════════

  if (quotation.client) {
    ensureSpace(80);
    const cardY = doc.y;
    const cardH = 68;
    const half = (PW - 12) / 2;

    // Prepared For card
    doc.rect(LM, cardY, half, cardH).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.rect(LM, cardY, half, 20).fill(BG_ALT);
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(LIGHT).text('PREPARED FOR', LM + 10, cardY + 6, { characterSpacing: 0.5 });
    doc.fontSize(10).font('Helvetica-Bold').fillColor(NAVY).text(quotation.client.name, LM + 10, cardY + 26, { width: half - 20 });
    if (quotation.client.address) {
      doc.fontSize(8).font('Helvetica').fillColor(MED).text(quotation.client.address, LM + 10, cardY + 40, { width: half - 20 });
    }

    // Prepared By card
    const rightCardX = LM + half + 12;
    doc.rect(rightCardX, cardY, half, cardH).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.rect(rightCardX, cardY, half, 20).fill(BG_ALT);
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(LIGHT).text('PREPARED BY', rightCardX + 10, cardY + 6, { characterSpacing: 0.5 });
    doc.fontSize(10).font('Helvetica-Bold').fillColor(NAVY).text(company.name, rightCardX + 10, cardY + 26, { width: half - 20 });
    if (company.address) {
      doc.fontSize(8).font('Helvetica').fillColor(MED).text(company.address, rightCardX + 10, cardY + 40, { width: half - 20 });
    }

    doc.y = cardY + cardH + 8;
  }

  // ════════════════════════════════════════════════════════════
  // QUOTATION DETAILS
  // ════════════════════════════════════════════════════════════

  sectionBar('Quotation Details');
  kvTwo('Reference', quotation.quotationRef, 'Date', fmtDate(quotation.createdAt));
  kvTwo('Status', quotation.status, 'Revision', quotation.revisionNumber > 0 ? `Rev. ${quotation.revisionNumber}` : 'Original');
  kv('Title', quotation.title);
  if (quotation.parent) {
    kv('Revision Of', `${quotation.parent.quotationRef} — ${quotation.parent.title}`);
  }

  // ════════════════════════════════════════════════════════════
  // CONTACTS (Operations + Commercial)
  // ════════════════════════════════════════════════════════════

  if (quotation.client) {
    const hasOps = quotation.client.opsContactName || quotation.client.opsContactEmail || quotation.client.opsContactPhone;
    const hasCom = quotation.client.comContactName || quotation.client.comContactEmail || quotation.client.comContactPhone;

    if (hasOps || hasCom) {
      sectionBar('Contact Information');
    }

    if (hasOps && hasCom) {
      ensureSpace(60);
      doc.y += 2;
      const y = doc.y;
      const half = PW / 2;

      doc.rect(LM, y, 3, 16).fill(ACCENT);
      doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY).text('Operations Contact', LM + 12, y + 2);
      doc.rect(LM + half, y, 3, 16).fill(ACCENT);
      doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY).text('Commercial Contact', LM + half + 12, y + 2);

      let rowY = y + 22;
      const contactRows: [string, string | undefined, string | undefined][] = [
        ['Name', quotation.client.opsContactName ?? undefined, quotation.client.comContactName ?? undefined],
        ['Email', quotation.client.opsContactEmail ?? undefined, quotation.client.comContactEmail ?? undefined],
        ['Phone', quotation.client.opsContactPhone ?? undefined, quotation.client.comContactPhone ?? undefined],
      ];

      for (const [label, ops, com] of contactRows) {
        if (!ops && !com) continue;
        ensureSpace(16);
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor(LIGHT).text(label, LM + 8, rowY, { width: 50 });
        doc.fontSize(8.5).font('Helvetica').fillColor(DARK).text(ops || '—', LM + 60, rowY, { width: half - 66 });
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor(LIGHT).text(label, LM + half + 8, rowY, { width: 50 });
        doc.fontSize(8.5).font('Helvetica').fillColor(DARK).text(com || '—', LM + half + 60, rowY, { width: half - 66 });
        rowY += 15;
      }
      doc.y = rowY;
    } else {
      if (hasOps) {
        subHead('Operations Contact');
        if (quotation.client.opsContactName) kv('Name', quotation.client.opsContactName);
        if (quotation.client.opsContactEmail) kv('Email', quotation.client.opsContactEmail);
        if (quotation.client.opsContactPhone) kv('Phone', quotation.client.opsContactPhone);
      }
      if (hasCom) {
        subHead('Commercial Contact');
        if (quotation.client.comContactName) kv('Name', quotation.client.comContactName);
        if (quotation.client.comContactEmail) kv('Email', quotation.client.comContactEmail);
        if (quotation.client.comContactPhone) kv('Phone', quotation.client.comContactPhone);
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // WORK DESCRIPTION
  // ════════════════════════════════════════════════════════════

  if (quotation.workDescription) {
    sectionBar('Scope of Works');
    para(quotation.workDescription);
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
        { val: fmtCurrency(item.amount),   w: colDefs[6].w, align: 'right', bold: true },
      ], idx % 2 === 1);
    });

    // Sub-total row
    ensureSpace(24);
    const stY = doc.y;
    doc.rect(LM, stY, PW, 22).fill(BG_TOTAL);
    doc.moveTo(LM, stY).lineTo(LM + PW, stY).lineWidth(0.8).strokeColor(ACCENT).stroke();
    const stLabelW = colDefs[0].w + colDefs[1].w + colDefs[2].w + colDefs[3].w + colDefs[4].w + colDefs[5].w;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY).text(`Sub-Total (${cat})`, LM + 8, stY + 6, { width: stLabelW - 16, align: 'right' });
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY).text(fmtCurrency(catSubtotal), LM + stLabelW + 6, stY + 6, { width: colDefs[6].w - 12, align: 'right' });
    doc.y = stY + 24;
  }

  // ════════════════════════════════════════════════════════════
  // GRAND TOTALS — highlighted box
  // ════════════════════════════════════════════════════════════

  const totalExclVat = quotation.items.reduce((sum, i) => sum + i.amount, 0);
  const vatPercent = quotation.vatPercent;
  const vatAmount = vatPercent ? Math.round(totalExclVat * vatPercent / 100 * 100) / 100 : 0;
  const totalInclVat = totalExclVat + vatAmount;

  sectionBar('Financial Summary');

  // Per-category subtotals
  for (const cat of enabledCategories) {
    const catItems = quotation.items.filter(i => i.category === cat);
    if (catItems.length === 0) continue;
    const catTotal = catItems.reduce((sum, i) => sum + i.amount, 0);
    totalRow(cat, fmtCurrency(catTotal));
  }

  divider();
  totalRow('Total Excl. VAT', fmtCurrency(totalExclVat));
  totalRow(`VAT (${vatPercent ?? 0}%)`, fmtCurrency(vatAmount));

  // Grand total highlight box
  ensureSpace(36);
  doc.y += 4;
  const gtY = doc.y;
  doc.rect(LM + PW * 0.45, gtY, PW * 0.55, 28).fill(NAVY);
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#A0B4CF').text('TOTAL INCL. VAT', LM + PW * 0.45 + 14, gtY + 8, { width: PW * 0.25 });
  doc.fontSize(12).font('Helvetica-Bold').fillColor(WHITE).text(fmtCurrency(totalInclVat), LM + PW * 0.45 + 14, gtY + 7, { width: PW * 0.55 - 28, align: 'right' });
  doc.y = gtY + 36;

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
  // NOTE (optional)
  // ════════════════════════════════════════════════════════════

  if (quotation.note) {
    sectionBar('Additional Notes');
    para(quotation.note);
  }

  // ════════════════════════════════════════════════════════════
  // TERMS & ACCEPTANCE
  // ════════════════════════════════════════════════════════════

  ensureSpace(80);
  doc.y += 8;
  const termsY = doc.y;
  doc.rect(LM, termsY, PW, 60).lineWidth(0.5).strokeColor(RULE).stroke();
  doc.rect(LM, termsY, PW, 18).fill(BG_ALT);
  doc.fontSize(7.5).font('Helvetica-Bold').fillColor(LIGHT).text('TERMS & CONDITIONS', LM + 10, termsY + 5, { characterSpacing: 0.5 });
  const termsText = [
    'This quotation is valid for 30 days from the date of issue unless otherwise stated.',
    'All prices are quoted in GBP (£) and are subject to the terms outlined above.',
    `Payment terms: 30 days from date of invoice. All works subject to ${company.name} standard terms and conditions.`,
  ].join(' ');
  doc.fontSize(7.5).font('Helvetica').fillColor(MED).text(termsText, LM + 10, termsY + 24, { width: PW - 20, lineGap: 2 });
  doc.y = termsY + 68;

  // ════════════════════════════════════════════════════════════
  // PAGE FOOTERS (retroactive across all pages)
  // ════════════════════════════════════════════════════════════

  const now = fmtDateTime(new Date());
  const pages = doc.bufferedPageRange().count;

  for (let i = 0; i < pages; i++) {
    doc.switchToPage(i);

    // Top accent bar on continuation pages
    if (i > 0) doc.rect(0, 0, doc.page.width, 5).fill(NAVY);

    const fy = doc.page.height - 52;

    // Footer line
    doc.moveTo(LM, fy).lineTo(LM + PW, fy).lineWidth(0.5).strokeColor(NAVY).stroke();

    // Left: company info
    let footY = fy + 5;
    doc.fontSize(7).font('Helvetica-Bold').fillColor(NAVY).text(company.name, LM, footY, { width: PW * 0.55 });
    footY += 9;
    const footerBits: string[] = [];
    if (company.address) footerBits.push(company.address);
    if (company.phone) footerBits.push(company.phone);
    if (footerBits.length) {
      doc.fontSize(6.5).font('Helvetica').fillColor(LIGHT).text(footerBits.join('  |  '), LM, footY, { width: PW * 0.55 });
      footY += 8;
    }
    const footerBits2: string[] = [];
    if (company.email) footerBits2.push(company.email);
    if (company.website) footerBits2.push(company.website);
    if (company.abn) footerBits2.push(`Reg: ${company.abn}`);
    if (footerBits2.length) {
      doc.fontSize(6.5).font('Helvetica').fillColor(LIGHT).text(footerBits2.join('  |  '), LM, footY, { width: PW * 0.55 });
    }

    // Right: page number + generated date + branding
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(NAVY).text(
      `Page ${i + 1} of ${pages}`,
      LM, fy + 5, { width: PW, align: 'right' }
    );
    doc.fontSize(6.5).font('Helvetica').fillColor(LIGHT).text(
      `Generated: ${now}`,
      LM, fy + 15, { width: PW, align: 'right' }
    );
    doc.fontSize(6).font('Helvetica').fillColor(LIGHT).text(
      'Powered by Infrava',
      LM, fy + 24, { width: PW, align: 'right' }
    );
  }

  doc.end();
  return new Promise<Buffer>((resolve) => { doc.on('end', () => resolve(Buffer.concat(chunks))); });
}
