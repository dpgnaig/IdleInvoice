import { getDb } from '../db/index.js';
import { auditLogs } from '../db/schema.js';

export function writeAudit(
  userId: number | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  detail: unknown = {},
): void {
  const now = new Date().toISOString();
  getDb()
    .insert(auditLogs)
    .values({
      userId,
      action,
      entity,
      entityId: entityId === null ? '' : String(entityId),
      detailJson: JSON.stringify(detail),
      createdAt: now,
      updatedAt: now,
    })
    .run();
}
