import mammoth from 'mammoth';

interface ParsedFaultData {
  clientRef?: string;
  companyRef?: string;
  timeAllocated?: string;
  plannedArrival?: string;
  plannedCompletion?: string;
  priority?: string;
  title?: string;
  workType?: string;
  locationText?: string;
  description?: string;
  onsiteContactName?: string;
  onsiteContactPhone?: string;
  onsiteContactEmail?: string;
  visitTaskBriefing?: boolean;
  visitLsr?: boolean;
  visitLinkBlock?: boolean;
  visitSafeWorkPack?: boolean;
  visitPossession?: boolean;
  visitTempWorks?: boolean;
  visitIsolation?: boolean;
  visitTrackAccess?: boolean;
  visitTempWorksRequired?: boolean;
  visitWorkingAtHeight?: boolean;
  contractorCompany?: string;
  contractorName?: string;
  contractorEmail?: string;
  contractorMobile?: string;
}

/** Convert DD/MM/YYYY HH:mm to datetime-local format YYYY-MM-DDTHH:mm */
function parseDate(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const m = val.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) {
    const [, day, month, year, hour, min] = m;
    return `${year}-${month}-${day}T${hour}:${min}`;
  }
  return undefined;
}

/** Strip HTML tags, converting <br> and block boundaries to newlines */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/td>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Parse a CK Rail Contractor Fault Form .docx file.
 * Uses mammoth HTML to preserve line breaks and table structure.
 */
