export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head';

export type EndpointDefinition = {
  id: string;
  path: string;
  method: HttpMethod;
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  enabled: boolean;
  requestSchema?: Record<string, unknown>;
  responseSchema?: Record<string, unknown>;
  statusCodes: number[];
};

export type ParseResult = {
  title: string;
  version: string;
  endpointCount: number;
  endpoints: EndpointDefinition[];
};

export type FieldCoverage = 'all' | 'key';

export type MockStrategyConfig = {
  count: number;
  random: boolean;
  aiMode: boolean;
  anomalyRate: number;
  fieldCoverage: FieldCoverage;
  fieldRules: Record<string, string>;
};

export type EndpointMock = {
  endpointId: string;
  items: unknown[];
  runtime: {
    status: number;
    delayMs: number;
  };
};

export type ServerRouteConfig = {
  endpointId: string;
  method: string;
  path: string;
  description?: string;
  payload: unknown;
  totalCount?: number;
  status: number;
  delayMs: number;
};

export type RequestLogEntry = {
  id: string;
  time: string;
  method: string;
  path: string;
  status: number;
  delayMs: number;
};

export type PersistedTunedMock = {
  id: string;
  workspaceId: string;
  endpointId: string;
  items: unknown[];
  prompt: string;
  updatedAt: string;
};
