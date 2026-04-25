import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { Fault, FaultPhoto, User, WorkDay, PunchEvent } from '@prisma/client';
import { uploadFile, getFile } from '../shared/services/storage.service';

type WorkDayWithRelations = WorkDay & { events: PunchEvent[]; photos: FaultPhoto[] };

type FaultWithRelations = Fault & {
  admin: Pick<User, 'id' | 'name' | 'email' | 'avatarUrl' | 'companyName' | 'companyAddress' | 'companyWebsite' | 'companyPhone' | 'companyEmail' | 'companyAbn' | 'logoUrl'>;
  assignedOperative: Pick<User, 'name'> | null;
  photos: FaultPhoto[];
  workDays: WorkDayWithRelations[];
};

// ── Colours ──
const NAVY     = '#1C2B41';
const BLUE     = '#0C66E4';
const DARK     = '#1A1A1A';
const MED      = '#4A4A4A';
const LIGHT    = '#888888';
const RULE     = '#CCCCCC';
const BG_LIGHT = '#F5F7FA';
const BG_ALT   = '#F0F4FF';
const GREEN    = '#16A34A';
const RED      = '#DC2626';
const WHITE    = '#FFFFFF';

const FALLBACK_LOGO = path.join(process.cwd(), 'assets', 'logo.png');

// ── Formatting helpers ──

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return (typeof d === 'string' ? new Date(d) : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return (typeof d === 'string' ? new Date(d) : d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
    // Try R2 key extraction
    const m = url.match(/(?:uploads|logos|avatars)\/(.+)$/);
    if (m) return await getFile(m[0]);
    // Try raw key
    return await getFile(url);
  } catch { /* skip */ }
  return null;
}

