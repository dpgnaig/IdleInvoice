/**
 * Bổ sung bằng AI cho draft báo giá:
 *  1. Xác định khách hàng: chuẩn hoá tên công ty (sửa lỗi đọc/viết tắt) và/hoặc
 *     đoán MST, tra VietQR để lấy thông tin đăng ký chính thức.
 *  2. Chọn mã hàng chính xác nhất từ các ứng viên do bộ ghép nối tất định trả về.
 *  3. Tách tên hàng / thương hiệu / model / mô tả từ một ô mô tả lẫn lộn.
 *
 * Mọi bước đều KHÔNG throw và chỉ là gợi ý: kết quả tất định vẫn được giữ nếu AI
 * không trả lời hoặc trả lời ngoài danh sách hợp lệ.
 */
import { getDb } from '../db/index.js';
import { customers } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { normalizeTaxCode, normalizeText, simplifyCompanyName } from '../lib/normalize.js';
import { z } from 'zod';
import { aiCompleteWithProvider, extractJson, mapLimit } from './ai.js';
import { aiGlobalEnabled } from './ai-providers.js';
import type { ParsedQuote } from './parser-client.js';
import { fetchTaxInfo } from './tax-lookup.js';
import { candidatesForAi, confidentCustomer, tokenScore, type CustomerMatch, type ProductMatch } from './match.js';

const AI_BULK_DEADLINE_MS = Number(process.env.AI_BULK_DEADLINE_MS ?? 20_000);
const AI_LINES_DEADLINE_MS = Number(process.env.AI_LINES_DEADLINE_MS ?? 20_000);
const AI_LINE_CONCURRENCY = Number(process.env.AI_LINE_CONCURRENCY ?? 3);
// Dưới ngưỡng này, gợi ý của AI vẫn được áp dụng nhưng kèm cảnh báo "cần soát lại"
// thay vì âm thầm tin tưởng tuyệt đối — field confidence AI trả về giờ được dùng thật.
const LOW_CONFIDENCE = 0.5;
// Chặn input phình to không kiểm soát (tên/spec quá dài, danh sách biết quá nhiều dòng)
// trước khi đưa vào prompt — giữ chi phí/độ trễ ổn định bất kể dữ liệu nguồn.
const MAX_FIELD_LEN = 300;
const MAX_SPEC_LEN = 800;

function clamp(s: string, max = MAX_FIELD_LEN): string {
  const v = (s ?? '').trim();
  return v.length > max ? `${v.slice(0, max)}…` : v;
}

/** Ghi nhận provider đã trả lời; các lần gọi song song cùng provider chỉ ghi một lần. */
function noteProvider(status: AiStatus, provider: string): void {
  if (!status.providers.includes(provider)) status.providers.push(provider);
}

export interface AiStatus {
  /** Có ít nhất một provider trả lời trong thời gian cho phép. */
  ran: boolean;
  /** Provider/model đã thực sự trả lời (có thể nhiều nếu lần gọi khác nhau gặp lỗi). */
  providers: string[];
  /** Đã dùng cho khách hàng. */
  customer?: string;
  /** Số dòng hàng AI đã chỉnh/bổ sung. */
  lines?: number;
  notes: string[];
}

export interface LineSuggestion {
  name?: string;
  brand?: string;
  model?: string;
  desc?: string;
  /** id sản phẩm được chọn trong danh sách ứng viên. */
  productId?: number;
  /** Ứng viên đầy đủ để tầng trộn không phải tra lại danh mục. */
  product?: { id: number; code: string; name: string; unit: string };
}

export interface CustomerEnrichment {
  customerMatch: CustomerMatch;
  /** Thông tin đăng ký từ VietQR (nếu tìm được). */
  info?: { taxCode: string; name: string; address: string; status?: string; source: string };
}

export interface AiEnrichment {
  customer?: CustomerEnrichment;
  /** Gợi ý theo chỉ số dòng trong `parsed.lines`. */
  lines: Record<number, LineSuggestion>;
  status: AiStatus;
}

/**
 * Gợi ý từ bước tìm tương tự (rapidfuzz) chạy trước AI:
 *  - shortlist khách hàng đã xếp hạng để đưa vào prompt,
 *  - ứng viên mã hàng theo từng dòng (kết hợp mã + mô tả),
 *  - các phần đã khớp chắc thì AI bỏ qua cho đỡ tốn thời gian/token.
 */
