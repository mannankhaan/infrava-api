import { PrismaClient, UserRole, FaultStatus, PunchEventType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const passwordHash = await bcrypt.hash('Test1234!', 12);

  // 0. Super Admin (Infrava platform team)
  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@infrava.co.in' },
    update: {},
    create: {
      name: 'Infrava Super Admin',
      email: 'superadmin@infrava.co.in',
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      emailVerified: true,
      isApproved: true,
    },
  });
  console.log(`Super Admin: ${superAdmin.email} (${superAdmin.id})`);

  // 1. Admin (primary user — self-signed-up contractor)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@infrava.co.in' },
    update: {},
    create: {
      name: 'Test Admin',
      email: 'admin@infrava.co.in',
      passwordHash,
      role: UserRole.ADMIN,
      emailVerified: true,
      isApproved: true,
      companyName: 'T4 Engineering Ltd',
      companyAddress: '4a Bramhall Moor Technology Park, SK7 5BW',
      companyWebsite: 'www.t4engineering.co.uk',
      companyPhone: '0161 302 3670',
      companyEmail: 'service@t4engineering.co.uk',
      companyAbn: 'GB123456789',
    },
  });
  console.log(`Admin: ${admin.email} (${admin.id})`);

  // 2. Operatives under Admin
  const operative = await prisma.user.upsert({
    where: { email: 'operative@infrava.co.in' },
    update: {},
    create: {
      name: 'James Wilson',
      email: 'operative@infrava.co.in',
      passwordHash,
      role: UserRole.OPERATIVE,
      adminId: admin.id,
      isApproved: true,
    },
  });
  console.log(`Operative: ${operative.email} (${operative.id})`);

  const operative2 = await prisma.user.upsert({
    where: { email: 'operative2@infrava.co.in' },
    update: {},
    create: {
      name: 'Sarah Chen',
      email: 'operative2@infrava.co.in',
      passwordHash,
      role: UserRole.OPERATIVE,
      adminId: admin.id,
      isApproved: true,
    },
  });
  console.log(`Operative 2: ${operative2.email} (${operative2.id})`);

  const operative3 = await prisma.user.upsert({
    where: { email: 'operative3@infrava.co.in' },
    update: {},
    create: {
      name: 'David Okafor',
      email: 'operative3@infrava.co.in',
      passwordHash,
      role: UserRole.OPERATIVE,
      adminId: admin.id,
      isApproved: true,
    },
  });
  console.log(`Operative 3: ${operative3.email} (${operative3.id})`);

  // 3. Form Templates
  const railTemplate = await prisma.formTemplate.upsert({
    where: { adminId_name: { adminId: admin.id, name: 'Rail Infrastructure' } },
    update: {},
    create: {
      adminId: admin.id,
      name: 'Rail Infrastructure',
      schema: {
        sections: [
          {
            key: 'references',
            title: 'References',
            fields: [
              { key: 'clientRef', type: 'text', label: 'Client Reference', required: false, source: 'core', placeholder: 'e.g. 01722878' },
              { key: 'companyRef', type: 'text', label: 'Company Reference', required: false, source: 'core', placeholder: 'e.g. NR-01722878' },
            ],
          },
          {
            key: 'project',
            title: 'Project Details',
            fields: [
              { key: 'title', type: 'text', label: 'Title *', required: true, source: 'core', placeholder: 'e.g. Automatic Door Repair — Platform 5' },
              { key: 'workType', type: 'select', label: 'Work Type', required: false, source: 'core', options: ['Automatic gates & doors', 'Fire doors', 'Glazing', 'Civil works', 'Electrical', 'HVAC systems', 'Track infrastructure', 'Signalling', 'Other'] },
              { key: 'description', type: 'textarea', label: 'Description', required: false, source: 'core', placeholder: 'Describe the fault or work required...' },
              { key: 'locationText', type: 'text', label: 'Location', required: false, source: 'core', placeholder: 'e.g. Manchester Piccadilly, Platform 12' },
            ],
          },
          {
            key: 'scheduling',
            title: 'Scheduling',
            fields: [
              { key: 'priority', type: 'select', label: 'Priority', required: false, source: 'core', options: ['2h', '24h', '7d', '28d', 'Planned', 'Project'] },
              { key: 'plannedArrival', type: 'datetime', label: 'Planned Arrival', required: false, source: 'core' },
              { key: 'plannedCompletion', type: 'datetime', label: 'Planned Completion', required: false, source: 'core' },
              { key: 'timeAllocated', type: 'datetime', label: 'Time Allocated', required: false, source: 'core' },
            ],
          },
          {
            key: 'contact',
            title: 'Onsite Contact',
            fields: [
              { key: 'onsiteContactName', type: 'text', label: 'Name', required: false, source: 'core', placeholder: 'e.g. John Smith' },
              { key: 'onsiteContactPhone', type: 'phone', label: 'Phone', required: false, source: 'core', placeholder: 'e.g. 07860 655 985' },
              { key: 'onsiteContactEmail', type: 'email', label: 'Email', required: false, source: 'core', placeholder: 'e.g. john@networkrail.co.uk' },
            ],
          },
          {
            key: 'rail_safety',
            title: 'Rail Safety Requirements',
            fields: [
              { key: 'visitTaskBriefing', type: 'boolean', label: 'Task Briefing', required: false, source: 'core' },
              { key: 'visitSafeWorkPack', type: 'boolean', label: 'Safe Work Pack', required: false, source: 'core' },
              { key: 'visitPossession', type: 'boolean', label: 'Possession Required', required: false, source: 'core' },
              { key: 'visitTrackAccess', type: 'boolean', label: 'Track Access', required: false, source: 'core' },
              { key: 'visitIsolation', type: 'boolean', label: 'Isolation', required: false, source: 'core' },
              { key: 'visitWorkingAtHeight', type: 'boolean', label: 'Working at Height', required: false, source: 'core' },
              { key: 'visitTempWorks', type: 'boolean', label: 'Temp Works', required: false, source: 'core' },
              { key: 'visitLsr', type: 'boolean', label: 'LSR', required: false, source: 'core' },
              { key: 'visitLinkBlock', type: 'boolean', label: 'Link Block', required: false, source: 'core' },
            ],
          },
          {
            key: 'rail_custom',
            title: 'Rail Specific',
            fields: [
              { key: 'elr', type: 'text', label: 'ELR (Engineers Line Reference)', required: false, source: 'custom', placeholder: 'e.g. MAN1' },
              { key: 'mileage', type: 'text', label: 'Mileage', required: false, source: 'custom', placeholder: 'e.g. 0m 0440y' },
              { key: 'networkType', type: 'select', label: 'Network Type', required: false, source: 'custom', options: ['Managed Station', 'Open Track', 'Depot', 'Level Crossing'] },
            ],
          },
          {
            key: 'contractor',
            title: 'Contractor',
            fields: [
              { key: 'contractorCompany', type: 'text', label: 'Company', required: false, source: 'core', placeholder: 'e.g. T4 Engineering Ltd' },
              { key: 'contractorName', type: 'text', label: 'Name', required: false, source: 'core', placeholder: 'e.g. Tony Ledgerton' },
              { key: 'contractorEmail', type: 'email', label: 'Email', required: false, source: 'core', placeholder: 'e.g. workorders@t4eg.co.uk' },
              { key: 'contractorMobile', type: 'phone', label: 'Mobile', required: false, source: 'core', placeholder: 'e.g. 07946 060 543' },
            ],
          },
        ],
      },
    },
  });
  console.log(`Template: ${railTemplate.name} (${railTemplate.id})`);

  const fmTemplate = await prisma.formTemplate.upsert({
    where: { adminId_name: { adminId: admin.id, name: 'Facilities Management' } },
    update: {},
    create: {
      adminId: admin.id,
      name: 'Facilities Management',
      schema: {
        sections: [
          {
            key: 'references',
            title: 'References',
            fields: [
              { key: 'clientRef', type: 'text', label: 'Client Reference', required: false, source: 'core', placeholder: 'e.g. MIT-40201' },
            ],
          },
          {
            key: 'project',
            title: 'Job Details',
            fields: [
              { key: 'title', type: 'text', label: 'Title *', required: true, source: 'core', placeholder: 'e.g. HVAC Unit Failure — Building B' },
              { key: 'workType', type: 'select', label: 'Category', required: false, source: 'core', options: ['HVAC systems', 'Electrical', 'Plumbing', 'Fire safety', 'Access control', 'Lifts & escalators', 'Cleaning', 'Pest control', 'Other'] },
              { key: 'description', type: 'textarea', label: 'Description', required: false, source: 'core', placeholder: 'Describe the issue...' },
              { key: 'locationText', type: 'text', label: 'Building / Floor / Area', required: false, source: 'core', placeholder: 'e.g. Building B, Floor 3' },
            ],
          },
          {
            key: 'scheduling',
            title: 'Scheduling',
            fields: [
              { key: 'priority', type: 'select', label: 'SLA Priority', required: false, source: 'core', options: ['2h', '24h', '7d', '28d', 'Planned', 'Project'] },
              { key: 'plannedCompletion', type: 'datetime', label: 'Target Completion', required: false, source: 'core' },
            ],
          },
          {
            key: 'fm_custom',
            title: 'Facilities Info',
            fields: [
              { key: 'buildingZone', type: 'select', label: 'Building Zone', required: false, source: 'custom', options: ['Common areas', 'Office space', 'Plant room', 'External', 'Car park', 'Roof'] },
              { key: 'tenantAffected', type: 'text', label: 'Tenant Affected', required: false, source: 'custom', placeholder: 'e.g. Floor 3 — Deloitte' },
              { key: 'permitRequired', type: 'boolean', label: 'Permit to Work Required', required: false, source: 'custom' },
            ],
          },
          {
            key: 'contact',
            title: 'Site Contact',
            fields: [
              { key: 'onsiteContactName', type: 'text', label: 'Name', required: false, source: 'core' },
              { key: 'onsiteContactPhone', type: 'phone', label: 'Phone', required: false, source: 'core' },
              { key: 'onsiteContactEmail', type: 'email', label: 'Email', required: false, source: 'core' },
            ],
          },
        ],
      },
    },
  });
  console.log(`Template: ${fmTemplate.name} (${fmTemplate.id})`);

  // 4. Clients (with clientRefPrefix for project sequence)
  const clientNR = await prisma.client.upsert({
    where: { adminId_name: { adminId: admin.id, name: 'Network Rail' } },
    update: {},
    create: {
      adminId: admin.id,
      name: 'Network Rail',
      address: '1 Eversholt Street, London NW1 2DN',
      clientRefPrefix: 'NR',
      opsContactName: 'Oluwaseun Iyiola',
      opsContactEmail: 'oluwaseun.iyiola@networkrail.co.uk',
      opsContactPhone: '07860 655 985',
      comContactName: 'Rebecca Marshall',
      comContactEmail: 'contracts@networkrail.co.uk',
      comContactPhone: '020 7557 8000',
    },
  });
  console.log(`Client: ${clientNR.name} (${clientNR.id})`);

  const clientMitie = await prisma.client.upsert({
    where: { adminId_name: { adminId: admin.id, name: 'Mitie Group' } },
    update: {},
    create: {
      adminId: admin.id,
      name: 'Mitie Group',
      address: '35 Duchess Road, Rutherglen, Glasgow G73 1AU',
      clientRefPrefix: 'MG',
      opsContactName: 'Tom Brennan',
      opsContactEmail: 'tom.brennan@mitie.com',
      opsContactPhone: '0141 647 8787',
      comContactName: 'Laura Singh',
      comContactEmail: 'facilities.commercial@mitie.com',
      comContactPhone: '0141 647 8800',
    },
  });
  console.log(`Client: ${clientMitie.name} (${clientMitie.id})`);

  const clientCK = await prisma.client.upsert({
    where: { adminId_name: { adminId: admin.id, name: 'CK Rail' } },
    update: {},
    create: {
      adminId: admin.id,
      name: 'CK Rail',
      address: 'Unit 5, Ringway Trading Estate, Shadowmoss Road, Manchester M22 5LH',
      clientRefPrefix: 'CR',
      opsContactName: 'Mark Phillips',
      opsContactEmail: 'operations@ckrail.co.uk',
      opsContactPhone: '0161 998 4500',
      comContactName: 'Diane Foster',
      comContactEmail: 'accounts@ckrail.co.uk',
      comContactPhone: '0161 998 4501',
    },
  });
  console.log(`Client: ${clientCK.name} (${clientCK.id})`);

  // 5. Create project sequences for each client
  await prisma.projectSequence.upsert({
    where: { clientId: clientNR.id },
    update: { lastNumber: 3 },
    create: { adminId: admin.id, clientId: clientNR.id, prefix: 'NR', lastNumber: 3 },
  });
  await prisma.projectSequence.upsert({
    where: { clientId: clientMitie.id },
    update: { lastNumber: 2 },
    create: { adminId: admin.id, clientId: clientMitie.id, prefix: 'MG', lastNumber: 2 },
  });
  await prisma.projectSequence.upsert({
    where: { clientId: clientCK.id },
    update: { lastNumber: 2 },
    create: { adminId: admin.id, clientId: clientCK.id, prefix: 'CR', lastNumber: 2 },
  });
  console.log('Project sequences created');

  // Quotation sequences
  await prisma.quotationSequence.upsert({
    where: { clientId: clientNR.id },
    update: { lastNumber: 1 },
    create: { adminId: admin.id, clientId: clientNR.id, prefix: 'NR', lastNumber: 1 },
  });
  await prisma.quotationSequence.upsert({
    where: { clientId: clientMitie.id },
    update: { lastNumber: 0 },
    create: { adminId: admin.id, clientId: clientMitie.id, prefix: 'MG', lastNumber: 0 },
  });
  await prisma.quotationSequence.upsert({
    where: { clientId: clientCK.id },
    update: { lastNumber: 0 },
    create: { adminId: admin.id, clientId: clientCK.id, prefix: 'CR', lastNumber: 0 },
  });
  console.log('Quotation sequences created');

  // 6. Sample faults
  const existingFault = await prisma.fault.findUnique({ where: { projectRef: 'NR-0001' } });
  if (existingFault) {
    console.log('Faults already seeded — skipping');
    console.log('\n--- Seed complete ---');
    console.log('All accounts use password: Test1234!');
    console.log('Admin login:     admin@infrava.co.in');
    console.log('Operative login: operative@infrava.co.in');
    return;
  }

  // Network Rail faults
  const fault1 = await prisma.fault.create({
    data: {
      projectRef: 'NR-0001',
      clientRef: '01722878',
      companyRef: 'NR-01722878',
      title: 'Automatic Door Fault — Mitie Mess Room',
      workType: 'Automatic gates & doors',
      description: 'Mitie mess room in the undercroft - The automatic door makes a bang loud noise when closing.',
      adminId: admin.id,
      createdBy: admin.id,
      clientId: clientNR.id,
      faultDate: new Date('2026-02-26'),
      priority: '7d',
      timeAllocated: new Date('2026-02-26T15:58:00Z'),
      plannedArrival: new Date('2026-02-27T22:00:00Z'),
      plannedCompletion: new Date('2026-03-26T14:00:00Z'),
      locationText: 'Piccadilly Station Approach Manchester Greater Manchester M60 7RA',
      locationLat: 53.4774,
      locationLng: -2.2309,
      onsiteContactName: 'Oluwaseun Iyiola',
      onsiteContactPhone: '07860655985',
      onsiteContactEmail: 'oluwaseun.iyiola@networkrail.co.uk',
      visitTaskBriefing: true,
      visitSafeWorkPack: true,
      contractorCompany: 'T4 Engineering Ltd',
      contractorName: 'Tony Ledgerton',
      contractorEmail: 'workorders@t4eg.co.uk',
      contractorMobile: '07946 060 543',
      assignedOperativeId: operative.id,
      status: FaultStatus.ASSIGNED_TO_OPERATIVE,
    },
  });
  console.log(`Fault 1: ${fault1.projectRef} (${fault1.id}) → ${clientNR.name}`);

  const fault2 = await prisma.fault.create({
    data: {
      projectRef: 'NR-0002',
      clientRef: '01722999',
      companyRef: 'NR-01722999',
      title: 'Fire Exit Door — Platform 12',
      workType: 'Fire doors',
      description: 'Fire exit door not closing properly, latch mechanism faulty.',
      adminId: admin.id,
      createdBy: admin.id,
      clientId: clientNR.id,
      faultDate: new Date('2026-02-26'),
      priority: '24h',
      plannedCompletion: new Date('2026-02-28T14:00:00Z'),
      locationText: 'Manchester Piccadilly Platform 12',
      locationLat: 53.4773,
      locationLng: -2.2301,
      contractorCompany: 'T4 Engineering Ltd',
      contractorName: 'Tony Ledgerton',
      contractorEmail: 'workorders@t4eg.co.uk',
      status: FaultStatus.CREATED,
    },
  });
  console.log(`Fault 2: ${fault2.projectRef} (${fault2.id}) → ${clientNR.name}`);

  const fault3 = await prisma.fault.create({
    data: {
      projectRef: 'NR-0003',
      clientRef: '01723100',
      title: 'Broken Window — Ticket Office',
      workType: 'Glazing',
      description: 'Cracked window panel in ticket office, needs replacement.',
      adminId: admin.id,
      createdBy: admin.id,
      clientId: clientNR.id,
      faultDate: new Date('2026-03-01'),
      priority: '28d',
      plannedCompletion: new Date('2026-03-29T17:00:00Z'),
      locationText: 'Manchester Victoria Station Ticket Office',
      status: FaultStatus.CREATED,
    },
  });
  console.log(`Fault 3: ${fault3.projectRef} (${fault3.id}) → ${clientNR.name}`);

  // Mitie faults
  const fault4 = await prisma.fault.create({
    data: {
      projectRef: 'MG-0001',
      clientRef: 'MIT-40201',
      title: 'HVAC Unit Failure — Building B',
      workType: 'HVAC systems',
      description: 'Air handling unit on floor 3 is not circulating. Tenants reporting poor ventilation.',
      adminId: admin.id,
      createdBy: admin.id,
      clientId: clientMitie.id,
      faultDate: new Date('2026-03-10'),
      priority: '24h',
      plannedCompletion: new Date('2026-03-12T17:00:00Z'),
      locationText: 'Spinningfields, Building B, Floor 3, Manchester M3 3AN',
      assignedOperativeId: operative2.id,
      status: FaultStatus.ASSIGNED_TO_OPERATIVE,
    },
  });
  console.log(`Fault 4: ${fault4.projectRef} (${fault4.id}) → ${clientMitie.name}`);

  const fault5 = await prisma.fault.create({
    data: {
      projectRef: 'MG-0002',
      clientRef: 'MIT-40202',
      title: 'Emergency Lighting Test Failure — Lobby',
      workType: 'Electrical',
      description: 'Emergency lighting monthly test revealed 3 units in the main lobby not illuminating on battery power.',
      adminId: admin.id,
      createdBy: admin.id,
      clientId: clientMitie.id,
      faultDate: new Date('2026-03-15'),
      priority: '7d',
      plannedCompletion: new Date('2026-03-22T17:00:00Z'),
      locationText: 'Spinningfields, Building A, Ground Floor, Manchester M3 3AN',
      status: FaultStatus.CREATED,
    },
  });
  console.log(`Fault 5: ${fault5.projectRef} (${fault5.id}) → ${clientMitie.name}`);

  // CK Rail faults
  const fault6 = await prisma.fault.create({
    data: {
      projectRef: 'CR-0001',
      clientRef: 'CK-88001',
      title: 'Platform Edge Repair — Bay 4',
      workType: 'Civil works',
      description: 'Concrete spalling along platform edge at Bay 4, approximately 3m section. Trip hazard for passengers.',
      adminId: admin.id,
      createdBy: admin.id,
      clientId: clientCK.id,
      faultDate: new Date('2026-03-18'),
      priority: '2h',
      locationText: 'Stockport Station, Bay 4 Platform Edge',
      assignedOperativeId: operative3.id,
      status: FaultStatus.OPERATIVE_SUBMITTED,
    },
  });
  console.log(`Fault 6: ${fault6.projectRef} (${fault6.id}) → ${clientCK.name}`);

  const fault7 = await prisma.fault.create({
    data: {
      projectRef: 'CR-0002',
      clientRef: 'CK-88002',
      title: 'Signal Cable Trough Cover — Track Section 12',
      workType: 'Track infrastructure',
      description: 'Missing cable trough cover near signal gantry. Cables exposed to weather and potential damage.',
      adminId: admin.id,
      createdBy: admin.id,
      clientId: clientCK.id,
      faultDate: new Date('2026-03-20'),
      priority: 'Planned',
      plannedCompletion: new Date('2026-04-15T17:00:00Z'),
      locationText: 'Between Stockport and Cheadle Hulme, Track Section 12',
      visitPossession: true,
      visitTrackAccess: true,
      status: FaultStatus.CREATED,
    },
  });
  console.log(`Fault 7: ${fault7.projectRef} (${fault7.id}) → ${clientCK.name}`);

  // 7. Rate Cards (per client)
  // Network Rail rate cards
  await prisma.rateCard.createMany({
    data: [
      { adminId: admin.id, clientId: clientNR.id, category: 'Labour', resourceName: 'Site Manager', dayRateHourly: 30, nightRateHourly: 45, weekendRateHourly: 60, dayRateShift: 300, nightRateShift: 450, weekendRateShift: 600 },
      { adminId: admin.id, clientId: clientNR.id, category: 'Labour', resourceName: 'Electrician', dayRateHourly: 28, nightRateHourly: 42, weekendRateHourly: 56, dayRateShift: 280, nightRateShift: 420, weekendRateShift: 560 },
      { adminId: admin.id, clientId: clientNR.id, category: 'Labour', resourceName: 'General Operative', dayRateHourly: 18, nightRateHourly: 27, weekendRateHourly: 36, dayRateShift: 180, nightRateShift: 270, weekendRateShift: 360 },
      { adminId: admin.id, clientId: clientNR.id, category: 'Plant', resourceName: 'MEWP', dayRateHourly: 25, nightRateHourly: 37.5, weekendRateHourly: 50, dayRateShift: 250, nightRateShift: 375, weekendRateShift: 500 },
      { adminId: admin.id, clientId: clientNR.id, category: 'Plant', resourceName: 'Generators', dayRateHourly: 15, nightRateHourly: 22.5, weekendRateHourly: 30, dayRateShift: 150, nightRateShift: 225, weekendRateShift: 300 },
      { adminId: admin.id, clientId: clientNR.id, category: 'Material', resourceName: 'Concrete', dayRateHourly: 95, nightRateHourly: 95, weekendRateHourly: 95, dayRateShift: 95, nightRateShift: 95, weekendRateShift: 95 },
      { adminId: admin.id, clientId: clientNR.id, category: 'Material', resourceName: 'Steel Fixings', dayRateHourly: 45, nightRateHourly: 45, weekendRateHourly: 45, dayRateShift: 45, nightRateShift: 45, weekendRateShift: 45 },
    ],
  });
  console.log('Rate cards created for Network Rail');

  // Mitie rate cards
  await prisma.rateCard.createMany({
    data: [
      { adminId: admin.id, clientId: clientMitie.id, category: 'Labour', resourceName: 'HVAC Technician', dayRateHourly: 32, nightRateHourly: 48, weekendRateHourly: 64, dayRateShift: 320, nightRateShift: 480, weekendRateShift: 640 },
      { adminId: admin.id, clientId: clientMitie.id, category: 'Labour', resourceName: 'Electrician', dayRateHourly: 28, nightRateHourly: 42, weekendRateHourly: 56, dayRateShift: 280, nightRateShift: 420, weekendRateShift: 560 },
      { adminId: admin.id, clientId: clientMitie.id, category: 'Plant', resourceName: 'Access Tower', dayRateHourly: 12, nightRateHourly: 18, weekendRateHourly: 24, dayRateShift: 120, nightRateShift: 180, weekendRateShift: 240 },
    ],
  });
  console.log('Rate cards created for Mitie Group');

  // 8. Sample quotation for Network Rail
  await prisma.quotation.create({
    data: {
      adminId: admin.id,
      clientId: clientNR.id,
      quotationRef: 'NR-QT-0001',
      title: 'Platform Door Repair — Piccadilly',
      workDescription: 'Supply and install replacement automatic door closer mechanism at Mitie mess room in the undercroft area of Manchester Piccadilly station. Works include isolation of existing door power supply, removal of faulty unit, installation of new closer to manufacturer specification, recalibration of door speed and force parameters, and full functional testing. All works to be carried out in accordance with Network Rail standards and station operational requirements.',
      methodology: [
        { title: 'Methodology', content: 'Mobilise site team with appropriate PPE and tooling. Isolate power supply to automatic door system. Remove faulty closer mechanism and inspect mounting frame for damage. Install replacement closer unit and recalibrate door speed and force settings per manufacturer specifications. Test door cycle minimum 20 times and verify emergency breakout function. Clean work area and reinstate any displaced furniture or signage.' },
        { title: 'Risk Assessment', content: 'Working in public area — establish temporary barriers and signage to divert passengers during works. Ensure COSS arrangements in place if works encroach on platform edge yellow line zone. Electrical isolation required before any work on door mechanism — lock-off and tag procedure. Manual handling assessment for door panel removal (estimated 35kg). Noise assessment not required as works are within normal station ambient levels.' },
      ],
      enabledCategories: ['Labour', 'Plant', 'Material'],
      vatPercent: 20,
      status: 'DRAFT',
      items: {
        create: [
          { itemNo: 1, category: 'Labour', description: 'Site Manager', quantity: 1, unit: 'shift', rate: 300, uplift: 5, amount: 315 },
          { itemNo: 2, category: 'Labour', description: 'Electrician', quantity: 2, unit: 'shift', rate: 280, uplift: 5, amount: 588 },
          { itemNo: 3, category: 'Plant', description: 'MEWP', quantity: 1, unit: 'shift', rate: 250, uplift: 0, amount: 250 },
          { itemNo: 4, category: 'Material', description: 'Door Closer Unit', quantity: 1, unit: 'nr', rate: 185, uplift: 10, amount: 203.5 },
          { itemNo: 5, category: 'Material', description: 'Steel Fixings', quantity: 1, unit: 'lot', rate: 45, uplift: 0, amount: 45 },
        ],
      },
    },
  });
  console.log('Sample quotation created for Network Rail');

  // 9. Add a work day with punch events to fault1
  const workDay = await prisma.workDay.create({
    data: {
      faultId: fault1.id,
      dayNumber: 1,
      isLocked: true,
      events: {
        create: [
          { eventType: PunchEventType.PUNCH_IN, timestamp: new Date('2026-02-27T08:00:00Z'), lat: 53.4770, lng: -2.2305 },
          { eventType: PunchEventType.REACHED, timestamp: new Date('2026-02-27T08:45:00Z'), lat: 53.4774, lng: -2.2309 },
          { eventType: PunchEventType.WORK_DONE, timestamp: new Date('2026-02-27T16:00:00Z'), lat: 53.4774, lng: -2.2309 },
          { eventType: PunchEventType.PUNCH_OUT, timestamp: new Date('2026-02-27T16:30:00Z'), lat: 53.4771, lng: -2.2306 },
        ],
      },
    },
  });
  console.log(`Work day: Day ${workDay.dayNumber} for fault ${fault1.projectRef}`);

  console.log('\n--- Seed complete ---');
  console.log('All accounts use password: Test1234!');
  console.log('Super Admin login: superadmin@infrava.co.in');
  console.log('Admin login:       admin@infrava.co.in');
  console.log('Operative login:   operative@infrava.co.in');
  console.log(`\nClients: ${clientNR.name} (NR), ${clientMitie.name} (MG), ${clientCK.name} (CR)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
