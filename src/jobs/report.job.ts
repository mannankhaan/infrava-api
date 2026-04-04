import { Fault, FaultPhoto, User, WorkDay, PunchEvent } from '@prisma/client';
import { uploadFile } from '../shared/services/storage.service';

type WorkDayWithRelations = WorkDay & { events: PunchEvent[]; photos: FaultPhoto[] };

type FaultWithRelations = Fault & {
  admin: Pick<User, 'id' | 'name' | 'email'>;
  assignedOperative: Pick<User, 'name'> | null;
  photos: FaultPhoto[];
  workDays: WorkDayWithRelations[];
};

/**
 * Generate a text report for a completed fault.
 * TODO: Replace with @react-pdf/renderer for full 4-page CK Rail form layout.
 */
export async function generateFaultPdf(fault: FaultWithRelations): Promise<string> {
  const lines: string[] = [
    'INFRAVA PRIVATE LIMITED',
    'Contractor Fault Assignment Report',
    '═'.repeat(60),
    '',
    `Client Reference: ${fault.clientRef}`,
    `Company Reference: ${fault.companyRef || 'N/A'}`,
    `Date: ${fault.faultDate}`,
    `Operative: ${fault.assignedOperative?.name || 'N/A'}`,
    '',
    '── FAULT DETAILS ──',
    `Title: ${fault.title}`,
    `Work Type: ${fault.workType || 'N/A'}`,
    `Description: ${fault.description || 'N/A'}`,
    `Priority: ${fault.priority || 'N/A'}`,
    `Location: ${fault.locationText || 'N/A'}`,
    `Time Allocated: ${fault.timeAllocated?.toISOString() || 'N/A'}`,
    `Planned Arrival: ${fault.plannedArrival?.toISOString() || 'N/A'}`,
    `Planned Completion: ${fault.plannedCompletion?.toISOString() || 'N/A'}`,
    '',
    '── ONSITE CONTACT ──',
    `Name: ${fault.onsiteContactName || 'N/A'}`,
    `Phone: ${fault.onsiteContactPhone || 'N/A'}`,
    `Email: ${fault.onsiteContactEmail || 'N/A'}`,
    '',
    '── VISIT REQUIREMENTS ──',
    `Task Briefing: ${fault.visitTaskBriefing ? 'Yes' : 'No'}`,
    `LSR: ${fault.visitLsr ? 'Yes' : 'No'}`,
    `Link Block: ${fault.visitLinkBlock ? 'Yes' : 'No'}`,
    `Safe Work Pack: ${fault.visitSafeWorkPack ? 'Yes' : 'No'}`,
    `Possession: ${fault.visitPossession ? 'Yes' : 'No'}`,
    `Temp Works: ${fault.visitTempWorks ? 'Yes' : 'No'}`,
    `Isolation: ${fault.visitIsolation ? 'Yes' : 'No'}`,
    `Track Access: ${fault.visitTrackAccess ? 'Yes' : 'No'}`,
    `Temp Works Required: ${fault.visitTempWorksRequired ? 'Yes' : 'No'}`,
    `Working at Height: ${fault.visitWorkingAtHeight ? 'Yes' : 'No'}`,
    '',
    '── CONTRACTOR ──',
    `Company: ${fault.contractorCompany || 'N/A'}`,
    `Name: ${fault.contractorName || 'N/A'}`,
    `Email: ${fault.contractorEmail || 'N/A'}`,
    `Mobile: ${fault.contractorMobile || 'N/A'}`,
  ];

  // Per-day reports
  lines.push('', '═'.repeat(60));
  lines.push(`DAILY REPORTS (${fault.workDays.length} day${fault.workDays.length !== 1 ? 's' : ''})`);
  lines.push('═'.repeat(60));

  for (const day of fault.workDays) {
    lines.push('', `── DAY ${day.dayNumber} ${day.isLocked ? '(Locked)' : ''} ──`);

    // GPS Punches
    if (day.events.length > 0) {
      lines.push('  Attendance:');
      for (const event of day.events) {
        const time = event.timestamp.toISOString().replace('T', ' ').substring(0, 19);
        lines.push(`    ${event.eventType.padEnd(12)} ${time}  GPS: ${event.lat.toFixed(6)}, ${event.lng.toFixed(6)}`);
      }
    }

    // Personnel
    if (day.supervisorNames || day.tradespersonNames || day.operativeName) {
      lines.push('  Personnel:');
      if (day.supervisorNames) lines.push(`    Supervisor(s): ${day.supervisorNames}`);
      if (day.tradespersonNames) lines.push(`    Tradesperson(s): ${day.tradespersonNames}`);
      if (day.operativeName) lines.push(`    Operative: ${day.operativeName}`);
    }

    // Materials
    if (day.materialsUsed && Array.isArray(day.materialsUsed) && (day.materialsUsed as unknown[]).length > 0) {
      lines.push('  Materials Used:');
      for (const row of day.materialsUsed as { item: string; qty: number; unit?: string }[]) {
        if (row.item) lines.push(`    ${row.item} — Qty: ${row.qty} ${row.unit || ''}`);
      }
    }

    // Methodology
    if (day.methodology) {
      lines.push(`  Methodology: ${day.methodology}`);
    }

    // Works Description
    if (day.worksDescription) {
      lines.push(`  Works Description: ${day.worksDescription}`);
    }

    // Dimensions
    if (day.dimensions && Array.isArray(day.dimensions) && (day.dimensions as unknown[]).length > 0) {
      lines.push('  Dimensions:');
      for (const row of day.dimensions as { activity: string; qty: number; unit?: string }[]) {
        if (row.activity) lines.push(`    ${row.activity} — Qty: ${row.qty} ${row.unit || ''}`);
      }
    }

    // Further Work
    if (day.furtherWork) {
      lines.push(`  Further Work Required: Yes`);
      if (day.furtherWorkNotes) lines.push(`    Notes: ${day.furtherWorkNotes}`);
    }

    // Photos for this day
    if (day.photos.length > 0) {
      lines.push(`  Photos (${day.photos.length}):`);
      for (const photo of day.photos) {
        lines.push(`    [${photo.photoStage}] ${photo.fileName || photo.r2Key}`);
      }
    }
  }

  // Fault-level photos (not tied to a work day)
  const faultLevelPhotos = fault.photos.filter((p) => !p.workDayId);
  if (faultLevelPhotos.length > 0) {
    lines.push('', '── ADDITIONAL PHOTOS ──');
    for (const photo of faultLevelPhotos) {
      lines.push(`  [${photo.photoStage}] ${photo.fileName || photo.r2Key}`);
    }
  }

  lines.push('', '═'.repeat(60));
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('Infrava Private Limited');

  const content = lines.join('\n');
  const buffer = Buffer.from(content, 'utf-8');

  const r2Key = `reports/${fault.adminId}/${fault.clientRef}.txt`;
  await uploadFile(r2Key, buffer);

  return r2Key;
}
