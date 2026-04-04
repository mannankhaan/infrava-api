# Infrava API

Backend for the Infrava fault reporting and field service management platform. Built with Express 5, Prisma, PostgreSQL, and TypeScript.

## Tech Stack

- **Framework:** Express 5
- **Language:** TypeScript
- **ORM:** Prisma 6
- **Database:** PostgreSQL
- **Auth:** JWT (access + refresh tokens), bcrypt
- **Storage:** Cloudflare R2 (photos, reports)
- **Email:** Resend
- **Validation:** Zod
- **Security:** Helmet, CORS, rate limiting

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env — fill in DATABASE_URL, JWT secrets, R2 credentials, etc.

# Run database migrations
npm run db:migrate

# Seed database (optional)
npm run db:seed

# Run development server
npm run dev
```

Server starts on `http://localhost:4000`. The frontend ([infrava-web](../infrava-web)) connects to this.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Yes | Access token secret (min 64 chars) |
| `JWT_REFRESH_SECRET` | Yes | Refresh token secret (min 64 chars) |
| `JWT_ACCESS_EXPIRES_IN` | No | Default: `15m` |
| `JWT_REFRESH_EXPIRES_IN` | No | Default: `7d` |
| `R2_ACCOUNT_ID` | Yes | Cloudflare R2 account |
| `R2_ACCESS_KEY_ID` | Yes | R2 access key |
| `R2_SECRET_ACCESS_KEY` | Yes | R2 secret key |
| `R2_BUCKET_NAME` | Yes | R2 bucket name |
| `RESEND_API_KEY` | Yes | Resend email API key |
| `CRON_SECRET` | Yes | Internal cron job auth (min 64 chars) |
| `INTERNAL_SECRET` | Yes | Internal API auth (min 64 chars) |
| `PORT` | No | Default: `4000` |
| `NODE_ENV` | No | Default: `development` |

## Project Structure

```
src/
├── server.ts                  # Entry point
├── app.ts                     # Express app config, middleware, routes
├── config/
│   ├── env.ts                 # Environment validation
│   └── prisma.ts              # Prisma client instance
├── modules/
│   ├── auth/                  # Authentication (login, signup, tokens, password reset)
│   ├── admin/                 # Admin operations (faults, queue, operatives, analytics, GDPR)
│   ├── operative/             # Operative operations (faults, work days, punching, photos, deletion request)
│   └── internal/              # Cron jobs (report generation, photo cleanup)
├── shared/
│   ├── middleware/
│   │   ├── auth.middleware.ts  # JWT verification, sets req.user
│   │   ├── rbac.middleware.ts  # Role checks, admin scope, operative scope
│   │   ├── validate.middleware.ts  # Zod schema validation
│   │   └── audit.middleware.ts # Audit logging for mutations
│   └── services/
│       ├── token.service.ts    # JWT generation/verification
│       ├── email.service.ts    # Transactional emails via Resend
│       ├── storage.service.ts  # R2 upload/download/delete
│       ├── docx-parser.service.ts  # Parse fault data from DOCX
│       └── findOrCreateUser.ts # Create operative on first assignment
├── jobs/
│   ├── report.job.ts          # EOD report PDF generation
│   └── photo-cleanup.job.ts   # Soft-deleted photo cleanup
└── types/
    └── index.ts               # Shared types (AuthRequest, enums)
```

## API Routes

### Auth (`/api/v1/auth`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/signup` | Register new user |
| POST | `/verify-email` | Verify email token |
| POST | `/login` | Login, returns access + refresh tokens |
| POST | `/refresh` | Refresh access token |
| POST | `/logout` | Invalidate refresh token |
| POST | `/forgot-password` | Send password reset email |
| POST | `/reset-password` | Reset password with token |
| POST | `/change-password` | Change password (authenticated) |

