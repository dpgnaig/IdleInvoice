import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { normalizeTaxCode } from '../lib/normalize.js';
import { lastPrice } from '../services/quotes.js';

export const historyRouter: Router = Router();

/** GET /api/history/last-price?customer=<MST>&product=<mã hàng> */
historyRouter.get(
  '/last-price',
  asyncHandler(async (req, res) => {
    const q = z
      .object({ customer: z.string().trim().min(1), product: z.string().trim().min(1) })
      .parse(req.query);
    res.json(lastPrice(normalizeTaxCode(q.customer), q.product));
  }),
);
