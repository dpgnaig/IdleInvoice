import crypto from 'node:crypto';

/** Trạng thái xử lý của một file báo giá trong phiên tải lên. */
export type JobStage =
  | 'queued'
  | 'parsing'
  | 'matching'
  | 'fuzzy'
  | 'ai'
  | 'tax_lookup'
  | 'done'
  | 'error';

export interface JobFile {
  name: string;
  stage: JobStage;
  pct: number;
  message?: string;
  /** Provider/model AI đã trả lời cho file này (hiện khi đã qua bước AI). */
  aiProviders?: string[];
  /** Draft cuối cùng — không trả ra khi job còn chạy. */
  draft?: unknown;
}

export interface QuoteJob {
  id: string;
  status: 'running' | 'done';
  createdAt: number;
  files: JobFile[];
}

const jobs = new Map<string, QuoteJob>();
const TTL_MS = 30 * 60_000;

function prune(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > TTL_MS) jobs.delete(id);
  }
}

export function createJob(names: string[]): QuoteJob {
  prune();
  const job: QuoteJob = {
    id: crypto.randomUUID(),
    status: 'running',
    createdAt: Date.now(),
    files: names.map((name) => ({ name, stage: 'queued', pct: 5 })),
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): QuoteJob | undefined {
  return jobs.get(id);
}

export function updateFile(id: string, index: number, patch: Partial<JobFile>): void {
  const file = jobs.get(id)?.files[index];
  if (file) Object.assign(file, patch);
}

export function finishJob(id: string): void {
  const job = jobs.get(id);
  if (job) job.status = 'done';
}

/**
 * Payload gửi cho client: bỏ draft khi file chưa xong để polling nhẹ.
 * Mỗi file trả `draft` ngay khi CHÍNH NÓ xong (done/error) — không đợi cả phiên
 * tải lên kết thúc, để UI hiện báo giá đã đọc xong ngay, file còn lại vẫn
 * thấy đang xử lý song song.
 */
export function jobView(job: QuoteJob) {
  return {
    id: job.id,
    status: job.status,
    files: job.files.map(({ draft: _draft, ...rest }) => rest),
    drafts: job.files.map((f) => f.draft).filter(Boolean),
  };
}
