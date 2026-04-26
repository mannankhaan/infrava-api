import { prisma } from '../../config/prisma';

/**
 * Create a quotation sequence row for a new client.
 * Called during client creation alongside createProjectSequence.
 */
export async function createQuotationSequence(adminId: string, clientId: string, prefix: string): Promise<void> {
  await prisma.quotationSequence.create({
    data: { adminId, clientId, prefix, lastNumber: 0 },
  });
}

/**
 * Atomically increment the quotation sequence counter and return the next quotationRef.
 * Uses raw SQL UPDATE...RETURNING for concurrency safety.
 * Returns e.g. "NR-QT-0001"
 */
export async function generateQuotationRef(clientId: string): Promise<string> {
  const result = await prisma.$queryRaw<{ prefix: string; last_number: number }[]>`
    UPDATE quotation_sequences
    SET last_number = last_number + 1
    WHERE client_id = ${clientId}::uuid
    RETURNING prefix, last_number
  `;

  if (!result || result.length === 0) {
    throw new Error(`No quotation sequence found for client ${clientId}`);
  }

  const { prefix, last_number } = result[0];
  const padded = String(last_number).padStart(4, '0');
  return `${prefix}-QT-${padded}`;
}
