import { RequestLogEntry, ServerRouteConfig } from '@/lib/types';

type MockServerState = {
  running: boolean;
  port: number;
  routes: ServerRouteConfig[];
  logs: RequestLogEntry[];
};

const state: MockServerState = {
  running: false,
  port: 3000,
  routes: [],
  logs: [],
};

export function getMockServerState() {
  return {
    running: state.running,
    port: state.port,
    routes: state.routes,
    logs: state.logs,
  };
}

export function configureMockServer(routes: ServerRouteConfig[]) {
  state.routes = routes;
}

export function startMockServer(port: number) {
  state.port = port;
  state.running = true;
}

export function stopMockServer() {
  state.running = false;
}

export function updateRouteRuntime(endpointId: string, status: number, delayMs: number) {
  state.routes = state.routes.map((route) =>
    route.endpointId === endpointId
      ? {
          ...route,
          status,
          delayMs,
        }
      : route,
  );
}

export function resolveMockResponse(method: string, path: string): ServerRouteConfig | null {
  const upperMethod = method.toUpperCase();
  for (const route of state.routes) {
    if (route.method.toUpperCase() !== upperMethod) {
      continue;
    }
    if (matchPath(route.path, path)) {
      return route;
    }
  }
  return null;
}

export function pushRequestLog(entry: Omit<RequestLogEntry, 'id' | 'time'>) {
  const log: RequestLogEntry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    ...entry,
  };

  state.logs = [log, ...state.logs].slice(0, 200);
}

function matchPath(template: string, actual: string): boolean {
  const cleanedTemplate = normalizePath(template);
  const cleanedActual = normalizePath(actual);

  if (cleanedTemplate === cleanedActual) {
    return true;
  }

  const regex = new RegExp(
    `^${cleanedTemplate
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\{[^/]+\\\}/g, '[^/]+')}$`,
  );

  return regex.test(cleanedActual);
}

function normalizePath(value: string): string {
  if (!value.startsWith('/')) {
    return `/${value}`;
  }
  return value;
}
