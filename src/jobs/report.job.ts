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

const NAVY = '#1C2B41';
const BLUE = '#0C66E4';
const GRAY_DARK = '#1A1A1A';
const GRAY_MED = '#4A4A4A';
const GRAY_LIGHT = '#888888';
const GRAY_RULE = '#CCCCCC';
const BG_LIGHT = '#F5F7FA';
const BG_ALT = '#F0F4FF';
const GREEN = '#16A34A';
const RED = '#DC2626';
const WHITE = '#FFFFFF';

const LOGO_PATH = path.join(process.cwd(), 'assets', 'logo.png');

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

async function loadAvatar(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const m = url.match(/uploads\/(.+)$/);
    if (m) return await getFile(m[1]);
  } catch { /* skip */ }
  return null;
}

export async function generateFaultPdf(fault: FaultWithRelations): Promise<string> {
  const LM = 50;
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 50, bottom: 60, left: LM, right: 50 },
    bufferPages: true,
    info: { Title: `Infrava Report — ${fault.clientRef}`, Author: 'Infrava Private Limited' },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const PW = doc.page.width - 100;

  // ── Helpers ──

  function space(h: number) {
    if (doc.y + h > doc.page.height - 70) { doc.addPage(); doc.y = 50; }
  }

  function sectionBar(title: string) {
    space(34);
    if (doc.y > 60) doc.moveDown(0.5);
    const y = doc.y;
    doc.rect(LM, y, PW, 24).fill(NAVY);
    doc.fontSize(11).font('Helvetica-Bold').fillColor(WHITE).text(title.toUpperCase(), LM + 10, y + 6, { width: PW - 20 });
    doc.y = y + 28;
  }

  function subHead(title: string) {
    space(22);
    doc.moveDown(0.2);
    const y = doc.y;
    doc.moveTo(LM, y).lineTo(LM + 3, y).lineTo(LM + 3, y + 16).lineTo(LM, y + 16).fill(BLUE);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(NAVY).text(title, LM + 8, y + 2);
    doc.y = y + 20;
  }

  function kv(label: string, value: string) {
    space(16);
    const y = doc.y;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(GRAY_MED).text(label, LM + 4, y, { width: 120 });
    doc.fontSize(9).font('Helvetica').fillColor(GRAY_DARK).text(value || '—', LM + 128, y, { width: PW - 132 });
    doc.y = Math.max(doc.y, y + 14);
  }

  function kvTwo(l1: string, v1: string, l2: string, v2: string) {
    space(16);
    const y = doc.y;
    const half = PW / 2;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(GRAY_MED).text(l1, LM + 4, y, { width: 90 });
    doc.fontSize(9).font('Helvetica').fillColor(GRAY_DARK).text(v1 || '—', LM + 96, y, { width: half - 100 });
    doc.fontSize(9).font('Helvetica-Bold').fillColor(GRAY_MED).text(l2, LM + half + 4, y, { width: 90 });
    doc.fontSize(9).font('Helvetica').fillColor(GRAY_DARK).text(v2 || '—', LM + half + 96, y, { width: half - 100 });
    doc.y = y + 15;
  }

  function para(text: string) {
    space(16);
    doc.fontSize(9).font('Helvetica').fillColor(GRAY_DARK).text(text, LM + 4, doc.y, { width: PW - 8, lineGap: 2 });
  }

  function tHead(cols: { label: string; w: number }[]) {
    space(20);
    const y = doc.y;
    doc.rect(LM, y, PW, 18).fill(NAVY);
    let x = LM;
    for (const c of cols) {
      doc.fontSize(8).font('Helvetica-Bold').fillColor(WHITE).text(c.label, x + 6, y + 4, { width: c.w - 12 });
      x += c.w;
    }
    doc.y = y + 18;
  }

  function tRow(cols: { val: string; w: number }[], alt: boolean) {
    space(16);
    const y = doc.y;
    if (alt) doc.rect(LM, y, PW, 16).fill(BG_ALT);
    doc.moveTo(LM, y + 16).lineTo(LM + PW, y + 16).lineWidth(0.3).strokeColor(GRAY_RULE).stroke();
    let x = LM;
    for (const c of cols) {
      doc.fontSize(8).font('Helvetica').fillColor(GRAY_DARK).text(c.val, x + 6, y + 3, { width: c.w - 12 });
      x += c.w;
    }
    doc.y = y + 16;
  }

  // ── HEADER (compact — not a full cover page) ──

  doc.rect(0, 0, doc.page.width, 4).fill(NAVY);

  // Logo or placeholder
  try {
    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, LM, 30, { height: 32 });
    } else {
      doc.roundedRect(LM, 30, 32, 32, 4).fill(NAVY);
      doc.fontSize(16).font('Helvetica-Bold').fillColor(WHITE).text('I', LM + 10, 37);
    }
  } catch {
    doc.roundedRect(LM, 30, 32, 32, 4).fill(NAVY);
    doc.fontSize(16).font('Helvetica-Bold').fillColor(WHITE).text('I', LM + 10, 37);
  }

  // Avatar
  const avatar = await loadAvatar(fault.admin.avatarUrl);
  if (avatar) {
    try { doc.image(avatar, doc.page.width - 50 - 32, 30, { height: 32, width: 32 }); } catch { /* skip */ }
  }

  // Title line
  doc.fontSize(16).font('Helvetica-Bold').fillColor(NAVY).text('FAULT ASSIGNMENT REPORT', LM + 40, 34);
  doc.fontSize(8).font('Helvetica').fillColor(GRAY_LIGHT).text(
    `${fault.clientRef}  |  ${fmtDate(fault.faultDate)}  |  Prepared by ${fault.admin.name}`,
    LM + 40, 52
  );

  doc.y = 70;
  doc.moveTo(LM, doc.y).lineTo(LM + PW, doc.y).lineWidth(1).strokeColor(NAVY).stroke();
  doc.y = 76;

  // ── FAULT DETAILS ──

  sectionBar('Fault Details');
  kvTwo('Client Ref', fault.clientRef, 'Operative', fault.assignedOperative?.name || '—');
  kvTwo('Company Ref', fault.companyRef || '—', 'Priority', fault.priority || '—');
  kvTwo('Fault Date', fmtDate(fault.faultDate), 'Work Type', fault.workType || '—');
  kvTwo('Status', fault.status.replace(/_/g, ' '), 'Location', fault.locationText || '—');
  if (fault.title) kv('Title', fault.title);
  if (fault.description) { kv('Description', ''); para(fault.description); }
  if (fault.timeAllocated) kv('Time Allocated', fmtDateTime(fault.timeAllocated));
  if (fault.plannedArrival) kv('Planned Arrival', fmtDateTime(fault.plannedArrival));
  if (fault.plannedCompletion) kv('Planned Completion', fmtDateTime(fault.plannedCompletion));

  // ── ONSITE CONTACT ──

  if (fault.onsiteContactName || fault.onsiteContactPhone || fault.onsiteContactEmail) {
    sectionBar('Onsite Contact');
    if (fault.onsiteContactName) kv('Name', fault.onsiteContactName);
    if (fault.onsiteContactPhone) kv('Phone', fault.onsiteContactPhone);
    if (fault.onsiteContactEmail) kv('Email', fault.onsiteContactEmail);
  }

  // ── VISIT REQUIREMENTS (compact 2-col) ──

  sectionBar('Visit Requirements');
  const reqs: [string, boolean][] = [
    ['Task Briefing', fault.visitTaskBriefing], ['LSR', fault.visitLsr],
    ['Link Block', fault.visitLinkBlock], ['Safe Work Pack', fault.visitSafeWorkPack],
    ['Possession', fault.visitPossession], ['Temp Works', fault.visitTempWorks],
    ['Isolation', fault.visitIsolation], ['Track Access', fault.visitTrackAccess],
    ['Temp Works Req.', fault.visitTempWorksRequired], ['Working at Height', fault.visitWorkingAtHeight],
  ];
  const half = PW / 2;
  for (let i = 0; i < reqs.length; i += 2) {
    space(15);
    const y = doc.y;
    if (Math.floor(i / 2) % 2 === 0) doc.rect(LM, y, PW, 14).fill(BG_LIGHT);
    for (let c = 0; c < 2 && i + c < reqs.length; c++) {
      const [label, on] = reqs[i + c];
      const x = LM + c * half + 8;
      doc.fontSize(9).font('Helvetica-Bold').fillColor(on ? GREEN : RED).text(on ? '\u2713' : '\u2717', x, y + 2, { continued: true });
      doc.fontSize(9).font('Helvetica').fillColor(GRAY_DARK).text('  ' + label);
    }
    doc.y = y + 14;
  }

  // ── CONTRACTOR ──

  if (fault.contractorCompany || fault.contractorName) {
    sectionBar('Contractor Details');
    if (fault.contractorCompany) kv('Company', fault.contractorCompany);
    if (fault.contractorName) kv('Name', fault.contractorName);
    if (fault.contractorEmail) kv('Email', fault.contractorEmail);
    if (fault.contractorMobile) kv('Mobile', fault.contractorMobile);
  }

  // ── DAILY REPORTS ──

  for (const day of fault.workDays) {
    sectionBar(`Day ${day.dayNumber}${day.isLocked ? '  \u2014  Locked' : ''}`);

    if (day.events.length > 0) {
      subHead('Attendance');
      const cols = [
        { label: 'Event', w: PW * 0.24 }, { label: 'Time', w: PW * 0.12 },
        { label: 'Lat', w: PW * 0.18 }, { label: 'Lng', w: PW * 0.18 },
        { label: 'Elapsed / Dist', w: PW * 0.28 },
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
          { val: fmtTime(e.timestamp), w: PW * 0.12 },
          { val: e.lat.toFixed(6), w: PW * 0.18 },
          { val: e.lng.toFixed(6), w: PW * 0.18 },
          { val: info, w: PW * 0.28 },
        ], i % 2 === 1);
      }
    }

    if (day.supervisorNames || day.tradespersonNames || day.operativeName) {
      subHead('Personnel');
      if (day.supervisorNames) kv('Supervisor(s)', day.supervisorNames);
      if (day.tradespersonNames) kv('Tradesperson(s)', day.tradespersonNames);
      if (day.operativeName) kv('Operative', day.operativeName);
    }

    const tw = day.tempWorks as { item: string; qty: number; unit?: string }[] | null;
    if (tw && Array.isArray(tw) && tw.some(r => r.item)) {
      subHead('Temp Works');
      const cols = [{ label: 'Item', w: PW * 0.5 }, { label: 'Qty', w: PW * 0.25 }, { label: 'Unit', w: PW * 0.25 }];
      tHead(cols);
      tw.forEach((r, i) => { if (r.item) tRow([{ val: r.item, w: PW * 0.5 }, { val: String(r.qty), w: PW * 0.25 }, { val: r.unit || '', w: PW * 0.25 }], i % 2 === 1); });
    }

    const mats = day.materialsUsed as { item: string; qty: number; unit?: string }[] | null;
    if (mats && Array.isArray(mats) && mats.some(r => r.item)) {
      subHead('Materials Used');
      const cols = [{ label: 'Item', w: PW * 0.5 }, { label: 'Qty', w: PW * 0.25 }, { label: 'Unit', w: PW * 0.25 }];
      tHead(cols);
      mats.forEach((r, i) => { if (r.item) tRow([{ val: r.item, w: PW * 0.5 }, { val: String(r.qty), w: PW * 0.25 }, { val: r.unit || '', w: PW * 0.25 }], i % 2 === 1); });
    }

    if (day.methodology) { subHead('Methodology'); para(day.methodology); }
    if (day.worksDescription) { subHead('Works Description'); para(day.worksDescription); }

    const dims = day.dimensions as { activity: string; qty: number; unit?: string }[] | null;
    if (dims && Array.isArray(dims) && dims.some(r => r.activity)) {
      subHead('Dimensions');
      const cols = [{ label: 'Activity', w: PW * 0.5 }, { label: 'Qty', w: PW * 0.25 }, { label: 'Unit', w: PW * 0.25 }];
      tHead(cols);
      dims.forEach((r, i) => { if (r.activity) tRow([{ val: r.activity, w: PW * 0.5 }, { val: String(r.qty), w: PW * 0.25 }, { val: r.unit || '', w: PW * 0.25 }], i % 2 === 1); });
    }

    if (day.furtherWork) {
      subHead('Further Work Required');
      if (day.furtherWorkNotes) para(day.furtherWorkNotes);
      else para('Yes — no additional notes provided.');
    }

    if (day.photos.length > 0) {
      subHead(`Photos (${day.photos.length})`);
      for (const p of day.photos) kv(`[${p.photoStage.toUpperCase()}]`, p.fileName || p.r2Key);
    }
  }

  // ── ADDITIONAL PHOTOS ──

  const extra = fault.photos.filter(p => !p.workDayId);
  if (extra.length > 0) {
    sectionBar('Additional Photos');
    for (const p of extra) kv(`[${p.photoStage.toUpperCase()}]`, p.fileName || p.r2Key);
  }

  // ── FOOTERS ──

  const now = fmtDateTime(new Date());
  const pages = doc.bufferedPageRange().count;
  for (let i = 0; i < pages; i++) {
    doc.switchToPage(i);
    if (i > 0) doc.rect(0, 0, doc.page.width, 4).fill(NAVY);
    const fy = doc.page.height - 36;
    doc.moveTo(LM, fy).lineTo(LM + PW, fy).lineWidth(0.5).strokeColor(NAVY).stroke();
    doc.fontSize(7).font('Helvetica-Bold').fillColor(NAVY).text('Infrava Private Limited', LM, fy + 6, { width: PW / 3, align: 'left' });
    doc.fontSize(7).font('Helvetica').fillColor(GRAY_LIGHT).text(`Generated: ${now}`, LM + PW / 3, fy + 6, { width: PW / 3, align: 'center' });
    doc.fontSize(7).font('Helvetica').fillColor(GRAY_LIGHT).text(`Page ${i + 1} of ${pages}`, LM + (PW * 2) / 3, fy + 6, { width: PW / 3, align: 'right' });
  }

  doc.end();
  const buffer = await new Promise<Buffer>((resolve) => { doc.on('end', () => resolve(Buffer.concat(chunks))); });
  const r2Key = `reports/${fault.adminId}/${fault.clientRef}.pdf`;
  await uploadFile(r2Key, buffer);
  return r2Key;
}