export interface AiFuzzyHints {
  customerShortlist?: Array<{ name: string; taxCode: string; score: number }>;
  candidates?: Record<number, Array<{ id: number; code: string; name: string; unit: string }>>;
  skipCustomer?: boolean;
  resolvedLineIndexes?: number[];
}

const CUSTOMER_PROMPT = (input: { name: string; tax: string; known: string }) => `Bạn chuẩn hoá thông tin doanh nghiệp Việt Nam trong một báo giá.
Tên đọc được: "${input.name || '(không có)'}"
MST đọc được: "${input.tax || '(không có)'}"

Nhiệm vụ:
1. Sửa lỗi chính tả/khoảng trắng trong tên (giữ đủ loại hình: CÔNG TY TNHH, CỔ PHẦN...).
2. Nếu không có MST, chỉ điền MST khi chắc chắn; không bịa.
3. Nếu tên quá mơ hồ, chọn tên gần nhất trong danh sách đã biết nếu có căn cứ.

Trả JSON đúng định dạng, không giải thích:
{"name":"<tên đầy đủ>","taxCode":"<10 hoặc 10-3 chữ số hoặc \\"\\">","confidence":<0..1, mức tin cậy của chính bạn>}
Danh sách doanh nghiệp đã biết: ${input.known || '(trống)'}`;