export async function generateFaultPdf(fault: FaultWithRelations): Promise<string> {
  const LM = 50;
  const RM = 50;
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 50, bottom: 80, left: LM, right: RM },
    bufferPages: true,
    info: {
      Title: `Site Report — ${fault.projectRef}`,
      Author: fault.admin.companyName || 'Infrava',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const PW = doc.page.width - LM - RM; // printable width

  const company = {
    name:    fault.admin.companyName || 'Infrava',
    address: fault.admin.companyAddress || '',
    website: fault.admin.companyWebsite || '',
    phone:   fault.admin.companyPhone || '',
    email:   fault.admin.companyEmail || fault.admin.email,
    abn:     fault.admin.companyAbn || '',
  };

  // Load Infrava logo (always fixed)
  let infravaLogoBuf: Buffer | null = null;
  try {
    if (fs.existsSync(FALLBACK_LOGO)) {
      infravaLogoBuf = fs.readFileSync(FALLBACK_LOGO);
    }
  } catch { /* skip */ }

  // Load admin's company logo (optional)
  let companyLogoBuf: Buffer | null = null;
  if (fault.admin.logoUrl) {
    companyLogoBuf = await loadImage(fault.admin.logoUrl);
  }

  // ── Layout helpers ──

  function ensureSpace(h: number) {
    if (doc.y + h > doc.page.height - 90) { doc.addPage(); doc.y = 50; }
  }

  function sectionBar(title: string) {
    ensureSpace(34);
    if (doc.y > 60) doc.moveDown(0.6);
    const y = doc.y;
    doc.rect(LM, y, PW, 26).fill(NAVY);
    doc.fontSize(11).font('Helvetica-Bold').fillColor(WHITE).text(title.toUpperCase(), LM + 12, y + 7, { width: PW - 24 });
    doc.y = y + 30;
  }

  function subHead(title: string) {
    ensureSpace(24);
    doc.moveDown(0.3);
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
    ensureSpace(18);
    doc.fontSize(9).font('Helvetica').fillColor(DARK).text(text, LM + 6, doc.y, { width: PW - 12, lineGap: 2.5 });
  }

  function tHead(cols: { label: string; w: number }[]) {
    ensureSpace(22);
    const y = doc.y;
    doc.rect(LM, y, PW, 20).fill(NAVY);
    let x = LM;
    for (const c of cols) {
      doc.fontSize(8).font('Helvetica-Bold').fillColor(WHITE).text(c.label, x + 6, y + 5, { width: c.w - 12 });
      x += c.w;
    }
    doc.y = y + 20;
  }

  function tRow(cols: { val: string; w: number }[], alt: boolean) {
    ensureSpace(18);
    const y = doc.y;
    if (alt) doc.rect(LM, y, PW, 18).fill(BG_ALT);
    doc.moveTo(LM, y + 18).lineTo(LM + PW, y + 18).lineWidth(0.3).strokeColor(RULE).stroke();
    let x = LM;
    for (const c of cols) {
      doc.fontSize(8).font('Helvetica').fillColor(DARK).text(c.val, x + 6, y + 4, { width: c.w - 12 });
      x += c.w;
    }
    doc.y = y + 18;
  }

  function divider() {
    doc.moveDown(0.3);
    doc.moveTo(LM, doc.y).lineTo(LM + PW, doc.y).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.moveDown(0.3);
  }

  // ════════════════════════════════════════════════════════════
  // PAGE HEADER — Infrava logo (left) + Company branding (right)
  // ════════════════════════════════════════════════════════════

  // Top accent bar
  doc.rect(0, 0, doc.page.width, 5).fill(NAVY);

  const headerTop = 20;

  // Infrava logo — always fixed, left side
  if (infravaLogoBuf) {
    try { doc.image(infravaLogoBuf, LM, headerTop, { height: 36 }); } catch { /* skip */ }
  } else {
    // Text fallback
    doc.roundedRect(LM, headerTop, 36, 36, 4).fill(NAVY);
    doc.fontSize(18).font('Helvetica-Bold').fillColor(WHITE).text('I', LM + 11, headerTop + 8);
  }

  // Company logo + details — right side
  const rightW = PW * 0.55;
  const rightX = LM + PW - rightW;
  let rightY = headerTop;

  if (companyLogoBuf) {
    try {
      // Place company logo right-aligned
      doc.image(companyLogoBuf, LM + PW - 60, headerTop, { height: 36 });
      // Company name to the left of logo
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

  // Company contact lines
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

  // Title bar below header
  const titleBarY = Math.max(headerTop + 44, rightY + 6);
  doc.rect(LM, titleBarY, PW, 28).fill(NAVY);
  doc.fontSize(13).font('Helvetica-Bold').fillColor(WHITE).text('SITE VISIT REPORT', LM + 14, titleBarY + 7, { width: PW * 0.6 });
  doc.fontSize(9).font('Helvetica').fillColor('#A0B4CF').text(
    `${fault.projectRef}  |  ${fmtDate(fault.faultDate)}`,
    LM + 14, titleBarY + 8, { width: PW - 28, align: 'right' }
  );

  doc.y = titleBarY + 36;

  // ════════════════════════════════════════════════════════════
  // JOB / PROPERTY DETAILS
  // ════════════════════════════════════════════════════════════

  sectionBar('Job Details');
  kvTwo('Project Ref', fault.projectRef, 'Client Ref', fault.clientRef || '—');
  kvTwo('Fault Date', fmtDate(fault.faultDate), 'Priority', fault.priority || '—');
  kvTwo('Work Type', fault.workType || '—', 'Status', fault.status.replace(/_/g, ' '));
  if (fault.title) kv('Title', fault.title);
  if (fault.locationText) kv('Location', fault.locationText);

  // Scheduling
  if (fault.timeAllocated || fault.plannedArrival || fault.plannedCompletion) {
    subHead('Scheduling');
    if (fault.timeAllocated) kv('Time Allocated', fmtDateTime(fault.timeAllocated));
    if (fault.plannedArrival) kv('Planned Arrival', fmtDateTime(fault.plannedArrival));
    if (fault.plannedCompletion) kv('Planned Completion', fmtDateTime(fault.plannedCompletion));
  }

  // ════════════════════════════════════════════════════════════
  // SCOPE OF WORKS
  // ════════════════════════════════════════════════════════════

  if (fault.description) {
    sectionBar('Scope of Works');
    para(fault.description);
  }

  // ════════════════════════════════════════════════════════════
  // OPERATIVE / CONTRACTOR
  // ════════════════════════════════════════════════════════════

  sectionBar('Personnel');
  kvTwo('Operative', fault.assignedOperative?.name || '—', 'Admin', fault.admin.name);
  if (fault.contractorCompany || fault.contractorName) {
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

  if (fault.onsiteContactName || fault.onsiteContactPhone || fault.onsiteContactEmail) {
    sectionBar('Onsite Contact');
    if (fault.onsiteContactName) kv('Name', fault.onsiteContactName);
    if (fault.onsiteContactPhone) kv('Phone', fault.onsiteContactPhone);
    if (fault.onsiteContactEmail) kv('Email', fault.onsiteContactEmail);
  }

  // ════════════════════════════════════════════════════════════
  // VISIT REQUIREMENTS
  // ════════════════════════════════════════════════════════════

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
    ensureSpace(17);
    const y = doc.y;
    if (Math.floor(i / 2) % 2 === 0) doc.rect(LM, y, PW, 16).fill(BG_LIGHT);
    for (let c = 0; c < 2 && i + c < reqs.length; c++) {
      const [label, on] = reqs[i + c];
      const x = LM + c * half + 10;
      const marker = on ? '\u2713' : '\u2717';
      doc.fontSize(9).font('Helvetica-Bold').fillColor(on ? GREEN : RED).text(marker, x, y + 3);
      doc.fontSize(9).font('Helvetica').fillColor(DARK).text(label, x + 14, y + 3);
    }
    doc.y = y + 16;
  }

  // ════════════════════════════════════════════════════════════
  // DAILY WORK REPORTS
  // ════════════════════════════════════════════════════════════

  for (const day of fault.workDays) {
    sectionBar(`Day ${day.dayNumber} Report${day.isLocked ? '  \u2014  Completed' : ''}`);

    // Attendance / GPS Events
    if (day.events.length > 0) {
      subHead('Attendance & GPS Tracking');
      const cols = [
        { label: 'Event', w: PW * 0.24 }, { label: 'Time', w: PW * 0.14 },
        { label: 'Latitude', w: PW * 0.18 }, { label: 'Longitude', w: PW * 0.18 },
        { label: 'Elapsed / Distance', w: PW * 0.26 },
      ];
      tHead(cols);
      for (let i = 0; i < day.events.length; i++) {
        const e = day.events[i];
        let info = '';
        if (i > 0) {
          const p = day.events[i - 1];
          info = `${elapsed(p.timestamp, e.timestamp)}  /  ${haversine(p.lat, p.lng, e.lat, e.lng).toFixed(1)} mi`;
        }
        tRow([
          { val: e.eventType.replace(/_/g, ' '), w: PW * 0.24 },
          { val: fmtTime(e.timestamp), w: PW * 0.14 },
          { val: e.lat.toFixed(6), w: PW * 0.18 },
          { val: e.lng.toFixed(6), w: PW * 0.18 },
          { val: info, w: PW * 0.26 },
        ], i % 2 === 1);
      }
    }

    // Personnel
    if (day.supervisorNames || day.tradespersonNames || day.operativeName) {
      subHead('Personnel on Site');
      if (day.supervisorNames) kv('Supervisor(s)', day.supervisorNames);
      if (day.tradespersonNames) kv('Tradesperson(s)', day.tradespersonNames);
      if (day.operativeName) kv('Operative', day.operativeName);
    }

    // Methodology
    if (day.methodology) { subHead('Methodology'); para(day.methodology); }

    // Works Description
    if (day.worksDescription) { subHead('Works Description'); para(day.worksDescription); }

    // Temp Works
    const tw = day.tempWorks as { item: string; qty: number; unit?: string }[] | null;
    if (tw && Array.isArray(tw) && tw.some(r => r.item)) {
      subHead('Temp Works');
      const cols = [{ label: 'Item', w: PW * 0.5 }, { label: 'Qty', w: PW * 0.25 }, { label: 'Unit', w: PW * 0.25 }];
      tHead(cols);
      tw.forEach((r, i) => { if (r.item) tRow([{ val: r.item, w: PW * 0.5 }, { val: String(r.qty), w: PW * 0.25 }, { val: r.unit || '', w: PW * 0.25 }], i % 2 === 1); });
    }

    // Materials Used
    const mats = day.materialsUsed as { item: string; qty: number; unit?: string }[] | null;
    if (mats && Array.isArray(mats) && mats.some(r => r.item)) {
      subHead('Materials Used');
      const cols = [{ label: 'Item', w: PW * 0.5 }, { label: 'Qty', w: PW * 0.25 }, { label: 'Unit', w: PW * 0.25 }];
      tHead(cols);
      mats.forEach((r, i) => { if (r.item) tRow([{ val: r.item, w: PW * 0.5 }, { val: String(r.qty), w: PW * 0.25 }, { val: r.unit || '', w: PW * 0.25 }], i % 2 === 1); });
    }

    // Dimensions
    const dims = day.dimensions as { activity: string; qty: number; unit?: string }[] | null;
    if (dims && Array.isArray(dims) && dims.some(r => r.activity)) {
      subHead('Dimensions / Quantities');
      const cols = [{ label: 'Activity', w: PW * 0.5 }, { label: 'Qty', w: PW * 0.25 }, { label: 'Unit', w: PW * 0.25 }];
      tHead(cols);
      dims.forEach((r, i) => { if (r.activity) tRow([{ val: r.activity, w: PW * 0.5 }, { val: String(r.qty), w: PW * 0.25 }, { val: r.unit || '', w: PW * 0.25 }], i % 2 === 1); });
    }

    // Further Work
    if (day.furtherWork) {
      subHead('Further Work Required');
      if (day.furtherWorkNotes) para(day.furtherWorkNotes);
      else para('Yes — no additional notes provided.');
    }

    // Day Photos
    if (day.photos.length > 0) {
      subHead(`Photos (${day.photos.length})`);
      for (const p of day.photos) kv(`[${p.photoStage.toUpperCase()}]`, p.fileName || p.r2Key);
    }
  }

  // ════════════════════════════════════════════════════════════
  // ADDITIONAL PHOTOS (not linked to a work day)
  // ════════════════════════════════════════════════════════════

  const extraPhotos = fault.photos.filter(p => !p.workDayId);
  if (extraPhotos.length > 0) {
    sectionBar('Additional Photos');
    for (const p of extraPhotos) kv(`[${p.photoStage.toUpperCase()}]`, p.fileName || p.r2Key);
  }

  // ════════════════════════════════════════════════════════════
  // PAGE FOOTERS — Company branding + page numbers
  // ════════════════════════════════════════════════════════════

  const now = fmtDateTime(new Date());
  const pages = doc.bufferedPageRange().count;

  for (let i = 0; i < pages; i++) {
    doc.switchToPage(i);

    // Top accent bar on all pages after first
    if (i > 0) doc.rect(0, 0, doc.page.width, 5).fill(NAVY);

    const fy = doc.page.height - 58;

    // Separator line
    doc.moveTo(LM, fy).lineTo(LM + PW, fy).lineWidth(0.5).strokeColor(NAVY).stroke();

    // Left column: company details
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

    // Right column: page number, date, Powered by Infrava
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
  const buffer = await new Promise<Buffer>((resolve) => { doc.on('end', () => resolve(Buffer.concat(chunks))); });
  const r2Key = `reports/${fault.adminId}/${fault.projectRef}.pdf`;
  await uploadFile(r2Key, buffer);
  return r2Key;
}
