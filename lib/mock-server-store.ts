import fs from 'node:fs';
import path from 'node:path';
import { RequestLogEntry, ServerRouteConfig } from '@/lib/types';

type MockServerState = {
  running: boolean;
  port: number;
  routes: ServerRouteConfig[];
  logs: RequestLogEntry[];
};

const STATE_DIR = path.join(process.cwd(), '.mock-data');
const STATE_FILE = path.join(STATE_DIR, 'mock-server-state.json');
const INTERNAL_PREFIX = '/api/mock';
const MANAGEMENT_PATHS = new Set(['/api/mock-server', '/api/workflow', '/api/mock-workflow', '/api/generateMock']);

const DEFAULT_STATE: MockServerState = {
  running: false,
  port: 3000,
  routes: [],
  logs: [],
};

export function getMockServerState(): MockServerState {
  return readState();
}

export function configureMockServer(routes: ServerRouteConfig[]) {
  const state = readState();
  writeState({
    ...state,
    routes,
  });
}

export function startMockServer(port: number) {
  const state = readState();
  writeState({
    ...state,
    port,
    running: true,
  });
}

export function stopMockServer() {
  const state = readState();
  writeState({
    ...state,
    running: false,
  });
}

export function resetMockServer() {
  writeState(DEFAULT_STATE);
}

export function updateRouteRuntime(endpointId: string, status: number, delayMs: number) {
  const state = readState();
  writeState({
    ...state,
    routes: state.routes.map((route) =>
      route.endpointId === endpointId
        ? {
            ...route,
            status,
            delayMs,
          }
        : route,
    ),
  });
}

export function resolveMockResponse(method: string, pathValue: string): ServerRouteConfig | null {
  const state = readState();
  const upperMethod = method.toUpperCase();

  for (const route of state.routes) {
    if (route.method.toUpperCase() !== upperMethod) {
      continue;
    }
    if (matchPath(route.path, pathValue)) {
      return route;
    }
  }
  return null;
}

export function shouldProxyToMock(pathname: string): boolean {
  if (!pathname.startsWith('/mock-api/')) {
    return false;
  }

  if (pathname.startsWith(INTERNAL_PREFIX)) {
    return false;
  }

  if (isManagementPath(pathname)) {
    return false;
  }

  return true;
}

export function pushRequestLog(entry: Omit<RequestLogEntry, 'id' | 'time'>) {
  const state = readState();
  const log: RequestLogEntry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    ...entry,
  };

  writeState({
    ...state,
    logs: [log, ...state.logs].slice(0, 200),
  });
}

function readState(): MockServerState {
  ensureStateFile();

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<MockServerState>;
    return {
      running: Boolean(parsed.running),
      port: Number(parsed.port ?? DEFAULT_STATE.port),
      routes: Array.isArray(parsed.routes) ? (parsed.routes as ServerRouteConfig[]) : [],
      logs: Array.isArray(parsed.logs) ? (parsed.logs as RequestLogEntry[]) : [],
    };
  } catch {
    writeState(DEFAULT_STATE);
    return DEFAULT_STATE;
  }
}

function writeState(state: MockServerState) {
  ensureStateFile();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function ensureStateFile() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }

  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(DEFAULT_STATE, null, 2), 'utf8');
  }
}

function isManagementPath(pathname: string): boolean {
  if (MANAGEMENT_PATHS.has(pathname)) {
    return true;
  }

  return pathname.startsWith('/api/mock-server/');
}

function matchPath(template: string, actual: string): boolean {
  const cleanedTemplate = normalizePath(template);
  const cleanedActual = normalizePath(actual);

  if (cleanedTemplate === cleanedActual) {
    return true;
  }

  const regex = new RegExp(`^${templateToRegexSource(cleanedTemplate)}$`);
  return regex.test(cleanedActual);
}

function templateToRegexSource(value: string): string {
  return value
    .split('/')
    .map((segment) => {
      if (!segment) return '';
      if (/^:([^/]+)$/.test(segment)) {
        return '[^/]+';
      }
      if (/^\{[^/]+\}$/.test(segment)) {
        return '[^/]+';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
}

function normalizePath(value: string): string {
  if (!value.startsWith('/')) {
    return `/${value}`;
  }
  return value;
}

