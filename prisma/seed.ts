import { PrismaClient, UserRole, FaultStatus, PunchEventType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const passwordHash = await bcrypt.hash('Test1234!', 12);

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
      companyName: 'T4 Engineering Ltd',
    },
  });
  console.log(`Admin: ${admin.email} (${admin.id})`);

  // 2. Operative under Admin
  const operative = await prisma.user.upsert({
    where: { email: 'operative@infrava.co.in' },
    update: {},
    create: {
      name: 'Test Operative',
      email: 'operative@infrava.co.in',
      passwordHash,
      role: UserRole.OPERATIVE,
      adminId: admin.id,
    },
  });
  console.log(`Operative: ${operative.email} (${operative.id})`);

  // 3. Second operative (unassigned)
  const operative2 = await prisma.user.upsert({
    where: { email: 'operative2@infrava.co.in' },
    update: {},
    create: {
      name: 'Jane Smith',
      email: 'operative2@infrava.co.in',
      passwordHash,
      role: UserRole.OPERATIVE,
      adminId: admin.id,
    },
  });
  console.log(`Operative 2: ${operative2.email} (${operative2.id})`);

  // 4. Sample faults
  const fault1 = await prisma.fault.create({
    data: {
      clientRef: '01722878',
      companyRef: 'CK-01722878',
      title: 'Automatic Door Fault — Mitie Mess Room',
      workType: 'Automatic gates & doors',
      description: 'Mitie mess room in the undercroft - The automatic door makes a bang loud noise when closing.',
      adminId: admin.id,
      createdBy: admin.id,
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
  console.log(`Fault 1: ${fault1.clientRef} (${fault1.id})`);

  const fault2 = await prisma.fault.create({
    data: {
      clientRef: '01722999',
      companyRef: 'CK-01722999',
      title: 'Fire Exit Door — Platform 12',
      workType: 'Fire doors',
      description: 'Fire exit door not closing properly, latch mechanism faulty.',
      adminId: admin.id,
      createdBy: admin.id,
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
  console.log(`Fault 2: ${fault2.clientRef} (${fault2.id})`);

  const fault3 = await prisma.fault.create({
    data: {
      clientRef: '01723100',
      title: 'Broken Window — Ticket Office',
      workType: 'Glazing',
      description: 'Cracked window panel in ticket office, needs replacement.',
      adminId: admin.id,
      createdBy: admin.id,
      faultDate: new Date('2026-03-01'),
      priority: '28d',
      plannedCompletion: new Date('2026-03-29T17:00:00Z'),
      locationText: 'Manchester Victoria Station Ticket Office',
      status: FaultStatus.CREATED,
    },
  });
  console.log(`Fault 3: ${fault3.clientRef} (${fault3.id})`);

  // 5. Add a work day with punch events to fault1 (to demo GPS tracking)
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
  console.log(`Work day: Day ${workDay.dayNumber} for fault ${fault1.clientRef}`);

  console.log('\n--- Seed complete ---');
  console.log('All accounts use password: Test1234!');
  console.log('Admin login:     admin@infrava.co.in');
  console.log('Operative login: operative@infrava.co.in');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
