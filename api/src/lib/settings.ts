import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { appSettings } from '../db/schema.js';

export function getSetting(key: string): string | null {
  const row = getDb().select().from(appSettings).where(eq(appSettings.key, key)).get();
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  if (existing) {
    db.update(appSettings).set({ value, updatedAt: now }).where(eq(appSettings.key, key)).run();
  } else {
    db.insert(appSettings).values({ key, value, createdAt: now, updatedAt: now }).run();
  }
}

export function isSetupCompleted(): boolean {
  return getSetting('setup_completed') === 'true';
}
