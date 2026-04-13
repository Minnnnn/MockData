type MockResponseRoute = {
  payload: unknown;
  status: number;
  description?: string;
  path?: string;
  totalCount?: number;
};

const COLLECTION_KEYS = ['items', 'item', 'list', 'records', 'rows', 'dataList', 'resultList'] as const;
const PAGE_KEYS = ['page', 'pageNum', 'pageNo', 'current'] as const;
const PAGE_SIZE_KEYS = ['pageSize', 'pagesize', 'limit', 'size'] as const;

export function buildMockResponseBody(
  route: MockResponseRoute,
  requestParams: Record<string, unknown> = {}
): unknown {
  const isDefaultSuccessStatus = route.status === 200;

  if (!isDefaultSuccessStatus) {
    const explicitEnvelope = extractResponseEnvelope(route.payload);
    if (explicitEnvelope) {
      return normalizeMockValue(explicitEnvelope);
    }

    if (route.status === 403) {
      return {
        rc: 1,
        msg: '请登录',
        data: null
      };
    }

    return {
      rc: 1,
      msg: `${route.description || route.path || '接口'}错误`,
      data: null
    };
  }

  const data = buildSuccessData(route.payload, route.totalCount, requestParams);
  return {
    rc: 0,
    msg: '',
    data: normalizeMockValue(data)
  };
}

export function parsePreviewResponseToPayload(response: unknown, status: number): unknown {
  const envelope = extractResponseEnvelope(response);

  if (status === 200) {
    if (!envelope) {
      throw new Error('成功响应必须是包含 rc、msg、data 的对象。');
    }

    return envelope.data;
  }

  if (!envelope) {
    throw new Error('非 200 响应必须是包含 rc、msg、data 的对象。');
  }

  return envelope;
}

function buildSuccessData(
  payload: unknown,
  totalHint: number | undefined,
  requestParams: Record<string, unknown>
): unknown {
  const normalizedPayload = unwrapPayload(payload);
  const paging = getPaging(requestParams, normalizedPayload, totalHint);

  if (Array.isArray(normalizedPayload)) {
    return normalizedPayload;
  }

  if (!paging) {
    return normalizedPayload;
  }

  const inferredTotal = inferTotal(normalizedPayload);
  const total = Math.max(1, Number(Math.max(totalHint ?? 0, inferredTotal ?? 0)));

  if (isRecord(normalizedPayload)) {
    return applyPaginationToObject(normalizedPayload, total, paging);
  }

  return normalizedPayload;
}

function getPaging(
  requestParams: Record<string, unknown>,
  payload: unknown,
  totalHint: number | undefined
): { page: number; pageSize: number; total: number } | null {
  const hasPageParam =
    PAGE_KEYS.some((key) => requestParams[key] !== undefined) ||
    PAGE_SIZE_KEYS.some((key) => requestParams[key] !== undefined);

  if (!hasPageParam) {
    return null;
  }

  const page = Math.max(1, readNumber(requestParams, PAGE_KEYS, 1));
  const pageSize = Math.max(1, readNumber(requestParams, PAGE_SIZE_KEYS, 10));
  const inferredTotal = inferTotal(payload);
  const total = Math.max(1, Number(Math.max(totalHint ?? 0, inferredTotal ?? 0)));

  return { page, pageSize, total };
}

function applyPaginationToObject(
  input: Record<string, unknown>,
  total: number,
  paging: { page: number; pageSize: number; total: number }
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...input };
  const collectionKey = COLLECTION_KEYS.find((key) => Array.isArray(output[key]));

  if (collectionKey) {
    const items = output[collectionKey] as unknown[];
    output[collectionKey] = paginateArray(items, total, paging);
    applyCountFields(output, total, paging);
    return output;
  }

  for (const [key, value] of Object.entries(output)) {
    if (isRecord(value)) {
      output[key] = applyPaginationToObject(value, total, paging);
      return output;
    }
  }

  return output;
}

function paginateArray(input: unknown[], total: number, paging: { page: number; pageSize: number }) {
  const materialized = materializeArray(input, total);
  const start = Math.max(0, (paging.page - 1) * paging.pageSize);
  return materialized.slice(start, start + paging.pageSize);
}

function materializeArray(input: unknown[], total: number): unknown[] {
  if (input.length === 0) {
    return [];
  }

  if (input.length >= total) {
    return input.slice(0, total).map((item) => structuredClone(item));
  }

  return Array.from({ length: total }, (_, index) => structuredClone(input[index % input.length]));
}

function applyCountFields(output: Record<string, unknown>, total: number, paging: { page: number; pageSize: number }) {
  const hasMore = paging.page * paging.pageSize < total;
  const totalKeys = ['total', 'totalCount'];
  const hasMoreKeys = ['hasMore', 'hasmore'];

  if (totalKeys.some((key) => key in output)) {
    for (const key of totalKeys) {
      if (key in output) output[key] = total;
    }
  } else {
    output.total = total;
  }

  if (hasMoreKeys.some((key) => key in output)) {
    for (const key of hasMoreKeys) {
      if (key in output) output[key] = hasMore;
    }
  } else {
    output.hasMore = hasMore;
  }
}

function normalizeMockValue(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeMockValue(item, key));
  }

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = normalizeMockValue(entryValue, entryKey);
    }
    return output;
  }

  return value;
}

function unwrapPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => unwrapPayloadSingle(item));
  }

  return unwrapPayloadSingle(value);
}

function unwrapPayloadSingle(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  if ('data' in value && ('rc' in value || 'msg' in value || 'message' in value)) {
    return value.data;
  }

  return value;
}

function inferTotal(payload: unknown): number | undefined {
  if (Array.isArray(payload)) {
    return payload.length;
  }

  if (!isRecord(payload)) {
    return undefined;
  }

  for (const key of COLLECTION_KEYS) {
    const value = payload[key];
    if (Array.isArray(value) && value.length > 0) {
      return value.length;
    }
  }

  for (const value of Object.values(payload)) {
    if (isRecord(value)) {
      const nested = inferTotal(value);
      if (nested) return nested;
    }
  }

  for (const key of ['total', 'totalCount']) {
    const raw = payload[key];
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: readonly string[], fallback: number) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return fallback;
}

function extractResponseEnvelope(value: unknown): { rc: number; msg: string; data: unknown } | null {
  if (!isRecord(value) || !('rc' in value) || !('data' in value)) {
    return null;
  }

  const rc = Number(value.rc);
  const msg =
    typeof value.msg === 'string'
      ? value.msg
      : typeof value.message === 'string'
        ? value.message
        : '';

  return {
    rc: Number.isFinite(rc) ? rc : 0,
    msg,
    data: value.data
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
