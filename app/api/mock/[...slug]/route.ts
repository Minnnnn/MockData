import { NextResponse } from 'next/server';
import { getMockServerState, pushRequestLog, resolveMockResponse } from '@/lib/mock-server-store';
import { buildMockResponseBody } from '@/lib/mock-response';

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
  const body = buildMockResponseBody(route, requestParams);
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
