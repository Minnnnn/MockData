import { NextResponse } from 'next/server';
import { getFixedImageUrls, pickImageUrl, pickRandomImageSubset } from '@/lib/fixed-image-url';
import { getMockServerState, pushRequestLog, resolveMockResponse } from '@/lib/mock-server-store';

async function handle(method: string, request: Request, path: string) {
  const state = getMockServerState();
  if (!state.running) {
    return NextResponse.json({ error: 'Mock 服务未启动。' }, { status: 503 });
  }

  const route = resolveMockResponse(method, path);
  if (!route) {
    pushRequestLog({
      method,
      path,
      status: 404,
      delayMs: 0
    });

    return NextResponse.json({ error: '未匹配到该接口。' }, { status: 404 });
  }

  if (route.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, route.delayMs));
  }

  pushRequestLog({
    method,
    path,
    status: route.status,
    delayMs: route.delayMs
  });

  const requestParams = await readRequestParams(request);
  const body = buildMockEnvelope(route, requestParams);
  return NextResponse.json(body, { status: route.status });
}

function getResolvedPath(request: Request, slug: string[] | undefined): string {
  if (slug && slug.length > 0) {
    return `/${slug.join('/')}`;
  }

  const url = new URL(request.url);
  return url.pathname.replace('/api/mock', '') || '/';
}

type Params = { slug?: string[] };

const COLLECTION_KEYS = ['items', 'list', 'records', 'rows', 'dataList', 'resultList'] as const;
const PAGE_KEYS = ['page', 'pageNum', 'pageNo', 'current'] as const;
const PAGE_SIZE_KEYS = ['pageSize', 'pagesize', 'limit', 'size'] as const;

function buildMockEnvelope(
  route: {
    payload: unknown;
    status: number;
    description?: string;
    path?: string;
    totalCount?: number;
  },
  requestParams: Record<string, unknown>
) {
  const isSuccessStatus = route.status >= 200 && route.status < 300;

  if (!isSuccessStatus && route.status === 403) {
    return {
      rc: 1,
      msg: '请登录',
      data: null
    };
  }

  if (!isSuccessStatus) {
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

function buildSuccessData(
  payload: unknown,
  totalHint: number | undefined,
  requestParams: Record<string, unknown>
): unknown {
  const normalizedPayload = unwrapPayload(payload);
  const paging = getPaging(requestParams, normalizedPayload, totalHint);

  if (!paging) {
    if (Array.isArray(normalizedPayload) && normalizedPayload.length === 1) {
      return unwrapPayload(normalizedPayload[0]);
    }
    return normalizedPayload;
  }

  const total = Math.max(1, Number(totalHint ?? inferTotal(normalizedPayload) ?? paging.pageSize));

  if (Array.isArray(normalizedPayload)) {
    const first = normalizedPayload[0];
    if (isRecord(first) && hasCollectionShape(first)) {
      return applyPaginationToObject(first, total, paging);
    }

    return paginateArray(normalizedPayload, total, paging);
  }

  if (isRecord(normalizedPayload)) {
    return applyPaginationToObject(normalizedPayload, total, paging);
  }

  return normalizedPayload;
}

async function readRequestParams(request: Request): Promise<Record<string, unknown>> {
  const url = new URL(request.url);
  const params: Record<string, unknown> = {};

  for (const [key, value] of url.searchParams.entries()) {
    params[key] = value;
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    return params;
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  try {
    if (contentType.includes('application/json')) {
      const body = await request.json();
      if (isRecord(body)) {
        return { ...body, ...params };
      }
    }

    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      for (const [key, value] of formData.entries()) {
        params[key] = typeof value === 'string' ? value : value.name;
      }
    }
  } catch {
    return params;
  }

  return params;
}

function getPaging(
  requestParams: Record<string, unknown>,
  payload: unknown,
  totalHint: number | undefined
): { page: number; pageSize: number; total: number } | null {
  const hasPageParam =
    PAGE_KEYS.some((key) => requestParams[key] !== undefined) ||
    PAGE_SIZE_KEYS.some((key) => requestParams[key] !== undefined);

  const payloadLooksPaged = Array.isArray(payload)
    ? Boolean(payload[0] && isRecord(payload[0]) && hasCollectionShape(payload[0]))
    : isRecord(payload) && hasCollectionShape(payload);

  if (!hasPageParam && !payloadLooksPaged) {
    return null;
  }

  const page = Math.max(1, readNumber(requestParams, PAGE_KEYS, 1));
  const pageSize = Math.max(1, readNumber(requestParams, PAGE_SIZE_KEYS, 10));
  const total = Math.max(1, Number(totalHint ?? inferTotal(payload) ?? pageSize));

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
    if (isImageKey(key)) {
      return normalizeImageArray(value);
    }

    return value.map((item) => normalizeMockValue(item, key));
  }

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = normalizeMockValue(entryValue, entryKey);
    }
    return output;
  }

  if (typeof value === 'string') {
    if (isImageKey(key)) {
      return pickImageUrl();
    }

    if (isTimeKey(key) || looksLikeDateTime(value)) {
      return formatShanghaiDateTime(value);
    }
  }

  return value;
}

function normalizeImageArray(value: unknown[]): string[] {
  const fixedImageUrls = getFixedImageUrls();
  const source = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());

  if (source.length === 0) {
    return pickRandomImageSubset(fixedImageUrls);
  }

  if (source.length <= 3) {
    return source;
  }

  return pickRandomImageSubset(source);
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

function hasCollectionShape(value: Record<string, unknown>): boolean {
  if (COLLECTION_KEYS.some((key) => Array.isArray(value[key]))) {
    return true;
  }

  return Object.values(value).some((item) => isRecord(item) && hasCollectionShape(item));
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

function isImageKey(value: string) {
  return /img|image|avatar|cover|pic|photo/i.test(value);
}

function isTimeKey(value: string) {
  return /time|date|createdAt|updatedAt|createTime|updateTime/i.test(value);
}

function looksLikeDateTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(value) || /^\d{4}-\d{2}-\d{2}T/.test(value);
}

function formatShanghaiDateTime(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
      .format(new Date())
      .replace(' ', ' ');
  }

  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
    .format(date)
    .replace(' ', ' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function GET(request: Request, context: { params: Promise<Params> }) {
  const { slug } = await context.params;
  return handle('GET', request, getResolvedPath(request, slug));
}

export async function POST(request: Request, context: { params: Promise<Params> }) {
  const { slug } = await context.params;
  return handle('POST', request, getResolvedPath(request, slug));
}

export async function PUT(request: Request, context: { params: Promise<Params> }) {
  const { slug } = await context.params;
  return handle('PUT', request, getResolvedPath(request, slug));
}

export async function PATCH(request: Request, context: { params: Promise<Params> }) {
  const { slug } = await context.params;
  return handle('PATCH', request, getResolvedPath(request, slug));
}

export async function DELETE(request: Request, context: { params: Promise<Params> }) {
  const { slug } = await context.params;
  return handle('DELETE', request, getResolvedPath(request, slug));
}

export async function OPTIONS(request: Request, context: { params: Promise<Params> }) {
  const { slug } = await context.params;
  return handle('OPTIONS', request, getResolvedPath(request, slug));
}

export async function HEAD(request: Request, context: { params: Promise<Params> }) {
  const { slug } = await context.params;
  return handle('HEAD', request, getResolvedPath(request, slug));
}
