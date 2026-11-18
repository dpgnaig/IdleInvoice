import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_PATH: z.string().default('./data/app.db'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET phải >= 32 ký tự'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET phải >= 32 ký tự'),
  INTERNAL_KEY: z.string().min(8),
  PARSER_URL: z.string().default('http://localhost:8001'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  REGISTRATION_MODE: z.enum(['open', 'approval', 'closed']).default('approval'),
  SERVE_WEB: z.string().optional(),
  TAX_LOOKUP_ENABLED: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) cached = envSchema.parse(process.env);
  return cached;
}
