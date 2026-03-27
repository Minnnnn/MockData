import { NextResponse } from 'next/server';
import {
  configureMockServer,
  getMockServerState,
  startMockServer,
  stopMockServer,
  updateRouteRuntime,
} from '@/lib/mock-server-store';
import { ServerRouteConfig } from '@/lib/types';

export async function GET() {
  return NextResponse.json(getMockServerState());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = String(body.action ?? '');

    if (action === 'configure') {
      const routes = Array.isArray(body.routes) ? (body.routes as ServerRouteConfig[]) : [];
      configureMockServer(routes);
      return NextResponse.json(getMockServerState());
    }

    if (action === 'start') {
      const port = Math.max(1, Number(body.port ?? 3000));
      startMockServer(port);
      return NextResponse.json(getMockServerState());
    }

    if (action === 'stop') {
      stopMockServer();
      return NextResponse.json(getMockServerState());
    }

    if (action === 'updateRoute') {
      const endpointId = String(body.endpointId ?? '');
      const status = Number(body.status ?? 200);
      const delayMs = Number(body.delayMs ?? 0);
      if (!endpointId) {
        return NextResponse.json({ error: 'endpointId 不能为空。' }, { status: 400 });
      }

      updateRouteRuntime(endpointId, status, Math.max(0, delayMs));
      return NextResponse.json(getMockServerState());
    }

    return NextResponse.json({ error: `未知 action: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