const customerAiSchema = z.object({
  name: z.string().max(500).optional(),
  taxCode: z.string().max(20).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

type CustomerAiResponse = z.infer<typeof customerAiSchema>;

async function resolveCustomerAi(
  pq: ParsedQuote,
  status: AiStatus,
  hints?: AiFuzzyHints,
): Promise<CustomerEnrichment | undefined> {
  const name = clamp((pq.buyer_name ?? '').trim());
  const tax = normalizeTaxCode(pq.buyer_tax_code ?? '');
  if (!name && !tax) return undefined;

  const db = getDb();
  const all = db.select().from(customers).all();

  // MST đủ 10 chữ số là căn cứ duy nhất. Có trong danh mục thì khớp thẳng;
  // chưa có thì để bước tra cứu MST xử lý — không đoán theo tên gần giống.
  if (tax.length >= 10) {
    const local = all.find((c) => normalizeTaxCode(c.taxCode) === tax);
    if (local) {
      status.customer = 'khớp theo MST';
      return {
        customerMatch: {
          status: 'matched',
          customerId: local.id,
          customer: toCustomerLite(local),
          method: 'tax_code',
        },
      };
    }
    status.notes.push(`MST ${tax} chưa có trong danh mục — tra cứu theo MST`);
    return undefined;
  }

  // Ứng viên gần đúng từ TOÀN BỘ danh sách để LLM có mỏ neo, tránh sửa tên thành công ty khác.
  // Ưu tiên shortlist rapidfuzz đã xếp hạng (nếu có) thay vì tự chấm lại.
  let known = '';
  if (hints?.customerShortlist?.length) {
    known = hints.customerShortlist
      .slice(0, 20)
      .map((c) => `${c.name} | MST ${c.taxCode}`)
      .join('\n');
  } else {
    const simple = simplifyCompanyName(name);
    const normName = normalizeText(name);
    const shortlist = simple
      ? all
          .map((c) => ({
            c,
            score: Math.max(
              tokenScore(simple, simplifyCompanyName(c.name)),
              normalizeText(c.name) === normName ? 1 : 0,
            ),
          }))
          .filter((s) => s.score >= 0.3)
          .sort((a, b) => b.score - a.score)
          .slice(0, 20)
      : [];
    known = shortlist.map(({ c }) => `${c.name} | MST ${c.taxCode}`).join('\n');
  }

  const res = await aiCompleteWithProvider(
    CUSTOMER_PROMPT({ name, tax, known }),
    Date.now() + AI_BULK_DEADLINE_MS,
    { task: 'customer' },
  );
  if (!res) return undefined;
  noteProvider(status, res.provider);
  const parsed = extractJson<CustomerAiResponse>(res.text, customerAiSchema);
  if (!parsed) {
    logger.debug({ provider: res.provider }, 'AI khách hàng: phản hồi không parse được / sai schema');
    return undefined;
  }
  if (parsed.confidence != null && parsed.confidence < LOW_CONFIDENCE) {
    status.notes.push(`AI chỉ tin cậy ${Math.round(parsed.confidence * 100)}% về khách hàng này — kiểm tra lại`);
  }

  const candidateName = (parsed.name ?? '').trim();
  const candidateTax = normalizeTaxCode(parsed.taxCode ?? '');
  status.customer = candidateName || candidateTax ? 'có gợi ý' : 'không đổi';

  // 1. MST do AI tìm ra trùng danh mục
  if (candidateTax) {
    if (tax && candidateTax !== tax) {
      status.notes.push(`AI gợi ý MST ${candidateTax} khác MST trong file (${tax}) — kiểm tra lại`);
    }
    const local = all.find((c) => normalizeTaxCode(c.taxCode) === candidateTax);
    if (local) {
      return {
        customerMatch: {
          status: 'matched',
          customerId: local.id,
          customer: toCustomerLite(local),
          method: 'ai_tax_code',
        },
      };
    }
    const looked = await fetchTaxInfo(candidateTax);
    if (looked.info) {
      return {
        customerMatch: {
          status: 'new_customer',
          customerId: null,
          method: 'ai_tax_lookup',
          candidates: [],
        },
        info: {
          taxCode: candidateTax,
          name: looked.info.name,
          address: looked.info.address,
          status: looked.info.status,
          source: looked.info.source,
        },
      };
    }
  }

  // 2. Không có MST: dựa vào tên (AI đã chuẩn hoá) để chấm lại trên toàn bộ danh sách
  const lookupName = candidateName || name;
  if (!lookupName) return undefined;
  const norm = normalizeText(lookupName);
  const simpleLookup = simplifyCompanyName(lookupName);
  const scored = all
    .map((c) => {
      const nameScore = tokenScore(simpleLookup, simplifyCompanyName(c.name));
      const exact = normalizeText(c.name) === norm ? 1 : 0;
      return { c, score: Math.max(nameScore, exact) };
    })
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (!scored.length) {
    status.notes.push('AI không tìm thấy khách hàng khớp trong danh mục');
    return undefined;
  }
  if (confidentCustomer(scored)) {
    return {
      customerMatch: {
        status: 'matched',
        customerId: scored[0]!.c.id,
        customer: toCustomerLite(scored[0]!.c),
        method: 'ai_name',
      },
    };
  }
  return {
    customerMatch: {
      status: 'candidate',
      customerId: null,
      candidates: scored.map((s) => ({
        id: s.c.id,
        taxCode: s.c.taxCode,
        name: s.c.name,
        score: Math.round(s.score * 100) / 100,
      })),
    },
  };
}

const LINE_PROMPT = (input: {
  line: { name: string; model: string; brand: string; origin: string; spec: string; unit: string };
  candidates: Array<{ id: number; code: string; name: string; unit: string }>;
}) => `Bạn đối chiếu một dòng hàng trong báo giá thiết bị Việt Nam với danh mục mã hàng của công ty.
Dòng trong báo giá:
- Tên: "${input.line.name}"
- Model/mã trên báo giá: "${input.line.model || '(không có)'}"
- Hãng: "${input.line.brand || '(không có)'}"
- Xuất xứ: "${input.line.origin || '(không có)'}"
- ĐVT: "${input.line.unit || '(không có)'}"
- Mô tả/spec: "${input.line.spec || '(không có)'}"

Danh mục ứng viên (có thể rỗng):
${input.candidates.map((c) => `- id=${c.id} | mã=${c.code} | tên=${c.name} | ĐVT=${c.unit}`).join('\n') || '(không có ứng viên)'}

Nhiệm vụ:
1. Tách đúng tên hàng gọn ("name"), thương hiệu ("brand"), model ("model"), mô tả kỹ thuật đầy đủ ("desc").
2. Chọn "productId" là id ứng viên khớp nhất; nếu không ứng viên nào đúng thì để null. KHÔNG bịa id.

Trả JSON, không giải thích:
{"name":"...","brand":"...","model":"...","desc":"...","productId":<id hoặc null>,"confidence":<0..1, mức tin cậy của chính bạn>}`;

const lineAiSchema = z.object({
  name: z.string().max(500).optional(),
  brand: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  desc: z.string().max(2000).optional(),
  productId: z.number().int().positive().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

type LineAiResponse = z.infer<typeof lineAiSchema>;

async function suggestLine(
  line: ParsedQuote['lines'][number],
  productMatch: ProductMatch,
  status: AiStatus,
  preCandidates?: Array<{ id: number; code: string; name: string; unit: string }>,
): Promise<LineSuggestion | undefined> {
  // Luôn gọi AI cho từng dòng để kiểm tra lại kết quả ghép tất định —
  // kể cả dòng đã ghép chắc chắn vẫn có thể bị tách tên/model sai.
  const detCandidates = productMatch.candidates ?? [];

  // Ưu tiên ứng viên rapidfuzz (kết hợp mã + mô tả); nếu không có mới tự dò.
  const wide = preCandidates?.length ? preCandidates : candidatesForAi(line, 20);
  const candidates = wide.length
    ? wide
    : detCandidates.map((c) => ({ id: c.id, code: c.code, name: c.name, unit: c.unit }));

  const res = await aiCompleteWithProvider(
    LINE_PROMPT({
      line: {
        name: clamp(line.name),
        model: clamp(line.model),
        brand: clamp(line.brand),
        origin: clamp(line.origin),
        spec: clamp(line.spec_text, MAX_SPEC_LEN),
        unit: clamp(line.unit, 50),
      },
      candidates,
    }),
    Date.now() + AI_LINES_DEADLINE_MS,
    { task: 'line', lineNo: line.line_no },
  );
  if (!res) return undefined;
  noteProvider(status, res.provider);
  const parsed = extractJson<LineAiResponse>(res.text, lineAiSchema);
  if (!parsed) {
    logger.debug({ provider: res.provider, lineNo: line.line_no }, 'AI dòng hàng: phản hồi không parse được / sai schema');
    return undefined;
  }
  if (parsed.confidence != null && parsed.confidence < LOW_CONFIDENCE) {
    status.notes.push(`AI chỉ tin cậy ${Math.round(parsed.confidence * 100)}% về dòng #${line.line_no} — kiểm tra lại`);
  }

  const suggestion: LineSuggestion = {};
  const assign = (key: 'name' | 'brand' | 'model' | 'desc', value?: string) => {
    const v = (value ?? '').trim();
    if (v && v !== '(không có)') suggestion[key] = v;
  };
  assign('name', parsed.name);
  assign('brand', parsed.brand);
  assign('model', parsed.model);
  assign('desc', parsed.desc);

  // Chỉ chấp nhận id nằm trong danh sách ứng viên — chặn LLM bịa mã hàng
  const picked = typeof parsed.productId === 'number' ? candidates.find((c) => c.id === parsed.productId) : undefined;
  if (picked) {
    suggestion.productId = picked.id;
    suggestion.product = { id: picked.id, code: picked.code, name: picked.name, unit: picked.unit };
    status.lines = (status.lines ?? 0) + 1;
  } else if (Object.keys(suggestion).length) {
    status.lines = (status.lines ?? 0) + 1;
  }
  return Object.keys(suggestion).length ? suggestion : undefined;
}

/**
 * Chạy toàn bộ bước AI cho một báo giá. `lineMatches` phải cùng thứ tự với
 * `pq.lines`. Trả `undefined` khi AI bị tắt hoặc mọi provider thất bại.
 */
export async function enrichWithAi(
  pq: ParsedQuote,
  lineMatches: ProductMatch[],
  hints?: AiFuzzyHints,
): Promise<AiEnrichment | undefined> {
  if (!aiGlobalEnabled()) return undefined;

  const status: AiStatus = { ran: false, providers: [], notes: [] };
  // Dòng đã khớp chắc bằng rapidfuzz thì bỏ qua AI cho nhanh/đỡ tốn token.
  const skip = new Set(hints?.resolvedLineIndexes ?? []);
  const items = pq.lines
    .map((line, i) => ({ line, match: lineMatches[i]!, i }))
    .filter((it) => !skip.has(it.i));

  const [customer, lineResults] = await Promise.all([
    hints?.skipCustomer ? Promise.resolve<CustomerEnrichment | undefined>(undefined) : resolveCustomerAi(pq, status, hints),
    mapLimit(items, Math.max(1, AI_LINE_CONCURRENCY), (item) =>
      suggestLine(item.line, item.match, status, hints?.candidates?.[item.i]),
    ),
  ]);

  // AI coi như đã chạy khi có ít nhất một provider trả lời, kể cả không tạo ra gợi ý nào
  status.ran = status.providers.length > 0;
  const lines: Record<number, LineSuggestion> = {};
  items.forEach((it, k) => {
    const s = lineResults[k];
    if (s) lines[it.i] = s;
  });
  if (!status.ran) {
    logger.debug('AI enrichment không có kết quả');
    return undefined;
  }
  return { customer, lines, status };
}

function toCustomerLite(c: typeof customers.$inferSelect): NonNullable<CustomerMatch['customer']> {
  return {
    id: c.id,
    taxCode: c.taxCode,
    name: c.name,
    address: c.address,
    email: c.email,
    buyerName: c.buyerName,
    bankAccount: c.bankAccount,
    budgetUnitCode: c.budgetUnitCode,
  };
}
