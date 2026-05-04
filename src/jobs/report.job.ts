import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { Fault, FaultPhoto, User, Client, WorkDay, PunchEvent } from '@prisma/client';
import { getFile } from '../shared/services/storage.service';

const INFRAVA_LOGO = path.join(process.cwd(), 'assets', 'logo.png');

type WorkDayWithRelations = WorkDay & { events: PunchEvent[]; photos: FaultPhoto[] };

type FaultWithRelations = Fault & {
  admin: Pick<User, 'id' | 'name' | 'email' | 'avatarUrl' | 'companyName' | 'companyAddress' | 'companyWebsite' | 'companyPhone' | 'companyEmail' | 'companyAbn' | 'logoUrl'>;
  assignedOperative: Pick<User, 'name'> | null;
  client: Pick<Client, 'name' | 'address' | 'opsContactName' | 'opsContactEmail' | 'opsContactPhone'> | null;
  photos: FaultPhoto[];
  workDays: WorkDayWithRelations[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formTemplate?: { schema: any } | null;
};

// ── Colours (matching quotation design system) ──
const NAVY     = '#1C2B41';
const ACCENT   = '#0C66E4';
const DARK     = '#1A1A1A';
const MED      = '#4A4A4A';
const LIGHT    = '#888888';
const RULE     = '#D0D5DD';
const BG_ALT   = '#F8FAFC';
const BG_TOTAL = '#F0F4FF';
const GREEN    = '#16A34A';
const RED      = '#DC2626';
const WHITE    = '#FFFFFF';

// ── Formatting helpers ──

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return (typeof d === 'string' ? new Date(d) : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtDateShort(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return (typeof d === 'string' ? new Date(d) : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return (typeof d === 'string' ? new Date(d) : d).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtTime(d: Date | string): string {
  return (typeof d === 'string' ? new Date(d) : d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function elapsed(t1: Date | string, t2: Date | string): string {
  const mins = Math.round((new Date(t2).getTime() - new Date(t1).getTime()) / 60000);
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
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

async function loadR2Photo(r2Key: string): Promise<Buffer | null> {
  try { return await getFile(r2Key); }
  catch { return null; }
}

export async function generateFaultPdf(fault: FaultWithRelations): Promise<Buffer> {
  const LM = 50;
  const RM = 50;
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 50, bottom: 0, left: LM, right: RM },
    bufferPages: true,
    info: {
      Title: `Site Visit Report — ${fault.projectRef}`,
      Author: fault.admin.companyName || 'Infrava',
      Subject: `Site report for ${fault.client?.name || 'Client'}`,
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const PW = doc.page.width - LM - RM;

  const company = {
    name:    fault.admin.companyName || 'Infrava',
    address: fault.admin.companyAddress || '',
    website: fault.admin.companyWebsite || '',
    phone:   fault.admin.companyPhone || '',
    email:   fault.admin.companyEmail || fault.admin.email,
    abn:     fault.admin.companyAbn || '',
  };

  // Load Infrava logo (always fixed, left side)
  let infravaLogoBuf: Buffer | null = null;
  try {
    if (fs.existsSync(INFRAVA_LOGO)) {
      infravaLogoBuf = fs.readFileSync(INFRAVA_LOGO);
    }
  } catch { /* skip */ }

  // Load admin's company logo (right side)
  let companyLogoBuf: Buffer | null = null;
  if (fault.admin.logoUrl) {
    companyLogoBuf = await loadImage(fault.admin.logoUrl);
  }

  // ── Layout helpers (matching quotation design) ──

  const pageBottom = doc.page.height - 70;

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
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(LIGHT).text(label, LM + 8, y, { width: 90 });
    doc.fontSize(8.5).font('Helvetica').fillColor(DARK).text(value || '—', LM + 100, y, { width: PW - 108 });
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
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(WHITE).text(c.label.toUpperCase(), x + 6, y + 6, { width: c.w - 12, align: (c.align as 'left' | 'right') || 'left', characterSpacing: 0.3 });
      x += c.w;
    }
    doc.y = y + 22;
  }

  function tRow(cols: { val: string; w: number; align?: string; bold?: boolean }[], alt: boolean) {
    let maxTextH = 0;
    for (const c of cols) {
      const h = doc.fontSize(8).font(c.bold ? 'Helvetica-Bold' : 'Helvetica').heightOfString(c.val, { width: c.w - 12 });
      if (h > maxTextH) maxTextH = h;
    }
    const rowH = Math.max(20, maxTextH + 10);
    ensureSpace(rowH);
    const y = doc.y;
    if (alt) doc.rect(LM, y, PW, rowH).fill(BG_ALT);
    doc.moveTo(LM, y + rowH).lineTo(LM + PW, y + rowH).lineWidth(0.3).strokeColor(RULE).stroke();
    let x = LM;
    for (const c of cols) {
      doc.fontSize(8).font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(DARK).text(c.val, x + 6, y + 5, { width: c.w - 12, align: (c.align as 'left' | 'right') || 'left' });
      x += c.w;
    }
    doc.y = y + rowH;
  }

  function divider() {
    ensureSpace(12);
    doc.y += 4;
    doc.moveTo(LM, doc.y).lineTo(LM + PW, doc.y).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.y += 6;
  }

  // ════════════════════════════════════════════════════════════
  // COVER HEADER — Full-width navy banner with logos + company details below
  // ════════════════════════════════════════════════════════════

  // Full-width navy banner — logos on sides, title centered vertically
  const bannerH = 70;
  doc.rect(0, 0, doc.page.width, bannerH).fill(NAVY);

  const logoFit = 40;
  const logoMidY = (bannerH - logoFit) / 2; // vertically center logos

  // Infrava logo (left)
  if (infravaLogoBuf) {
    try { doc.image(infravaLogoBuf, LM, logoMidY, { fit: [100, logoFit] }); } catch { /* skip */ }
  } else {
    doc.roundedRect(LM, logoMidY, logoFit, logoFit, 6).fill(WHITE);
    doc.fontSize(22).font('Helvetica-Bold').fillColor(NAVY).text('I', LM + 14, logoMidY + 10);
  }

  // Admin company logo (right — flush to right margin)
  if (companyLogoBuf) {
    try { doc.image(companyLogoBuf, LM + PW - 100, logoMidY, { fit: [100, logoFit] }); } catch { /* skip */ }
  } else {
    const initial = company.name.charAt(0).toUpperCase();
    doc.roundedRect(LM + PW - logoFit, logoMidY, logoFit, logoFit, 6).fill(ACCENT);
    doc.fontSize(22).font('Helvetica-Bold').fillColor(WHITE).text(initial, LM + PW - logoFit + 13, logoMidY + 10);
  }

  // "SITE VISIT REPORT" — vertically centered in the banner
  const titleTextH = 15; // approximate font height
  const titleY = (bannerH - titleTextH) / 2;
  doc.fontSize(15).font('Helvetica-Bold').fillColor(WHITE).text('SITE VISIT REPORT', LM, titleY, { width: PW, align: 'center', characterSpacing: 1.5 });

  // Company name + details row below banner
  const detailY = bannerH + 10;
  doc.fontSize(12).font('Helvetica-Bold').fillColor(NAVY).text(company.name, LM, detailY, { width: PW });

  const infoLine: string[] = [];
  if (company.address) infoLine.push(company.address);
  if (company.phone) infoLine.push(company.phone);
  if (company.email) infoLine.push(company.email);
  if (company.website) infoLine.push(company.website);
  if (company.abn) infoLine.push(`Reg: ${company.abn}`);

  let infoY = detailY + 16;
  if (infoLine.length) {
    const mid = Math.ceil(infoLine.length / 2);
    const row1 = infoLine.slice(0, mid).join('   |   ');
    const row2 = infoLine.slice(mid).join('   |   ');
    doc.fontSize(7.5).font('Helvetica').fillColor(MED).text(row1, LM, infoY, { width: PW });
    infoY += 10;
    if (row2) {
      doc.fontSize(7.5).font('Helvetica').fillColor(MED).text(row2, LM, infoY, { width: PW });
      infoY += 10;
    }
  }

  // Thin accent line
  infoY += 4;
  doc.moveTo(LM, infoY).lineTo(LM + PW, infoY).lineWidth(0.8).strokeColor(ACCENT).stroke();

  // Ref + date bar
  const refBarY = infoY + 6;
  doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY).text(
    fault.projectRef, LM, refBarY
  );
  doc.fontSize(9).font('Helvetica').fillColor(MED).text(
    fmtDate(fault.faultDate), LM, refBarY, { width: PW, align: 'right' }
  );

  doc.y = refBarY + 18;

  // ════════════════════════════════════════════════════════════
  // CLIENT / PREPARED BY — side-by-side cards
  // ════════════════════════════════════════════════════════════

  {
    const half = (PW - 12) / 2;
    const clientContentH = 16 + (fault.client?.address ? 11 : 0) + 6;
    const preparedContentH = 16 + 6; // name only, no details
    const cardH = Math.max(clientContentH, preparedContentH) + 20; // +20 for header

    ensureSpace(cardH + 10);
    const cardY = doc.y;

    if (fault.client) {
      // Client card (left)
      doc.rect(LM, cardY, half, cardH).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.rect(LM, cardY, half, 20).fill(BG_ALT);
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(LIGHT).text('CLIENT', LM + 10, cardY + 6, { characterSpacing: 0.5 });
      doc.fontSize(10).font('Helvetica-Bold').fillColor(NAVY).text(fault.client.name, LM + 10, cardY + 26, { width: half - 20 });
      if (fault.client.address) {
        doc.fontSize(8).font('Helvetica').fillColor(MED).text(fault.client.address, LM + 10, cardY + 40, { width: half - 20 });
      }
    }

    // Prepared By card (right) — company name only (details already in header)
    const rightCardX = fault.client ? LM + half + 12 : LM;
    const rightCardW = fault.client ? half : PW;
    doc.rect(rightCardX, cardY, rightCardW, cardH).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.rect(rightCardX, cardY, rightCardW, 20).fill(BG_ALT);
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(LIGHT).text('PREPARED BY', rightCardX + 10, cardY + 6, { characterSpacing: 0.5 });
    doc.fontSize(10).font('Helvetica-Bold').fillColor(NAVY).text(company.name, rightCardX + 10, cardY + 26, { width: rightCardW - 20 });

    doc.y = cardY + cardH + 8;
  }

  // ════════════════════════════════════════════════════════════
  // TEMPLATE-AWARE FIELD CHECKS
  // ════════════════════════════════════════════════════════════

  const templateSections = (fault.formTemplate?.schema as Record<string, unknown>)?.sections as
    { title: string; fields: { key: string; label: string; source: string }[] }[] | undefined;
  const templateFields = new Set<string>();
  if (templateSections) {
    for (const sec of templateSections) {
      for (const f of sec.fields) templateFields.add(f.key);
    }
  }
  const hasField = (key: string) => templateFields.size === 0 || templateFields.has(key);

  // ════════════════════════════════════════════════════════════
  // JOB DETAILS
  // ════════════════════════════════════════════════════════════

  sectionBar('Job Details');
  kvTwo('Project Ref', fault.projectRef, 'Client Ref', hasField('clientRef') ? (fault.clientRef || '—') : '—');
  kvTwo('Date', fmtDate(fault.faultDate), 'Priority', hasField('priority') ? (fault.priority || '—') : '—');
  // Report is generated after final submit, so status is always COMPLETED
  const displayStatus = 'COMPLETED';
  if (hasField('workType')) kvTwo('Work Type', fault.workType || '—', 'Status', displayStatus);
  else kv('Status', displayStatus);
  if (fault.title) kv('Title', fault.title);
  if (hasField('locationText') && fault.locationText) kv('Location', fault.locationText);

  // Scheduling
  if ((hasField('timeAllocated') && fault.timeAllocated) || (hasField('plannedArrival') && fault.plannedArrival) || (hasField('plannedCompletion') && fault.plannedCompletion)) {
    divider();
    subHead('Scheduling');
    if (hasField('timeAllocated') && fault.timeAllocated) kv('Time Allocated', fmtDateTime(fault.timeAllocated));
    if (hasField('plannedArrival') && fault.plannedArrival) kv('Planned Arrival', fmtDateTime(fault.plannedArrival));
    if (hasField('plannedCompletion') && fault.plannedCompletion) kv('Planned Completion', fmtDateTime(fault.plannedCompletion));
  }

  // ════════════════════════════════════════════════════════════
  // SCOPE OF WORKS
  // ════════════════════════════════════════════════════════════

  if (hasField('description') && fault.description) {
    sectionBar('Scope of Works');
    para(fault.description);
  }

  // ════════════════════════════════════════════════════════════
  // PERSONNEL
  // ════════════════════════════════════════════════════════════

  sectionBar('Personnel');
  kvTwo('Operative', fault.assignedOperative?.name || '—', 'Admin', fault.admin.name);
  const hasContractorFields = hasField('contractorCompany') || hasField('contractorName');
  if (hasContractorFields && (fault.contractorCompany || fault.contractorName)) {
    divider();
    subHead('Contractor');
    if (fault.contractorCompany) kv('Company', fault.contractorCompany);
    if (fault.contractorName) kv('Name', fault.contractorName);
    if (fault.contractorEmail) kv('Email', fault.contractorEmail);
    if (fault.contractorMobile) kv('Mobile', fault.contractorMobile);
  }

  // ════════════════════════════════════════════════════════════
  // ONSITE CONTACT
  // ════════════════════════════════════════════════════════════

  const hasOnsiteFields = hasField('onsiteContactName') || hasField('onsiteContactPhone') || hasField('onsiteContactEmail');
  if (hasOnsiteFields && (fault.onsiteContactName || fault.onsiteContactPhone || fault.onsiteContactEmail)) {
    sectionBar('Onsite Contact');
    if (fault.onsiteContactName) kv('Name', fault.onsiteContactName);
    if (fault.onsiteContactPhone) kv('Phone', fault.onsiteContactPhone);
    if (fault.onsiteContactEmail) kv('Email', fault.onsiteContactEmail);
  }

  // ════════════════════════════════════════════════════════════
  // VISIT REQUIREMENTS
  // ════════════════════════════════════════════════════════════

  const hasVisitFields = hasField('visitTaskBriefing');
  if (hasVisitFields) {
    sectionBar('Visit Requirements');
    const reqs: [string, boolean][] = [
      ['Task Briefing', fault.visitTaskBriefing], ['LSR', fault.visitLsr],
      ['Link Block', fault.visitLinkBlock], ['Safe Work Pack', fault.visitSafeWorkPack],
      ['Possession', fault.visitPossession], ['Temp Works', fault.visitTempWorks],
      ['Isolation', fault.visitIsolation], ['Track Access', fault.visitTrackAccess],
      ['Temp Works Required', fault.visitTempWorksRequired], ['Working at Height', fault.visitWorkingAtHeight],
    ];
    const half = PW / 2;
    for (let i = 0; i < reqs.length; i += 2) {
      ensureSpace(20);
      const y = doc.y;
      if (Math.floor(i / 2) % 2 === 0) doc.rect(LM, y, PW, 18).fill(BG_ALT);
      for (let c = 0; c < 2 && i + c < reqs.length; c++) {
        const [label, on] = reqs[i + c];
        const x = LM + c * half + 12;
        const marker = on ? '\u2713' : '\u2717';
        doc.fontSize(10).font('Helvetica-Bold').fillColor(on ? GREEN : RED).text(marker, x, y + 3);
        doc.fontSize(8.5).font('Helvetica').fillColor(DARK).text(label, x + 16, y + 4);
      }
      doc.y = y + 18;
    }
  }

  // ════════════════════════════════════════════════════════════
  // CUSTOM FIELDS (from form template)
  // ════════════════════════════════════════════════════════════

  const customData = fault.customFields as Record<string, unknown> | null;
  if (templateSections && customData) {
    for (const sec of templateSections) {
      const customFields = sec.fields.filter(f => f.source === 'custom');
      const filled = customFields.filter(f => {
        const v = customData[f.key];
        return v !== undefined && v !== null && v !== '';
      });
      if (filled.length > 0) {
        subHead(sec.title);
        for (const f of filled) {
          const v = customData[f.key];
          const display = Array.isArray(v) ? v.join(', ') : String(v);
          kv(f.label, display);
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // DAILY WORK REPORTS
  // ════════════════════════════════════════════════════════════

  const opSections = fault.formTemplate?.schema?.operativeSections as string[] | undefined;
  const isEnabled = (key: string) => !opSections || opSections.includes(key);

  for (const day of fault.workDays) {
    // Day header with completion status
    const dayLabel = `Day ${day.dayNumber} — ${fmtDateShort(day.createdAt)}`;
    sectionBar(dayLabel + (day.isLocked ? '  •  Completed' : ''));

    // ── Attendance / GPS ──
    if (isEnabled('gpsTracking') && day.events.length > 0) {
      subHead('Attendance & GPS Tracking');

      // Summary line
      const punchIn = day.events.find(e => e.eventType === 'PUNCH_IN');
      const punchOut = day.events.find(e => e.eventType === 'PUNCH_OUT');
      if (punchIn && punchOut) {
        const totalTime = elapsed(punchIn.timestamp, punchOut.timestamp);
        ensureSpace(20);
        const sumY = doc.y;
        doc.rect(LM, sumY, PW, 18).fill(BG_TOTAL);
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor(NAVY).text(
          `Total on site: ${totalTime}  |  In: ${fmtTime(punchIn.timestamp)}  |  Out: ${fmtTime(punchOut.timestamp)}`,
          LM + 8, sumY + 4, { width: PW - 16 }
        );
        doc.y = sumY + 22;
      }

      const cols = [
        { label: 'Event', w: PW * 0.22 }, { label: 'Time', w: PW * 0.14 },
        { label: 'Latitude', w: PW * 0.18 }, { label: 'Longitude', w: PW * 0.18 },
        { label: 'Elapsed / Distance', w: PW * 0.28 },
      ];
      tHead(cols);
      for (let i = 0; i < day.events.length; i++) {
        const e = day.events[i];
        let info = '';
        if (i > 0) {
          const p = day.events[i - 1];
          info = `${elapsed(p.timestamp, e.timestamp)}  /  ${haversine(p.lat, p.lng, e.lat, e.lng).toFixed(2)} mi`;
        }
        tRow([
          { val: e.eventType.replace(/_/g, ' '), w: cols[0].w, bold: true },
          { val: fmtTime(e.timestamp), w: cols[1].w },
          { val: e.lat.toFixed(6), w: cols[2].w },
          { val: e.lng.toFixed(6), w: cols[3].w },
          { val: info, w: cols[4].w },
        ], i % 2 === 1);
      }
    }

    // ── Personnel ──
    if (isEnabled('personnel') && (day.supervisorNames || day.tradespersonNames || day.operativeName)) {
      subHead('Personnel on Site');
      if (day.supervisorNames) kv('Supervisor(s)', day.supervisorNames);
      if (day.tradespersonNames) kv('Tradesperson(s)', day.tradespersonNames);
      if (day.operativeName) kv('Operative', day.operativeName);
    }

    // ── Methodology ──
    if (isEnabled('methodology') && day.methodology) {
      subHead('Methodology');
      para(day.methodology);
    }

    // ── Works Description ──
    if (isEnabled('worksDescription') && day.worksDescription) {
      subHead('Description of Completed Works');
      para(day.worksDescription);
    }

    // ── Temp Works ──
    const tw = day.tempWorks as { item: string; qty: number; unit?: string }[] | null;
    if (isEnabled('tempWorks') && tw && Array.isArray(tw) && tw.some(r => r.item)) {
      subHead('Temporary Works');
      const cols = [
        { label: 'Item', w: PW * 0.50 },
        { label: 'Quantity', w: PW * 0.25, align: 'right' },
        { label: 'Unit', w: PW * 0.25 },
      ];
      tHead(cols);
      tw.forEach((r, i) => {
        if (r.item) tRow([
          { val: r.item, w: cols[0].w },
          { val: String(r.qty), w: cols[1].w, align: 'right' },
          { val: r.unit || '', w: cols[2].w },
        ], i % 2 === 1);
      });
    }

    // ── Materials Used ──
    const mats = day.materialsUsed as { item: string; qty: number; unit?: string }[] | null;
    if (isEnabled('materials') && mats && Array.isArray(mats) && mats.some(r => r.item)) {
      subHead('Materials Used');
      const cols = [
        { label: 'Item', w: PW * 0.50 },
        { label: 'Quantity', w: PW * 0.25, align: 'right' },
        { label: 'Unit', w: PW * 0.25 },
      ];
      tHead(cols);
      mats.forEach((r, i) => {
        if (r.item) tRow([
          { val: r.item, w: cols[0].w },
          { val: String(r.qty), w: cols[1].w, align: 'right' },
          { val: r.unit || '', w: cols[2].w },
        ], i % 2 === 1);
      });
    }

    // ── Dimensions ──
    const dims = day.dimensions as { activity: string; qty: number; unit?: string }[] | null;
    if (isEnabled('dimensions') && dims && Array.isArray(dims) && dims.some(r => r.activity)) {
      subHead('Dimensions / Quantities');
      const cols = [
        { label: 'Activity', w: PW * 0.50 },
        { label: 'Quantity', w: PW * 0.25, align: 'right' },
        { label: 'Unit', w: PW * 0.25 },
      ];
      tHead(cols);
      dims.forEach((r, i) => {
        if (r.activity) tRow([
          { val: r.activity, w: cols[0].w },
          { val: String(r.qty), w: cols[1].w, align: 'right' },
          { val: r.unit || '', w: cols[2].w },
        ], i % 2 === 1);
      });
    }

    // ── Further Work ──
    if (isEnabled('furtherWork') && day.furtherWork) {
      subHead('Further Work Required');
      // Highlight box
      ensureSpace(24);
      const fwY = doc.y;
      const fwText = day.furtherWorkNotes || 'Yes — no additional notes provided.';
      const fwH = Math.max(22, doc.fontSize(8.5).font('Helvetica').heightOfString(fwText, { width: PW - 32 }) + 14);
      doc.rect(LM, fwY, PW, fwH).fill('#FFF7ED');
      doc.rect(LM, fwY, 3, fwH).fill('#F59E0B');
      doc.fontSize(8.5).font('Helvetica').fillColor('#92400E').text(fwText, LM + 12, fwY + 7, { width: PW - 32, lineGap: 2 });
      doc.y = fwY + fwH + 4;
    }

    // ── Day Photos (embedded) ──
    if (isEnabled('photos') && day.photos.length > 0) {
      subHead(`Photographic Record (${day.photos.length})`);

      for (const stage of ['before', 'during', 'after'] as const) {
        const stagePhotos = day.photos.filter(p => p.photoStage === stage);
        if (stagePhotos.length === 0) continue;

        ensureSpace(20);
        doc.fontSize(8).font('Helvetica-Bold').fillColor(MED).text(
          `${stage.charAt(0).toUpperCase() + stage.slice(1)} (${stagePhotos.length})`,
          LM + 8, doc.y, { width: PW - 16 }
        );
        doc.y += 14;

        // Photo grid — 3 per row
        const photoW = (PW - 24) / 3;
        const photoH = 90;
        let col = 0;
        let rowY = doc.y;

        for (const photo of stagePhotos) {
          if (col === 0) {
            ensureSpace(photoH + 20);
            rowY = doc.y;
          }
          const x = LM + col * (photoW + 12);
          const buf = await loadR2Photo(photo.r2Key);
          if (buf) {
            try {
              doc.rect(x, rowY, photoW, photoH).lineWidth(0.5).strokeColor(RULE).stroke();
              doc.image(buf, x + 1, rowY + 1, { width: photoW - 2, height: photoH - 2, fit: [photoW - 2, photoH - 2], align: 'center', valign: 'center' });
            } catch {
              // Fallback: show filename
              doc.rect(x, rowY, photoW, photoH).fill(BG_ALT);
              doc.fontSize(7).font('Helvetica').fillColor(LIGHT).text(photo.fileName || photo.r2Key, x + 4, rowY + photoH / 2 - 4, { width: photoW - 8, align: 'center' });
            }
          } else {
            doc.rect(x, rowY, photoW, photoH).fill(BG_ALT);
            doc.fontSize(7).font('Helvetica').fillColor(LIGHT).text(photo.fileName || 'Photo unavailable', x + 4, rowY + photoH / 2 - 4, { width: photoW - 8, align: 'center' });
          }

          // Caption
          if (photo.fileName) {
            doc.fontSize(6.5).font('Helvetica').fillColor(LIGHT).text(photo.fileName, x, rowY + photoH + 2, { width: photoW, align: 'center' });
          }

          col++;
          if (col >= 3) {
            col = 0;
            doc.y = rowY + photoH + 16;
          }
        }
        if (col > 0) doc.y = rowY + photoH + 16;
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // ADDITIONAL PHOTOS (not linked to a work day)
  // ════════════════════════════════════════════════════════════

  const extraPhotos = fault.photos.filter(p => !p.workDayId);
  if (isEnabled('photos') && extraPhotos.length > 0) {
    sectionBar(`Additional Photos (${extraPhotos.length})`);

    for (const stage of ['before', 'during', 'after'] as const) {
      const stagePhotos = extraPhotos.filter(p => p.photoStage === stage);
      if (stagePhotos.length === 0) continue;

      ensureSpace(20);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(MED).text(
        `${stage.charAt(0).toUpperCase() + stage.slice(1)} (${stagePhotos.length})`,
        LM + 8, doc.y, { width: PW - 16 }
      );
      doc.y += 14;

      const photoW = (PW - 24) / 3;
      const photoH = 90;
      let col = 0;
      let rowY = doc.y;

      for (const photo of stagePhotos) {
        if (col === 0) {
          ensureSpace(photoH + 20);
          rowY = doc.y;
        }
        const x = LM + col * (photoW + 12);
        const buf = await loadR2Photo(photo.r2Key);
        if (buf) {
          try {
            doc.rect(x, rowY, photoW, photoH).lineWidth(0.5).strokeColor(RULE).stroke();
            doc.image(buf, x + 1, rowY + 1, { width: photoW - 2, height: photoH - 2, fit: [photoW - 2, photoH - 2], align: 'center', valign: 'center' });
          } catch {
            doc.rect(x, rowY, photoW, photoH).fill(BG_ALT);
            doc.fontSize(7).font('Helvetica').fillColor(LIGHT).text(photo.fileName || photo.r2Key, x + 4, rowY + photoH / 2 - 4, { width: photoW - 8, align: 'center' });
          }
        } else {
          doc.rect(x, rowY, photoW, photoH).fill(BG_ALT);
          doc.fontSize(7).font('Helvetica').fillColor(LIGHT).text(photo.fileName || 'Photo unavailable', x + 4, rowY + photoH / 2 - 4, { width: photoW - 8, align: 'center' });
        }
        col++;
        if (col >= 3) {
          col = 0;
          doc.y = rowY + photoH + 16;
        }
      }
      if (col > 0) doc.y = rowY + photoH + 16;
    }
  }

  // ════════════════════════════════════════════════════════════
  // SIGN-OFF / COMPLETION SUMMARY
  // ════════════════════════════════════════════════════════════

  if (fault.completedAt || fault.operativeSubmittedAt) {
    ensureSpace(80);
    doc.y += 8;
    const boxY = doc.y;
    doc.rect(LM, boxY, PW, 60).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.rect(LM, boxY, PW, 20).fill(BG_ALT);
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(LIGHT).text('COMPLETION RECORD', LM + 10, boxY + 6, { characterSpacing: 0.5 });

    let recY = boxY + 26;
    if (fault.operativeSubmittedAt) {
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(LIGHT).text('Operative Submitted', LM + 10, recY, { width: 130 });
      doc.fontSize(8.5).font('Helvetica').fillColor(DARK).text(fmtDateTime(fault.operativeSubmittedAt), LM + 142, recY, { width: PW - 152 });
      recY += 14;
    }
    if (fault.completedAt) {
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(LIGHT).text('Approved', LM + 10, recY, { width: 130 });
      doc.fontSize(8.5).font('Helvetica').fillColor(DARK).text(fmtDateTime(fault.completedAt), LM + 142, recY, { width: PW - 152 });
    }
    doc.y = boxY + 68;
  }

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

    // Right: page number + date + branding
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
