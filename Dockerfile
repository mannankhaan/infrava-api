FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Copy assets (logo for PDF reports)
COPY assets ./assets

# ── Production image ──
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets ./assets

# tsx needed for seed script
RUN npm install tsx

EXPOSE 4000

CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && npx prisma db execute --file prisma/fix-trigger.sql --schema prisma/schema.prisma; npx tsx prisma/seed.ts; node dist/server.js"]
