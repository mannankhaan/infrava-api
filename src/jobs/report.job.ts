import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { Fault, FaultPhoto, User, WorkDay, PunchEvent } from '@prisma/client';
import { uploadFile, getFile } from '../shared/services/storage.service';

type WorkDayWithRelations = WorkDay & { events: PunchEvent[]; photos: FaultPhoto[] };

type FaultWithRelations = Fault & {
  admin: Pick<User, 'id' | 'name' | 'email' | 'avatarUrl'>;
  assignedOperative: Pick<User, 'name'> | null;
  photos: FaultPhoto[];
  workDays: WorkDayWithRelations[];
};

// Brand palette
const NAVY = '#1C2B41';
const BLUE = '#0C66E4';
const BLUE_DARK = '#0A52B4';
const GRAY_DARK = '#1A1A1A';
const GRAY_MED = '#4A4A4A';
const GRAY_LIGHT = '#888888';
const GRAY_RULE = '#CCCCCC';
const BG_LIGHT = '#F5F7FA';
const BG_TABLE_ALT = '#F0F4FF';
const GREEN = '#16A34A';
const RED = '#DC2626';
const WHITE = '#FFFFFF';

const LOGO_PATH = path.join(process.cwd(), 'assets', 'logo.png');

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function elapsed(t1: Date | string, t2: Date | string): string {
  const ms = new Date(t2).getTime() - new Date(t1).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

async function loadAvatar(avatarUrl: string | null | undefined): Promise<Buffer | null> {
  if (!avatarUrl) return null;
  try {
    const match = avatarUrl.match(/uploads\/(.+)$/);
    if (match) return await getFile(match[1]);
  } catch { /* skip */ }
  return null;
}

export async function generateFaultPdf(fault: FaultWithRelations): Promise<string> {
  const LM = 50;            // left margin
  const RM = 50;            // right margin
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 50, bottom: 60, left: LM, right: RM },
    bufferPages: true,
    info: {
      Title: `Infrava Report — ${fault.clientRef}`,
      Author: 'Infrava Private Limited',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  const PW = doc.page.width - LM - RM; // usable page width

  /* ================================================================
     DRAWING PRIMITIVES
     ================================================================ */

  function ensureSpace(h: number) {
    if (doc.y + h > doc.page.height - 80) {
      doc.addPage();
      doc.y = 50;
    }
  }

  /** Bold navy bar with white text — primary section divider */
  function sectionBar(title: string) {
    ensureSpace(40);
    doc.moveDown(0.8);
    const y = doc.y;
    doc.rect(LM, y, PW, 26).fill(NAVY);
    doc.fontSize(12).font('Helvetica-Bold').fillColor(WHITE)
      .text(title.toUpperCase(), LM + 12, y + 7, { width: PW - 24 });
    doc.y = y + 32;
  }

  /** Lighter sub-header inside a section */
  function subHeader(title: string) {
    ensureSpace(28);
    doc.moveDown(0.4);
    const y = doc.y;
    doc.rect(LM, y, PW, 22).fill(BG_LIGHT);
    doc.moveTo(LM, y).lineTo(LM, y + 22).lineWidth(3).strokeColor(BLUE).stroke();
    doc.fontSize(11).font('Helvetica-Bold').fillColor(NAVY)
      .text(title, LM + 10, y + 5, { width: PW - 20 });
    doc.y = y + 26;
  }

  /** Key–value row with bold label, consistent alignment */
  function kvRow(label: string, value: string, x = LM, labelW = 140) {
    ensureSpace(18);
    const y = doc.y;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(GRAY_MED)
      .text(label, x + 6, y, { width: labelW });
    doc.fontSize(10).font('Helvetica').fillColor(GRAY_DARK)
      .text(value || '—', x + 6 + labelW, y, { width: PW - labelW - 12 });
    doc.y = y + 17;
  }

  /** Wrapped body text */
  function bodyText(text: string) {
    ensureSpace(20);
    doc.fontSize(10).font('Helvetica').fillColor(GRAY_DARK)
      .text(text, LM + 8, doc.y, { width: PW - 16, lineGap: 3 });
    doc.moveDown(0.2);
  }

  /** Table header bar */
  function tHead(cols: { label: string; w: number }[]) {
    ensureSpace(26);
    const y = doc.y;
    doc.rect(LM, y, PW, 24).fill(BLUE_DARK);
    let x = LM;
    for (const c of cols) {
      doc.fontSize(9).font('Helvetica-Bold').fillColor(WHITE)
        .text(c.label, x + 8, y + 7, { width: c.w - 16 });
      x += c.w;
    }
    doc.y = y + 24;
  }

  /** Table data row */
  function tRow(cols: { val: string; w: number }[], alt: boolean) {
    ensureSpace(22);
    const y = doc.y;
    if (alt) doc.rect(LM, y, PW, 22).fill(BG_TABLE_ALT);
    // Bottom border
    doc.moveTo(LM, y + 22).lineTo(LM + PW, y + 22).lineWidth(0.5).strokeColor(GRAY_RULE).stroke();
    let x = LM;
    for (const c of cols) {
      doc.fontSize(9).font('Helvetica').fillColor(GRAY_DARK)
        .text(c.val, x + 8, y + 6, { width: c.w - 16 });
      x += c.w;
    }
    doc.y = y + 22;
  }

  /** Bordered info box with light background */
  function infoBox(fn: () => void) {
    ensureSpace(40);
    const startY = doc.y;
    // Draw content first to measure height
    doc.save();
    doc.y = startY + 10;
    const savedX = LM + 10;
    doc.x = savedX;
    fn();
    const endY = doc.y + 10;
    const boxH = endY - startY;
    doc.restore();
    // Draw box background + border
    doc.rect(LM, startY, PW, boxH).fill(BG_LIGHT);
    doc.rect(LM, startY, PW, boxH).lineWidth(1).strokeColor(GRAY_RULE).stroke();
    // Re-draw content on top
    doc.y = startY + 10;
    fn();
    doc.y = endY + 4;
  }

  /* ================================================================
     COVER PAGE
     ================================================================ */

  // Top navy stripe
  doc.rect(0, 0, doc.page.width, 6).fill(NAVY);

  // Logo (or placeholder)
  try {
    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, LM, 40, { height: 44 });
    } else {
      // Branded placeholder: navy rounded rect with white "I" initial
      doc.roundedRect(LM, 40, 44, 44, 6).fill(NAVY);
      doc.fontSize(22).font('Helvetica-Bold').fillColor(WHITE).text('I', LM + 15, 50);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(NAVY).text('INFRAVA', LM + 48, 55);
    }
  } catch {
    // Fallback placeholder if anything fails
    doc.roundedRect(LM, 40, 44, 44, 6).fill(NAVY);
    doc.fontSize(22).font('Helvetica-Bold').fillColor(WHITE).text('I', LM + 15, 50);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(NAVY).text('INFRAVA', LM + 48, 55);
  }

  // Admin avatar
  const avatar = await loadAvatar(fault.admin.avatarUrl);
  if (avatar) {
    try {
      doc.image(avatar, doc.page.width - RM - 44, 40, { height: 44, width: 44 });
    } catch { /* skip */ }
  }

  // Report title
  doc.y = 110;
  doc.fontSize(28).font('Helvetica-Bold').fillColor(NAVY)
    .text('FAULT ASSIGNMENT', LM, doc.y, { align: 'center' });
  doc.fontSize(28).font('Helvetica-Bold').fillColor(BLUE)
    .text('REPORT', { align: 'center' });
  doc.moveDown(0.6);

  // Accent line
  const lineY = doc.y;
  const accentW = 80;
  const accentX = (doc.page.width - accentW) / 2;
  doc.moveTo(accentX, lineY).lineTo(accentX + accentW, lineY).lineWidth(3).strokeColor(BLUE).stroke();
  doc.moveDown(1);

  // Cover info box
  infoBox(() => {
    const bx = LM + 14;
    const bLabelW = 130;
    const bValX = bx + bLabelW;
    const bValW = PW - bLabelW - 28;

    const rows: [string, string][] = [
      ['Client Reference', fault.clientRef],
      ['Company Reference', fault.companyRef || '—'],
      ['Title', fault.title || '—'],
      ['Fault Date', fmtDate(fault.faultDate)],
      ['Status', fault.status.replace(/_/g, ' ')],
      ['Operative', fault.assignedOperative?.name || '—'],
      ['Prepared By', fault.admin.name],
    ];

    for (const [label, value] of rows) {
      const ry = doc.y;
      doc.fontSize(11).font('Helvetica-Bold').fillColor(NAVY).text(label, bx, ry, { width: bLabelW });
      doc.fontSize(11).font('Helvetica').fillColor(GRAY_DARK).text(value, bValX, ry, { width: bValW });
      doc.y = ry + 22;
    }
  });

  doc.moveDown(1.5);

  // Cover footer text
  doc.fontSize(10).font('Helvetica').fillColor(GRAY_LIGHT)
    .text('This document is confidential and intended for authorised personnel only.', LM, doc.y, { align: 'center', width: PW });
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica-Bold').fillColor(NAVY)
    .text('Infrava Private Limited', { align: 'center', width: PW });

  // Bottom navy stripe on cover
  doc.rect(0, doc.page.height - 6, doc.page.width, 6).fill(NAVY);

  /* ================================================================
     CONTENT PAGES
     ================================================================ */

  doc.addPage();

  // ─── FAULT DETAILS ───

  sectionBar('Fault Details');

  const half = PW / 2;
  const pairs: [string, string, string, string][] = [
    ['Client Ref', fault.clientRef, 'Operative', fault.assignedOperative?.name || '—'],
    ['Company Ref', fault.companyRef || '—', 'Priority', fault.priority || '—'],
    ['Fault Date', fmtDate(fault.faultDate), 'Work Type', fault.workType || '—'],
    ['Status', fault.status.replace(/_/g, ' '), 'Location', fault.locationText || '—'],
  ];

  for (const [l1, v1, l2, v2] of pairs) {
    ensureSpace(20);
    const y = doc.y;
    // Left
    doc.fontSize(10).font('Helvetica-Bold').fillColor(GRAY_MED).text(l1, LM + 6, y, { width: 100 });
    doc.fontSize(10).font('Helvetica').fillColor(GRAY_DARK).text(v1, LM + 110, y, { width: half - 120 });
    // Right
    doc.fontSize(10).font('Helvetica-Bold').fillColor(GRAY_MED).text(l2, LM + half + 6, y, { width: 100 });
    doc.fontSize(10).font('Helvetica').fillColor(GRAY_DARK).text(v2, LM + half + 110, y, { width: half - 120 });
    doc.y = y + 20;
  }

  // Light rule after summary grid
  doc.moveDown(0.2);
  doc.moveTo(LM, doc.y).lineTo(LM + PW, doc.y).lineWidth(0.5).strokeColor(GRAY_RULE).stroke();
  doc.moveDown(0.4);

  if (fault.description) {
    kvRow('Description', '');
    bodyText(fault.description);
  }
  if (fault.timeAllocated) kvRow('Time Allocated', fmtDateTime(fault.timeAllocated));
  if (fault.plannedArrival) kvRow('Planned Arrival', fmtDateTime(fault.plannedArrival));
  if (fault.plannedCompletion) kvRow('Planned Completion', fmtDateTime(fault.plannedCompletion));

  // ─── ONSITE CONTACT ───

  if (fault.onsiteContactName || fault.onsiteContactPhone || fault.onsiteContactEmail) {
    sectionBar('Onsite Contact');
    if (fault.onsiteContactName) kvRow('Name', fault.onsiteContactName);
    if (fault.onsiteContactPhone) kvRow('Phone', fault.onsiteContactPhone);
    if (fault.onsiteContactEmail) kvRow('Email', fault.onsiteContactEmail);
  }

  // ─── VISIT REQUIREMENTS ───

  sectionBar('Visit Requirements');

  const reqs: [string, boolean][] = [
    ['Task Briefing', fault.visitTaskBriefing],
    ['LSR', fault.visitLsr],
    ['Link Block', fault.visitLinkBlock],
    ['Safe Work Pack', fault.visitSafeWorkPack],
    ['Possession', fault.visitPossession],
    ['Temp Works', fault.visitTempWorks],
    ['Isolation', fault.visitIsolation],
    ['Track Access', fault.visitTrackAccess],
    ['Temp Works Required', fault.visitTempWorksRequired],
    ['Working at Height', fault.visitWorkingAtHeight],
  ];

  for (let i = 0; i < reqs.length; i += 2) {
    ensureSpace(22);
    const y = doc.y;
    // Alternating row background
    if (Math.floor(i / 2) % 2 === 0) {
      doc.rect(LM, y, PW, 20).fill(BG_LIGHT);
    }
    for (let col = 0; col < 2; col++) {
      const idx = i + col;
      if (idx >= reqs.length) break;
      const [label, checked] = reqs[idx];
      const x = LM + col * half + 12;
      const icon = checked ? '\u2713  ' : '\u2717  ';
      const color = checked ? GREEN : RED;
      doc.fontSize(10).font('Helvetica-Bold').fillColor(color).text(icon, x, y + 4, { continued: true });
      doc.fontSize(10).font('Helvetica').fillColor(GRAY_DARK).text(label);
    }
    doc.y = y + 20;
  }

  // ─── CONTRACTOR ───

  if (fault.contractorCompany || fault.contractorName) {
    sectionBar('Contractor Details');
    if (fault.contractorCompany) kvRow('Company', fault.contractorCompany);
    if (fault.contractorName) kvRow('Name', fault.contractorName);
    if (fault.contractorEmail) kvRow('Email', fault.contractorEmail);
    if (fault.contractorMobile) kvRow('Mobile', fault.contractorMobile);
  }

  // ─── DAILY REPORTS ───

  for (const day of fault.workDays) {
    sectionBar(`Day ${day.dayNumber}${day.isLocked ? '  —  Locked' : ''}`);

    // Attendance
    if (day.events.length > 0) {
      subHeader('Attendance');
      const cols = [
        { label: 'Event', w: PW * 0.25 },
        { label: 'Time', w: PW * 0.15 },
        { label: 'Latitude', w: PW * 0.2 },
        { label: 'Longitude', w: PW * 0.2 },
        { label: 'Elapsed / Dist', w: PW * 0.2 },
      ];
      tHead(cols);
      for (let i = 0; i < day.events.length; i++) {
        const evt = day.events[i];
        let info = '';
        if (i > 0) {
          const prev = day.events[i - 1];
          info = `${elapsed(prev.timestamp, evt.timestamp)}  /  ${haversine(prev.lat, prev.lng, evt.lat, evt.lng).toFixed(1)} mi`;
        }
        tRow([
          { val: evt.eventType.replace(/_/g, ' '), w: PW * 0.25 },
          { val: fmtTime(evt.timestamp), w: PW * 0.15 },
          { val: evt.lat.toFixed(6), w: PW * 0.2 },
          { val: evt.lng.toFixed(6), w: PW * 0.2 },
          { val: info, w: PW * 0.2 },
        ], i % 2 === 1);
      }
      doc.moveDown(0.3);
    }

    // Personnel
    if (day.supervisorNames || day.tradespersonNames || day.operativeName) {
      subHeader('Personnel');
      if (day.supervisorNames) kvRow('Supervisor(s)', day.supervisorNames);
      if (day.tradespersonNames) kvRow('Tradesperson(s)', day.tradespersonNames);
      if (day.operativeName) kvRow('Operative', day.operativeName);
    }

    // Temp Works
    const tw = day.tempWorks as { item: string; qty: number; unit?: string }[] | null;
    if (tw && Array.isArray(tw) && tw.length > 0) {
      subHeader('Temp Works');
      const cols = [
        { label: 'Item', w: PW * 0.5 },
        { label: 'Qty', w: PW * 0.25 },
        { label: 'Unit', w: PW * 0.25 },
      ];
      tHead(cols);
      tw.forEach((r, i) => {
        if (r.item) tRow([
          { val: r.item, w: PW * 0.5 },
          { val: String(r.qty), w: PW * 0.25 },
          { val: r.unit || '', w: PW * 0.25 },
        ], i % 2 === 1);
      });
      doc.moveDown(0.3);
    }

    // Materials
    const mats = day.materialsUsed as { item: string; qty: number; unit?: string }[] | null;
    if (mats && Array.isArray(mats) && mats.length > 0) {
      subHeader('Materials Used');
      const cols = [
        { label: 'Item', w: PW * 0.5 },
        { label: 'Qty', w: PW * 0.25 },
        { label: 'Unit', w: PW * 0.25 },
      ];
      tHead(cols);
      mats.forEach((r, i) => {
        if (r.item) tRow([
          { val: r.item, w: PW * 0.5 },
          { val: String(r.qty), w: PW * 0.25 },
          { val: r.unit || '', w: PW * 0.25 },
        ], i % 2 === 1);
      });
      doc.moveDown(0.3);
    }

    // Methodology
    if (day.methodology) {
      subHeader('Methodology');
      bodyText(day.methodology);
    }

    // Works Description
    if (day.worksDescription) {
      subHeader('Works Description');
      bodyText(day.worksDescription);
    }

    // Dimensions
    const dims = day.dimensions as { activity: string; qty: number; unit?: string }[] | null;
    if (dims && Array.isArray(dims) && dims.length > 0) {
      subHeader('Dimensions');
      const cols = [
        { label: 'Activity', w: PW * 0.5 },
        { label: 'Qty', w: PW * 0.25 },
        { label: 'Unit', w: PW * 0.25 },
      ];
      tHead(cols);
      dims.forEach((r, i) => {
        if (r.activity) tRow([
          { val: r.activity, w: PW * 0.5 },
          { val: String(r.qty), w: PW * 0.25 },
          { val: r.unit || '', w: PW * 0.25 },
        ], i % 2 === 1);
      });
      doc.moveDown(0.3);
    }

    // Further Work
    if (day.furtherWork) {
      subHeader('Further Work Required');
      if (day.furtherWorkNotes) bodyText(day.furtherWorkNotes);
    }

    // Photos
    if (day.photos.length > 0) {
      subHeader(`Photos (${day.photos.length})`);
      for (const photo of day.photos) {
        kvRow(`[${photo.photoStage.toUpperCase()}]`, photo.fileName || photo.r2Key);
      }
    }
  }

  // ─── ADDITIONAL PHOTOS ───

  const extra = fault.photos.filter((p) => !p.workDayId);
  if (extra.length > 0) {
    sectionBar('Additional Photos');
    for (const photo of extra) {
      kvRow(`[${photo.photoStage.toUpperCase()}]`, photo.fileName || photo.r2Key);
    }
  }

  /* ================================================================
     PAGE FOOTERS — rendered on every page after content is done
     ================================================================ */

  const now = fmtDateTime(new Date());
  const pages = doc.bufferedPageRange().count;

  for (let i = 0; i < pages; i++) {
    doc.switchToPage(i);

    // Top accent stripe (skip cover page — it already has one)
    if (i > 0) {
      doc.rect(0, 0, doc.page.width, 4).fill(NAVY);
    }

    // Footer
    const fy = doc.page.height - 40;
    doc.moveTo(LM, fy).lineTo(LM + PW, fy).lineWidth(0.75).strokeColor(NAVY).stroke();

    doc.fontSize(8).font('Helvetica-Bold').fillColor(NAVY)
      .text('Infrava Private Limited', LM, fy + 8, { width: PW / 3, align: 'left' });
    doc.fontSize(8).font('Helvetica').fillColor(GRAY_LIGHT)
      .text(`Generated: ${now}`, LM + PW / 3, fy + 8, { width: PW / 3, align: 'center' });
    doc.fontSize(8).font('Helvetica').fillColor(GRAY_LIGHT)
      .text(`Page ${i + 1} of ${pages}`, LM + (PW * 2) / 3, fy + 8, { width: PW / 3, align: 'right' });
  }

  // Finalize
  doc.end();

  const buffer = await new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const r2Key = `reports/${fault.adminId}/${fault.clientRef}.pdf`;
  await uploadFile(r2Key, buffer);

  return r2Key;
}
