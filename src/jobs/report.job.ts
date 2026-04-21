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

// Brand colors
const NAVY = '#1C2B41';
const BLUE = '#0C66E4';
const GRAY_DARK = '#333333';
const GRAY_MED = '#666666';
const GRAY_LIGHT = '#999999';
const GRAY_BORDER = '#E0E0E0';
const BLUE_LIGHT = '#F0F4FF';
const GREEN_CHECK = '#16A34A';
const RED_CROSS = '#DC2626';

const LOGO_PATH = path.join(process.cwd(), 'assets', 'logo.png');

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return 'N/A';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return 'N/A';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function timeDiff(t1: Date | string, t2: Date | string): string {
  const ms = new Date(t2).getTime() - new Date(t1).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

async function loadAdminAvatar(avatarUrl: string | null | undefined): Promise<Buffer | null> {
  if (!avatarUrl) return null;
  try {
    // avatarUrl is like "http://localhost:4000/uploads/avatars/xxx.jpg"
    // Extract the key: "avatars/xxx.jpg"
    const match = avatarUrl.match(/uploads\/(.+)$/);
    if (match) {
      return await getFile(match[1]);
    }
  } catch {
    // Avatar not available — skip
  }
  return null;
}

export async function generateFaultPdf(fault: FaultWithRelations): Promise<string> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    bufferPages: true,
    info: {
      Title: `Infrava Report - ${fault.clientRef}`,
      Author: 'Infrava Private Limited',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const pageWidth = doc.page.width - 80; // 40px margins each side
  const leftMargin = 40;

  // ─── Helper functions ───

  function drawSectionHeader(title: string) {
    ensureSpace(30);
    doc.moveDown(0.5);
    doc.fillColor(NAVY).fontSize(13).font('Helvetica-Bold').text(title, leftMargin);
    const y = doc.y + 2;
    doc.moveTo(leftMargin, y).lineTo(leftMargin + pageWidth, y).strokeColor(BLUE).lineWidth(1.5).stroke();
    doc.moveDown(0.4);
  }

  function drawKeyValue(label: string, value: string, indent = 0) {
    ensureSpace(16);
    const x = leftMargin + indent;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(GRAY_MED).text(label + ':', x, doc.y, { continued: true });
    doc.font('Helvetica').fillColor(GRAY_DARK).text('  ' + value);
  }

  function drawCheckItem(label: string, checked: boolean) {
    ensureSpace(16);
    const symbol = checked ? '\u2713' : '\u2717';
    const color = checked ? GREEN_CHECK : RED_CROSS;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(color).text(symbol, leftMargin + 10, doc.y, { continued: true });
    doc.font('Helvetica').fillColor(GRAY_DARK).text('  ' + label);
  }

  function drawTableHeader(columns: { label: string; width: number }[]) {
    ensureSpace(20);
    const y = doc.y;
    doc.rect(leftMargin, y, pageWidth, 18).fill(NAVY);
    let x = leftMargin + 6;
    for (const col of columns) {
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#FFFFFF').text(col.label, x, y + 4, { width: col.width - 12 });
      x += col.width;
    }
    doc.y = y + 18;
  }

  function drawTableRow(columns: { value: string; width: number }[], isAlt: boolean) {
    ensureSpace(18);
    const y = doc.y;
    if (isAlt) {
      doc.rect(leftMargin, y, pageWidth, 16).fill(BLUE_LIGHT);
    }
    let x = leftMargin + 6;
    for (const col of columns) {
      doc.fontSize(8).font('Helvetica').fillColor(GRAY_DARK).text(col.value, x, y + 3, { width: col.width - 12 });
      x += col.width;
    }
    doc.y = y + 16;
  }

  function ensureSpace(needed: number) {
    // Reserve 45px at bottom for the page footer
    if (doc.y + needed > doc.page.height - 75) {
      doc.addPage();
      doc.y = 40;
    }
  }

  // ─── HEADER ───

  // Load logos
  let hasLogo = false;
  try {
    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, leftMargin, 30, { height: 40 });
      hasLogo = true;
    }
  } catch { /* skip logo */ }

  // Admin avatar (right side)
  const adminAvatar = await loadAdminAvatar(fault.admin.avatarUrl);
  if (adminAvatar) {
    try {
      doc.image(adminAvatar, doc.page.width - 40 - 40, 30, { height: 40, width: 40 });
    } catch { /* skip avatar */ }
  }

  // Title
  doc.y = hasLogo ? 80 : 40;
  doc.fontSize(18).font('Helvetica-Bold').fillColor(NAVY).text('Fault Assignment Report', leftMargin, doc.y, { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(9).font('Helvetica').fillColor(GRAY_LIGHT).text(`Generated ${formatDateTime(new Date())}`, { align: 'center' });
  doc.moveDown(0.3);

  // Divider
  const divY = doc.y;
  doc.moveTo(leftMargin, divY).lineTo(leftMargin + pageWidth, divY).strokeColor(GRAY_BORDER).lineWidth(1).stroke();
  doc.moveDown(0.5);

  // ─── FAULT SUMMARY ───

  drawSectionHeader('Fault Summary');

  const summaryCol1 = [
    ['Client Ref', fault.clientRef],
    ['Company Ref', fault.companyRef || 'N/A'],
    ['Fault Date', formatDate(fault.faultDate)],
    ['Status', fault.status.replace(/_/g, ' ')],
  ];

  const summaryCol2 = [
    ['Operative', fault.assignedOperative?.name || 'N/A'],
    ['Priority', fault.priority || 'N/A'],
    ['Work Type', fault.workType || 'N/A'],
    ['Location', fault.locationText || 'N/A'],
  ];

  // Two-column layout for summary
  const colWidth = pageWidth / 2;
  const startY = doc.y;

  for (let i = 0; i < summaryCol1.length; i++) {
    doc.y = startY + i * 16;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(GRAY_MED).text(summaryCol1[i][0] + ':', leftMargin, doc.y, { width: colWidth });
    doc.fontSize(9).font('Helvetica').fillColor(GRAY_DARK).text(summaryCol1[i][1], leftMargin + 90, doc.y - doc.currentLineHeight());
  }

  for (let i = 0; i < summaryCol2.length; i++) {
    doc.y = startY + i * 16;
    const x2 = leftMargin + colWidth;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(GRAY_MED).text(summaryCol2[i][0] + ':', x2, doc.y, { width: colWidth });
    doc.fontSize(9).font('Helvetica').fillColor(GRAY_DARK).text(summaryCol2[i][1], x2 + 90, doc.y - doc.currentLineHeight());
  }

  doc.y = startY + summaryCol1.length * 16 + 4;

  // Additional details
  if (fault.title) drawKeyValue('Title', fault.title);
  if (fault.description) drawKeyValue('Description', fault.description);
  if (fault.timeAllocated) drawKeyValue('Time Allocated', formatDateTime(fault.timeAllocated));
  if (fault.plannedArrival) drawKeyValue('Planned Arrival', formatDateTime(fault.plannedArrival));
  if (fault.plannedCompletion) drawKeyValue('Planned Completion', formatDateTime(fault.plannedCompletion));

  // ─── ONSITE CONTACT ───

  if (fault.onsiteContactName || fault.onsiteContactPhone || fault.onsiteContactEmail) {
    drawSectionHeader('Onsite Contact');
    if (fault.onsiteContactName) drawKeyValue('Name', fault.onsiteContactName);
    if (fault.onsiteContactPhone) drawKeyValue('Phone', fault.onsiteContactPhone);
    if (fault.onsiteContactEmail) drawKeyValue('Email', fault.onsiteContactEmail);
  }

  // ─── VISIT REQUIREMENTS ───

  drawSectionHeader('Visit Requirements');

  const requirements = [
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
  ] as const;

  for (const [label, val] of requirements) {
    drawCheckItem(label, val);
  }

  // ─── CONTRACTOR ───

  if (fault.contractorCompany || fault.contractorName) {
    drawSectionHeader('Contractor Details');
    if (fault.contractorCompany) drawKeyValue('Company', fault.contractorCompany);
    if (fault.contractorName) drawKeyValue('Name', fault.contractorName);
    if (fault.contractorEmail) drawKeyValue('Email', fault.contractorEmail);
    if (fault.contractorMobile) drawKeyValue('Mobile', fault.contractorMobile);
  }

  // ─── DAILY REPORTS ───

  for (const day of fault.workDays) {
    drawSectionHeader(`Day ${day.dayNumber}${day.isLocked ? ' (Locked)' : ''}`);

    // Attendance table
    if (day.events.length > 0) {
      ensureSpace(40);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(GRAY_DARK).text('Attendance', leftMargin + 4);
      doc.moveDown(0.2);

      const evtCols = [
        { label: 'Event', width: 120 },
        { label: 'Time', width: 80 },
        { label: 'Latitude', width: 100 },
        { label: 'Longitude', width: 100 },
        { label: 'Elapsed / Distance', width: pageWidth - 400 },
      ];
      drawTableHeader(evtCols);

      for (let i = 0; i < day.events.length; i++) {
        const evt = day.events[i];
        let elapsed = '';
        if (i > 0) {
          const prev = day.events[i - 1];
          const time = timeDiff(prev.timestamp, evt.timestamp);
          const dist = haversineDistance(prev.lat, prev.lng, evt.lat, evt.lng);
          elapsed = `${time} / ${dist.toFixed(1)} mi`;
        }
        drawTableRow([
          { value: evt.eventType.replace(/_/g, ' '), width: 120 },
          { value: formatTime(evt.timestamp), width: 80 },
          { value: evt.lat.toFixed(6), width: 100 },
          { value: evt.lng.toFixed(6), width: 100 },
          { value: elapsed, width: pageWidth - 400 },
        ], i % 2 === 1);
      }
      doc.moveDown(0.3);
    }

    // Personnel
    if (day.supervisorNames || day.tradespersonNames || day.operativeName) {
      ensureSpace(20);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(GRAY_DARK).text('Personnel', leftMargin + 4);
      doc.moveDown(0.1);
      if (day.supervisorNames) drawKeyValue('Supervisor(s)', day.supervisorNames, 8);
      if (day.tradespersonNames) drawKeyValue('Tradesperson(s)', day.tradespersonNames, 8);
      if (day.operativeName) drawKeyValue('Operative', day.operativeName, 8);
      doc.moveDown(0.2);
    }

    // Temp Works
    const tempWorks = day.tempWorks as { item: string; qty: number; unit?: string }[] | null;
    if (tempWorks && Array.isArray(tempWorks) && tempWorks.length > 0) {
      ensureSpace(40);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(GRAY_DARK).text('Temp Works', leftMargin + 4);
      doc.moveDown(0.2);

      const twCols = [
        { label: 'Item', width: pageWidth * 0.5 },
        { label: 'Qty', width: pageWidth * 0.25 },
        { label: 'Unit', width: pageWidth * 0.25 },
      ];
      drawTableHeader(twCols);
      tempWorks.forEach((row, i) => {
        if (row.item) {
          drawTableRow([
            { value: row.item, width: pageWidth * 0.5 },
            { value: String(row.qty), width: pageWidth * 0.25 },
            { value: row.unit || '', width: pageWidth * 0.25 },
          ], i % 2 === 1);
        }
      });
      doc.moveDown(0.3);
    }

    // Materials
    const materials = day.materialsUsed as { item: string; qty: number; unit?: string }[] | null;
    if (materials && Array.isArray(materials) && materials.length > 0) {
      ensureSpace(40);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(GRAY_DARK).text('Materials Used', leftMargin + 4);
      doc.moveDown(0.2);

      const matCols = [
        { label: 'Item', width: pageWidth * 0.5 },
        { label: 'Qty', width: pageWidth * 0.25 },
        { label: 'Unit', width: pageWidth * 0.25 },
      ];
      drawTableHeader(matCols);
      materials.forEach((row, i) => {
        if (row.item) {
          drawTableRow([
            { value: row.item, width: pageWidth * 0.5 },
            { value: String(row.qty), width: pageWidth * 0.25 },
            { value: row.unit || '', width: pageWidth * 0.25 },
          ], i % 2 === 1);
        }
      });
      doc.moveDown(0.3);
    }

    // Methodology
    if (day.methodology) {
      ensureSpace(20);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(GRAY_DARK).text('Methodology', leftMargin + 4);
      doc.moveDown(0.1);
      doc.fontSize(9).font('Helvetica').fillColor(GRAY_DARK).text(day.methodology, leftMargin + 8, doc.y, { width: pageWidth - 16 });
      doc.moveDown(0.3);
    }

    // Works Description
    if (day.worksDescription) {
      ensureSpace(20);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(GRAY_DARK).text('Works Description', leftMargin + 4);
      doc.moveDown(0.1);
      doc.fontSize(9).font('Helvetica').fillColor(GRAY_DARK).text(day.worksDescription, leftMargin + 8, doc.y, { width: pageWidth - 16 });
      doc.moveDown(0.3);
    }

    // Dimensions
    const dimensions = day.dimensions as { activity: string; qty: number; unit?: string }[] | null;
    if (dimensions && Array.isArray(dimensions) && dimensions.length > 0) {
      ensureSpace(40);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(GRAY_DARK).text('Dimensions', leftMargin + 4);
      doc.moveDown(0.2);

      const dimCols = [
        { label: 'Activity', width: pageWidth * 0.5 },
        { label: 'Qty', width: pageWidth * 0.25 },
        { label: 'Unit', width: pageWidth * 0.25 },
      ];
      drawTableHeader(dimCols);
      dimensions.forEach((row, i) => {
        if (row.activity) {
          drawTableRow([
            { value: row.activity, width: pageWidth * 0.5 },
            { value: String(row.qty), width: pageWidth * 0.25 },
            { value: row.unit || '', width: pageWidth * 0.25 },
          ], i % 2 === 1);
        }
      });
      doc.moveDown(0.3);
    }

    // Further Work
    if (day.furtherWork) {
      ensureSpace(20);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(GRAY_DARK).text('Further Work Required', leftMargin + 4);
      doc.moveDown(0.1);
      if (day.furtherWorkNotes) {
        doc.fontSize(9).font('Helvetica').fillColor(GRAY_DARK).text(day.furtherWorkNotes, leftMargin + 8, doc.y, { width: pageWidth - 16 });
      }
      doc.moveDown(0.3);
    }

    // Photos
    if (day.photos.length > 0) {
      ensureSpace(20);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(GRAY_DARK).text(`Photos (${day.photos.length})`, leftMargin + 4);
      doc.moveDown(0.1);
      for (const photo of day.photos) {
        drawKeyValue(`[${photo.photoStage}]`, photo.fileName || photo.r2Key, 8);
      }
      doc.moveDown(0.2);
    }
  }

  // ─── ADDITIONAL PHOTOS ───

  const faultLevelPhotos = fault.photos.filter((p) => !p.workDayId);
  if (faultLevelPhotos.length > 0) {
    drawSectionHeader('Additional Photos');
    for (const photo of faultLevelPhotos) {
      drawKeyValue(`[${photo.photoStage}]`, photo.fileName || photo.r2Key);
    }
  }

  // ─── PAGE FOOTERS (drawn on every page) ───

  const generatedAt = formatDateTime(new Date());
  const totalPages = doc.bufferedPageRange().count;

  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    const footerTop = doc.page.height - 30;

    // Divider line
    doc.moveTo(leftMargin, footerTop).lineTo(leftMargin + pageWidth, footerTop)
      .strokeColor(GRAY_BORDER).lineWidth(0.5).stroke();

    // Left: company name
    doc.fontSize(7).font('Helvetica').fillColor(GRAY_LIGHT)
      .text('Infrava Private Limited', leftMargin, footerTop + 6, { width: pageWidth / 3, align: 'left' });

    // Center: generated timestamp
    doc.fontSize(7).font('Helvetica').fillColor(GRAY_LIGHT)
      .text(`Generated: ${generatedAt}`, leftMargin + pageWidth / 3, footerTop + 6, { width: pageWidth / 3, align: 'center' });

    // Right: page number
    doc.fontSize(7).font('Helvetica').fillColor(GRAY_LIGHT)
      .text(`Page ${i + 1} of ${totalPages}`, leftMargin + (pageWidth * 2) / 3, footerTop + 6, { width: pageWidth / 3, align: 'right' });
  }

  // Finalize
  doc.end();

  // Collect all chunks into a buffer
  const buffer = await new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const r2Key = `reports/${fault.adminId}/${fault.clientRef}.pdf`;
  await uploadFile(r2Key, buffer);

  return r2Key;
}
