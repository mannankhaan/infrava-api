interface FormField {
  key: string;
  type: string;
  label: string;
  required?: boolean;
  source: 'core' | 'custom';
  options?: string[];
}

interface FormSection {
  key: string;
  title: string;
  fields: FormField[];
}

interface FormSchema {
  sections: FormSection[];
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Core Fault columns that can be mapped from form fields
const CORE_FIELD_KEYS = new Set([
  'clientRef', 'companyRef', 'title', 'workType', 'description',
  'locationText', 'locationLat', 'locationLng',
  'timeAllocated', 'plannedArrival', 'plannedCompletion', 'priority',
  'onsiteContactName', 'onsiteContactPhone', 'onsiteContactEmail',
  'visitTaskBriefing', 'visitLsr', 'visitLinkBlock', 'visitSafeWorkPack',
  'visitPossession', 'visitTempWorks', 'visitIsolation', 'visitTrackAccess',
  'visitTempWorksRequired', 'visitWorkingAtHeight',
  'contractorCompany', 'contractorName', 'contractorEmail', 'contractorMobile',
]);

export function validateFaultAgainstTemplate(
  data: Record<string, unknown>,
  schema: FormSchema,
): ValidationResult {
  const errors: string[] = [];

  for (const section of schema.sections) {
    for (const field of section.fields) {
      const value = data[field.key];

      // Required check
      if (field.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field.label} is required`);
        continue;
      }

      if (value === undefined || value === null || value === '') continue;

      // Type validation
      switch (field.type) {
        case 'number':
          if (typeof value !== 'number' && isNaN(Number(value))) {
            errors.push(`${field.label} must be a number`);
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean') {
            errors.push(`${field.label} must be true or false`);
          }
          break;
        case 'email':
          if (typeof value === 'string' && !value.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
            errors.push(`${field.label} must be a valid email`);
          }
          break;
        case 'select':
          if (field.options && !field.options.includes(value as string)) {
            errors.push(`${field.label} must be one of: ${field.options.join(', ')}`);
          }
          break;
        case 'multiselect':
          if (Array.isArray(value) && field.options) {
            const invalid = (value as string[]).filter(v => !field.options!.includes(v));
            if (invalid.length) {
              errors.push(`${field.label} contains invalid options: ${invalid.join(', ')}`);
            }
          }
          break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Separate form data into core Prisma fields and custom JSONB fields
 * based on the template schema.
 */
export function separateFormData(
  data: Record<string, unknown>,
  schema: FormSchema,
): { coreFields: Record<string, unknown>; customFields: Record<string, unknown> } {
  const coreFields: Record<string, unknown> = {};
  const customFields: Record<string, unknown> = {};

  for (const section of schema.sections) {
    for (const field of section.fields) {
      const value = data[field.key];
      if (value === undefined) continue;

      if (field.source === 'core' && CORE_FIELD_KEYS.has(field.key)) {
        coreFields[field.key] = value;
      } else {
        customFields[field.key] = value;
      }
    }
  }

  return { coreFields, customFields };
}

/**
 * Generate a default form template schema that includes all existing core fields.
 */
export function generateDefaultFormSchema(): FormSchema {
  return {
    sections: [
      {
        key: 'references',
        title: 'References',
        fields: [
          { key: 'clientRef', type: 'text', label: 'Client Reference', source: 'core' },
          { key: 'companyRef', type: 'text', label: 'Company Reference', source: 'core' },
        ],
      },
      {
        key: 'fault_details',
        title: 'Fault Details',
        fields: [
          { key: 'title', type: 'text', label: 'Title', required: true, source: 'core' },
          { key: 'workType', type: 'text', label: 'Work Type', source: 'core' },
          { key: 'locationText', type: 'text', label: 'Location', source: 'core' },
          { key: 'description', type: 'textarea', label: 'Description', source: 'core' },
        ],
      },
      {
        key: 'scheduling',
        title: 'Scheduling',
        fields: [
          { key: 'priority', type: 'select', label: 'Priority', source: 'core', options: ['2h', '24h', '7d', '28d', 'Planned', 'Project'] },
          { key: 'timeAllocated', type: 'datetime', label: 'Time Allocated', source: 'core' },
          { key: 'plannedArrival', type: 'datetime', label: 'Planned Arrival', source: 'core' },
          { key: 'plannedCompletion', type: 'datetime', label: 'Planned Completion', source: 'core' },
        ],
      },
      {
        key: 'onsite_contact',
        title: 'Onsite Contact',
        fields: [
          { key: 'onsiteContactName', type: 'text', label: 'Name', source: 'core' },
          { key: 'onsiteContactPhone', type: 'phone', label: 'Phone', source: 'core' },
          { key: 'onsiteContactEmail', type: 'email', label: 'Email', source: 'core' },
        ],
      },
      {
        key: 'visit_requirements',
        title: 'Visit Requirements',
        fields: [
          { key: 'visitTaskBriefing', type: 'boolean', label: 'Task Briefing', source: 'core' },
          { key: 'visitLsr', type: 'boolean', label: 'LSR', source: 'core' },
          { key: 'visitLinkBlock', type: 'boolean', label: 'Link Block', source: 'core' },
          { key: 'visitSafeWorkPack', type: 'boolean', label: 'Safe Work Pack', source: 'core' },
          { key: 'visitPossession', type: 'boolean', label: 'Possession', source: 'core' },
          { key: 'visitTempWorks', type: 'boolean', label: 'Temporary Works', source: 'core' },
          { key: 'visitIsolation', type: 'boolean', label: 'Isolation', source: 'core' },
          { key: 'visitTrackAccess', type: 'boolean', label: 'Track Access', source: 'core' },
          { key: 'visitTempWorksRequired', type: 'boolean', label: 'Temp Works Required', source: 'core' },
          { key: 'visitWorkingAtHeight', type: 'boolean', label: 'Working at Height', source: 'core' },
        ],
      },
      {
        key: 'contractor_details',
        title: 'Contractor Details',
        fields: [
          { key: 'contractorCompany', type: 'text', label: 'Company', source: 'core' },
          { key: 'contractorName', type: 'text', label: 'Name', source: 'core' },
          { key: 'contractorEmail', type: 'email', label: 'Email', source: 'core' },
          { key: 'contractorMobile', type: 'phone', label: 'Mobile', source: 'core' },
        ],
      },
    ],
  };
}
