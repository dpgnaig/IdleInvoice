import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny, z } from 'zod';

export interface Validated {
  body: unknown;
  query: unknown;
}

export function validate(schemas: { body?: ZodTypeAny; query?: ZodTypeAny }) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body) as never;
      if (schemas.query) (req as unknown as { validatedQuery: unknown }).validatedQuery = schemas.query.parse(req.query);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function q<T extends ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  const raw = (req as unknown as { validatedQuery?: unknown }).validatedQuery;
  return schema.parse(raw ?? req.query);
}
