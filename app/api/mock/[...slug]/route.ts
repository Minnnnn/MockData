import { NextResponse } from 'next/server';
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
      delayMs: 0,
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
    delayMs: route.delayMs,
  });

  return NextResponse.json(route.payload, { status: route.status });
}

function getResolvedPath(request: Request, slug: string[] | undefined): string {
  if (slug && slug.length > 0) {
    return `/${slug.join('/')}`;
  }

  const url = new URL(request.url);
  return url.pathname.replace('/api/mock', '') || '/';
}

type Params = { slug?: string[] };

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
