# CLAUDE.md — infrava-api

## Project Overview

Backend API for Infrava, a fault reporting and field service management platform. Serves two frontends: admin dashboard (desktop) and operative app (mobile WebView). The frontend repo is at `../infrava-web`.

## Architecture

- **Express 5 + TypeScript** with modular route/controller/schema pattern
- **Prisma 6** ORM with PostgreSQL
- **JWT auth** with access (15m) + refresh (7d) token pair
- **Cloudflare R2** for photo and report storage
- **Resend** for transactional emails
- **Zod** for request validation

### Module Pattern

Each module (`auth`, `admin`, `operative`, `internal`) follows:
```
module/
├── module.routes.ts      # Route definitions with middleware
├── module.controller.ts  # Request handlers (async, typed)
└── module.schemas.ts     # Zod schemas + exported types
```

Controllers use `AuthRequest` (extends Express `Request` with `req.user`).

## Key Concepts

### Authentication Flow
1. Login returns `accessToken` (JWT, 15m) + `refreshToken` (stored in DB)
2. Frontend sends `Authorization: Bearer <accessToken>`
3. `auth.middleware.ts` verifies token, loads user, sets `req.user`
4. On 401, frontend hits `/auth/refresh` with refresh token
5. JWT payload: `{ sub: userId, email, role, adminId }`

### Authorization (RBAC)
- `requireRoles([UserRole.ADMIN])` — role gate
- `requireAdminScope()` — ensures fault belongs to requesting admin (`fault.adminId === req.user.id`)
- `requireSelfOrAdmin()` — operative can only access own assigned faults

### Admin-Operative Relationship
- `User.adminId` — every operative points to their admin
- When admin assigns a fault to an email, `findOrCreateUser.ts` creates the operative with `adminId` set
- All admin queries are scoped: `where: { adminId: req.user.id }`
- Operatives cannot be shared across admins

### Fault Status Flow
```
CREATED → ASSIGNED_TO_OPERATIVE → OPERATIVE_SUBMITTED → ADMIN_SUBMITTED → COMPLETED
                                ↘ REJECTED (back to operative)
                                ↘ REASSIGNED (new operative)
```

### Email Notifications
Emails are sent via **Resend** SDK (set `RESEND_API_KEY` env var). Without it, emails are logged to console.

| Trigger | Email Function | Sent To |
|---------|---------------|---------|
| Admin assigns fault (new operative) | `sendWelcomeAndTaskEmail` | Operative |
| Admin assigns fault (existing operative) | `sendTaskNotificationEmail` | Operative |
| Admin rejects fault | `sendFaultRejectedEmail` | Operative |
| Operative submits fault | `sendFaultSubmittedEmail` | Admin |
| Admin final-submits fault | `sendFaultCompletedEmail` | Admin |
| Password reset request | `sendPasswordResetEmail` | User |
| Admin signup | `sendEmailVerification` | Admin |

All emails use a shared branded HTML layout (`emailLayout()` in `email.service.ts`). Email sending is fire-and-forget (`.catch()` on the promise) — failures are logged but don't block the API response.

### GDPR Data Deletion
- Operatives request deletion via `POST /operative/deletion-request`
- Admin sees requests scoped to their operatives at `GET /admin/deletion-requests`
- Admin approves/rejects via `PATCH /admin/deletion-requests/:id`
- Approval sets `User.isActive = false` (soft delete — auth middleware blocks inactive users)

## Build & Check

```bash
npx tsc --noEmit    # Type check without emitting
npm run dev         # Dev server with tsx watch on :4000
npm run build       # Compile to dist/
```

## Database

```bash
npm run db:migrate   # Apply migrations
npm run db:push      # Push schema changes (dev only)
npm run db:studio    # Prisma Studio GUI
npm run db:seed      # Seed data
```

Schema is at `prisma/schema.prisma`. Key models: `User`, `Fault`, `WorkDay`, `PunchEvent`, `FaultPhoto`, `DataDeletionRequest`.

## Things to Watch Out For

- **Soft deletes**: Photos use `deletedAt` (not hard delete). Users use `isActive = false`. Always filter by `deletedAt: null` for photos and `isActive: true` for users.
- **Admin scoping**: Every admin query MUST filter by `adminId: req.user.id`. Missing this is a data leak.
- **Operative scoping**: Every operative query MUST filter by `assignedOperativeId: req.user.id`.
- **File uploads**: Multer with 10MB limit. Photos go to R2 via presigned URLs. DOCX files are parsed server-side.
- **Punch events**: Exactly 4 per work day in sequence: `PUNCH_IN → REACHED → WORK_DONE → PUNCH_OUT`. After `PUNCH_OUT`, the work day is locked (`isLocked = true`).
- **findOrCreateUser.ts**: Creates operative accounts on first fault assignment. Generates temp password and sends welcome email. Enforces one-admin-per-operative.
