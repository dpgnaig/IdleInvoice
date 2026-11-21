/**
 * Tra cứu MST ra ngoài.
 * Mặc định dùng VietQR (`https://api.vietqr.io/v2/business/{MST}`) — không cần key.
 * Đặt `TAX_LOOKUP_URL` nếu muốn thay bằng nhà cung cấp khác; khi đó endpoint được gọi
 * dạng `${TAX_LOOKUP_URL}?taxCode=...` và phải trả `{ name, address }`.
 */
export interface TaxLookupInfo {
  taxCode: string;
  name: string;
  address: string;
  /** Tên viết tắt / tên quốc tế nếu nhà cung cấp có trả về. */
  shortName?: string;
  internationalName?: string;
  /** Tình trạng hoạt động của người nộp thuế, vd "NNT đang hoạt động". */
  status?: string;
  source: string;
}

/** Cache kết quả 10 phút — tránh gọi lại liên tục khi người dùng bấm nhầm nhiều lần. */
export const TAX_CACHE = new Map<string, { at: number; value: Awaited<ReturnType<typeof fetchTaxInfo>> }>();
const TAX_CACHE_TTL = 10 * 60 * 1000;

export async function lookupTaxExternal(
  taxCode: string,
): Promise<{ info?: TaxLookupInfo; error?: string }> {
  const cached = TAX_CACHE.get(taxCode);
  if (cached && Date.now() - cached.at < TAX_CACHE_TTL) return cached.value;

  const value = await fetchTaxInfo(taxCode);
  TAX_CACHE.set(taxCode, { at: Date.now(), value });
  return value;
}

export async function fetchTaxInfo(taxCode: string): Promise<{ info?: TaxLookupInfo; error?: string }> {
  const override = process.env.TAX_LOOKUP_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    if (override) {
      const res = await fetch(`${override}?taxCode=${encodeURIComponent(taxCode)}`, {
        signal: controller.signal,
      });
      if (!res.ok) return { error: 'Dịch vụ tra cứu MST không phản hồi' };
      const body = (await res.json()) as { name?: string; address?: string };
      if (!body.name) return {};
      return {
        info: {
          taxCode,
          name: body.name,
          address: body.address ?? '',
          source: 'custom',
        },
      };
    }

    const res = await fetch(`https://api.vietqr.io/v2/business/${encodeURIComponent(taxCode)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      if (res.status === 429) return { error: 'Tra cứu MST đang bị giới hạn, thử lại sau ít phút' };
      return { error: 'Dịch vụ tra cứu MST không phản hồi' };
    }
    const body = (await res.json()) as {
      code?: string;
      desc?: string;
      data?: {
        id?: string;
        name?: string;
        internationalName?: string | null;
        shortName?: string | null;
        address?: string;
        status?: string;
      } | null;
    };
    // VietQR: code "00" = thành công, "51" = không tìm thấy MST
    if (body.code !== '00' || !body.data?.name) {
      if (body.code === '51') return {};
      return { error: body.desc ?? 'Dịch vụ tra cứu MST trả về lỗi' };
    }
    return {
      info: {
        taxCode,
        name: body.data.name,
        address: body.data.address ?? '',
        shortName: body.data.shortName ?? undefined,
        internationalName: body.data.internationalName ?? undefined,
        status: body.data.status ?? undefined,
        source: 'vietqr',
      },
    };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { error: 'Tra cứu MST quá thời gian chờ, thử lại sau' };
    }
    return { error: 'Không kết nối được dịch vụ tra cứu MST' };
  } finally {
    clearTimeout(timeout);
  }
}