export async function parseFaultDocx(buffer: Buffer): Promise<ParsedFaultData> {
  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value;
  const text = htmlToText(html);
  const lines = text.split('\n');
  const data: ParsedFaultData = {};

  /** Find the next non-blank line after a label match */
  const extractAfter = (label: string): string | undefined => {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().toLowerCase() === label.toLowerCase()) {
        for (let j = i + 1; j < lines.length; j++) {
          const val = lines[j].trim();
          if (val && val !== ' ') {
            if (val.startsWith('Click or tap')) return undefined;
            return val;
          }
        }
      }
    }
    return undefined;
  };

  /**
   * Find the next non-blank line after a label, scoped to a section.
   */
  const extractAfterInSection = (
    label: string,
    sectionStart: string,
    sectionEnd?: string,
  ): string | undefined => {
    let inSection = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim().toUpperCase();
      if (trimmed === sectionStart.toUpperCase()) {
        inSection = true;
        continue;
      }
      if (sectionEnd && trimmed === sectionEnd.toUpperCase()) {
        break;
      }
      if (inSection && lines[i].trim().toLowerCase() === label.toLowerCase()) {
        for (let j = i + 1; j < lines.length; j++) {
          const val = lines[j].trim();
          if (val && val !== ' ') {
            if (val.startsWith('Click or tap')) return undefined;
            return val;
          }
        }
      }
    }
    return undefined;
  };

  /**
   * Extract multi-line text after a label in the HTML table.
   * Uses the raw HTML to preserve <br> as newlines within a cell.
   */
  const extractCellTextFromHtml = (label: string): string | undefined => {
    // Find the table cell containing the label, then grab the next cell(s)
    const labelPattern = new RegExp(
      `<td[^>]*><p>${label}</p></td>` +
      `<td[^>]*(?:\\s+colspan="\\d+")?>(.*?)</td>`,
      'is',
    );
    const match = html.match(labelPattern);
    if (!match) {
      // Try with colspan on the value cell
      const altPattern = new RegExp(
        `<td[^>]*><p>${label}</p></td>` +
        `<td[^>]*>(.*?)</td>`,
        'is',
      );
      const alt = html.match(altPattern);
      if (!alt) return undefined;
      return htmlToText(alt[1]).trim() || undefined;
    }
    return htmlToText(match[1]).trim() || undefined;
  };

  /** Check if a visit requirement is "Yes" */
  const isVisitYes = (label: string): boolean => {
    const val = extractAfterInSection(label, 'VISIT REQUIREMENTS', 'CONTRACTOR DETAILS');
    return val?.toLowerCase() === 'yes';
  };

  // --- References ---
  data.clientRef = extractAfter('CITADEL Reference');
  data.companyRef = extractAfter('CK Reference');

  // --- Scheduling (convert DD/MM/YYYY to ISO) ---
  data.timeAllocated = parseDate(extractAfter('Time Allocated'));
  data.plannedArrival = parseDate(extractAfter('Planned Arrival Time'));
  data.plannedCompletion = parseDate(extractAfter('Planned Completion Time'));

  // --- Fault Details ---
  const priorityRaw = extractAfterInSection('Priority', 'FAULT DETAILS', 'VISIT REQUIREMENTS');
  if (priorityRaw) {
    const p = priorityRaw.toLowerCase();
    if (p.includes('2') && p.includes('hour')) data.priority = '2h';
    else if (p.includes('24')) data.priority = '24h';
    else if (p.includes('7')) data.priority = '7d';
    else if (p.includes('28')) data.priority = '28d';
    else if (p.includes('plan')) data.priority = 'Planned';
    else if (p.includes('project')) data.priority = 'Project';
    else data.priority = priorityRaw;
  }

  data.workType = extractAfterInSection('Work Type', 'FAULT DETAILS', 'VISIT REQUIREMENTS');
  data.title = extractAfterInSection('Title', 'FAULT DETAILS', 'VISIT REQUIREMENTS');
  data.locationText = extractAfterInSection('Location', 'FAULT DETAILS', 'VISIT REQUIREMENTS');

  // Description: extract from HTML cell to preserve <br> as line breaks
  const rawDesc = extractCellTextFromHtml('Description');
  if (rawDesc) {
    const onsiteIdx = rawDesc.indexOf('Onsite Contact');
    if (onsiteIdx > 0) {
      data.description = rawDesc.substring(0, onsiteIdx).trim();

      // Parse concatenated onsite contact info
      const contactStr = rawDesc.substring(onsiteIdx);
      const nameMatch = contactStr.match(/^Onsite Contact\s*(.+?)(?=Onsite Contact Telephone|Onsite Contact Tel|$)/i);
      const phoneMatch = contactStr.match(/Onsite Contact Telephone\s*(.+?)(?=Onsite Contact\s*Email|$)/i);
      const emailMatch = contactStr.match(/Onsite Contact\s*Email\s*(.+?)$/i);

      if (nameMatch?.[1]?.trim()) data.onsiteContactName = nameMatch[1].trim();
      if (phoneMatch?.[1]?.trim()) data.onsiteContactPhone = phoneMatch[1].trim();
      if (emailMatch?.[1]?.trim()) data.onsiteContactEmail = emailMatch[1].trim();
    } else {
      data.description = rawDesc;
    }
  }

  // --- Visit Requirements ---
  data.visitTaskBriefing = isVisitYes('Task Briefing Sheet');
  data.visitLsr = isVisitYes('LSR');
  data.visitLinkBlock = isVisitYes('Link Block');
  data.visitSafeWorkPack = isVisitYes('Safe Work Pack');
  data.visitPossession = isVisitYes('Possession');
  data.visitTempWorks = isVisitYes('Temporary Works');
  data.visitIsolation = isVisitYes('Isolation');
  data.visitTrackAccess = isVisitYes('Track Access');
  data.visitTempWorksRequired = isVisitYes('Temp Works Required');
  data.visitWorkingAtHeight = isVisitYes('Working at Height');

  // --- Contractor Details (scoped to section) ---
  data.contractorCompany = extractAfterInSection('Company', 'CONTRACTOR DETAILS', 'ATTENDANCE DETAILS');
  data.contractorName = extractAfterInSection('Name', 'CONTRACTOR DETAILS', 'ATTENDANCE DETAILS');
  data.contractorEmail = extractAfterInSection('Email', 'CONTRACTOR DETAILS', 'ATTENDANCE DETAILS');
  data.contractorMobile = extractAfterInSection('Mobile', 'CONTRACTOR DETAILS', 'ATTENDANCE DETAILS');

  return data;
}