### Admin (`/api/v1/admin`) — requires ADMIN role
| Method | Path | Description |
|--------|------|-------------|
| GET | `/faults` | List all faults |
| POST | `/faults` | Create fault |
| GET | `/faults/:id` | Get fault detail |
| PATCH | `/faults/:id` | Update fault |
| DELETE | `/faults/:id` | Delete fault |
| POST | `/faults/parse-docx` | Parse fault from DOCX upload |
| GET | `/queue` | List queue faults |
| GET | `/queue/:id` | Get queue item detail |
| POST | `/queue/:id/assign-operative` | Assign operative to fault |
| POST | `/queue/:id/reassign` | Reassign to different operative |
| POST | `/queue/:id/reject` | Reject with feedback |
| POST | `/queue/:id/final-submit` | Final submission |
| GET | `/operatives` | List operatives |
| POST | `/operatives` | Create operative |
| PATCH | `/operatives/:id` | Update operative |
| DELETE | `/operatives/:id` | Deactivate operative |
| GET | `/analytics` | Dashboard analytics |
| GET | `/reports` | List EOD reports |
| GET | `/reports/:id/download` | Download report PDF |
| GET | `/audit-logs` | List audit logs |
| GET | `/deletion-requests` | List GDPR deletion requests |
| PATCH | `/deletion-requests/:id` | Approve/reject deletion request |

### Operative (`/api/v1/operative`) — requires OPERATIVE role
| Method | Path | Description |
|--------|------|-------------|
| GET | `/faults` | List assigned faults |
| GET | `/faults/:id` | Get fault detail with work days |
| PATCH | `/faults/:id` | Update fault fields |
| POST | `/faults/:id/submit` | Submit fault to admin |
| POST | `/faults/:id/work-days` | Add new work day |
| PATCH | `/faults/:id/work-days/:dayId` | Update work day data |
| POST | `/faults/:id/work-days/:dayId/punch` | Record GPS punch event |
| POST | `/faults/:id/photos/presign` | Get presigned upload URL |
| POST | `/faults/:id/photos` | Register uploaded photo |
| DELETE | `/faults/:id/photos/:pid` | Soft-delete photo |
| POST | `/deletion-request` | Request GDPR data deletion |

## Email Notifications

Transactional emails via [Resend](https://resend.com). Set `RESEND_API_KEY` in `.env`. Without it, emails are logged to console for development.

| Event | Email | Recipient |
|-------|-------|-----------|
| Fault assigned (new operative) | Welcome + credentials + fault details | Operative |
| Fault assigned (existing operative) | Fault details | Operative |
| Fault rejected by admin | Rejection reason + resubmit prompt | Operative |
| Fault submitted by operative | Ready-for-review notification | Admin |
| Fault completed (final submit) | Completion confirmation | Admin |
| Password reset requested | Reset link (1h expiry) | User |
| Admin signup | Verification link (24h expiry) | Admin |

All emails use a branded HTML template with Infrava header, styled body, and CTA buttons. Defined in `src/shared/services/email.service.ts`.

## Data Model

### Key Relationships
- **Admin → Operatives**: Self-referencing `User.adminId`. Each operative belongs to one admin.
- **Admin → Faults**: `Fault.adminId`. Faults are scoped to the creating admin.
- **Fault → Operative**: `Fault.assignedOperativeId`. One operative per fault.
- **Fault → WorkDays → PunchEvents**: Per-day reports with GPS timestamped events.
- **Fault → Photos**: Before/during/after photos stored in R2.

### Fault Status Flow
```
CREATED → ASSIGNED_TO_OPERATIVE → OPERATIVE_SUBMITTED → ADMIN_SUBMITTED → COMPLETED
                                ↘ REJECTED
                                ↘ REASSIGNED
```

## Scripts

```bash
npm run dev          # Dev server with hot reload (tsx watch)
npm run build        # TypeScript compilation to dist/
npm run start        # Run compiled server
npm run db:migrate   # Run Prisma migrations
npm run db:push      # Push schema to DB (no migration)
npm run db:seed      # Seed database
npm run db:studio    # Open Prisma Studio
npm run db:reset     # Reset database
```
