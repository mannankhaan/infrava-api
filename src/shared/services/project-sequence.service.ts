import { prisma } from '../../config/prisma';

/**
 * Generate a client prefix from the client name.
 * - Multi-word: first letter of each word, max 4 chars (e.g. "Network Rail" → "NR")
 * - Single word: first 3 chars (e.g. "Metropolitan" → "MET")
 * - Uppercased, stripped of special chars
 */
export function derivePrefix(clientName: string): string {
  const cleaned = clientName.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);

  let raw: string;
  if (words.length >= 2) {
    raw = words.slice(0, 4).map((w) => w[0]).join('');
  } else {
    raw = (words[0] || 'PRJ').substring(0, 3);
  }

  return raw.toUpperCase();
}

/**
 * Resolve a unique prefix for a client within a company (adminId scope).
 * If "NR" is taken, tries "NR1", "NR2", etc.
 */
export async function resolveUniquePrefix(adminId: string, clientName: string): Promise<string> {
  const base = derivePrefix(clientName);

  const existing = await prisma.projectSequence.findUnique({
    where: { adminId_prefix: { adminId, prefix: base } },
  });

  if (!existing) return base;

  // Collision — try numeric suffixes
  for (let i = 1; i <= 99; i++) {
    const candidate = `${base}${i}`;
    const taken = await prisma.projectSequence.findUnique({
      where: { adminId_prefix: { adminId, prefix: candidate } },
    });
    if (!taken) return candidate;
  }

  // Extremely unlikely fallback
  throw new Error(`Unable to generate unique prefix for "${clientName}" — too many collisions`);
}

/**
 * Create a project sequence row for a new client.
 * Called during client creation.
 */
export async function createProjectSequence(adminId: string, clientId: string, prefix: string): Promise<void> {
  await prisma.projectSequence.create({
    data: { adminId, clientId, prefix, lastNumber: 0 },
  });
}

/**
 * Atomically increment the sequence counter and return the next projectRef.
 * Uses raw SQL UPDATE...RETURNING for concurrency safety.
 * Returns e.g. "NR-0001"
 */
export async function generateProjectRef(clientId: string): Promise<string> {
  const result = await prisma.$queryRaw<{ prefix: string; last_number: number }[]>`
    UPDATE project_sequences
    SET last_number = last_number + 1
    WHERE client_id = ${clientId}::uuid
    RETURNING prefix, last_number
  `;

  if (!result || result.length === 0) {
    throw new Error(`No project sequence found for client ${clientId}`);
  }

  const { prefix, last_number } = result[0];
  const padded = String(last_number).padStart(4, '0');
  return `${prefix}-${padded}`;
}
