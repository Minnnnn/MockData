import { EndpointDefinition, HttpMethod, ParseResult } from '@/lib/types';

const METHOD_LIST: HttpMethod[] = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

export function parseOpenApiText(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON 格式错误，请检查后重试。');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('OpenAPI 内容为空或格式无效。');
  }

  const doc = parsed as Record<string, unknown>;
  const openapiVersion = String(doc.openapi ?? '');
  if (!isSupportedOpenApiVersion(openapiVersion)) {
    throw new Error('仅支持 OpenAPI 3.0 及以上版本 JSON。');
  }

  const info = (doc.info ?? {}) as Record<string, unknown>;
  const title = String(info.title ?? 'Untitled API');
  const version = String(info.version ?? '0.0.0');
  const endpoints = extractEndpoints(doc);

  return {
    title,
    version,
    endpointCount: endpoints.length,
    endpoints,
  };
}

export function extractEndpoints(doc: Record<string, unknown>): EndpointDefinition[] {
  const paths = (doc.paths ?? {}) as Record<string, unknown>;
  const endpoints: EndpointDefinition[] = [];

  for (const path of Object.keys(paths)) {
    const pathItem = paths[path] as Record<string, unknown> | undefined;
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }

    for (const method of METHOD_LIST) {
      const operation = pathItem[method] as Record<string, unknown> | undefined;
      if (!operation || typeof operation !== 'object') {
        continue;
      }

      const operationId = stringOrUndefined(operation.operationId);
      const summary = stringOrUndefined(operation.summary);
      const description = stringOrUndefined(operation.description);
      const requestSchema = getRequestSchema(doc, operation);
      const { schema: responseSchema, statusCodes } = getResponseSchema(doc, operation);

      const fallbackId = `${method}_${path}`.replace(/[^a-zA-Z0-9_]/g, '_');
      endpoints.push({
        id: sanitizeTypeName(operationId ?? fallbackId),
        path,
        method,
        operationId,
        summary,
        description,
        enabled: true,
        requestSchema,
        responseSchema,
        statusCodes,
      });
    }
  }

  return endpoints;
}

export function selectEnabledEndpoints(
  endpoints: EndpointDefinition[],
  enabledIds: string[] | undefined,
): EndpointDefinition[] {
  if (!enabledIds || enabledIds.length === 0) {
    return endpoints;
  }
  const enabled = new Set(enabledIds);
  return endpoints.filter((item) => enabled.has(item.id));
}

function getRequestSchema(
  doc: Record<string, unknown>,
  operation: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const requestBody = derefMaybe(doc, operation.requestBody);
  if (!isObject(requestBody)) {
    return undefined;
  }

  const content = requestBody.content;
  if (!isObject(content)) {
    return undefined;
  }

  const appJson = content['application/json'];
  if (!isObject(appJson)) {
    return undefined;
  }

  return resolveSchema(doc, appJson.schema);
}

function getResponseSchema(
  doc: Record<string, unknown>,
  operation: Record<string, unknown>,
): { schema?: Record<string, unknown>; statusCodes: number[] } {
  const responses = (operation.responses ?? {}) as Record<string, unknown>;
  const keys = Object.keys(responses);
  const statusCodes = keys
    .map((key) => Number(key))
    .filter((value) => Number.isFinite(value));

  const sortedKeys = [...keys].sort((a, b) => scoreResponseKey(a) - scoreResponseKey(b));

  for (const key of sortedKeys) {
    const response = derefMaybe(doc, responses[key]);
    if (!isObject(response) || !isObject(response.content)) {
      continue;
    }

    const appJson = response.content['application/json'];
    if (!isObject(appJson)) {
      continue;
    }

    const schema = resolveSchema(doc, appJson.schema);
    if (schema) {
      return { schema, statusCodes };
    }
  }

  return { schema: undefined, statusCodes };
}

function scoreResponseKey(code: string): number {
  if (/^2\d\d$/.test(code)) return Number(code);
  if (code === 'default') return 2999;
  if (/^\d{3}$/.test(code)) return 9000 + Number(code);
  return 9999;
}

function resolveSchema(
  doc: Record<string, unknown>,
  schema: unknown,
  depth = 0,
): Record<string, unknown> | undefined {
  if (!schema || depth > 10) {
    return undefined;
  }

  const derefed = derefMaybe(doc, schema);
  if (!isObject(derefed)) {
    return undefined;
  }

  const cloned: Record<string, unknown> = { ...derefed };

  if (isObject(cloned.properties)) {
    const props = cloned.properties as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const key of Object.keys(props)) {
      next[key] = resolveSchema(doc, props[key], depth + 1) ?? props[key];
    }
    cloned.properties = next;
  }

  if (cloned.items) {
    cloned.items = resolveSchema(doc, cloned.items, depth + 1) ?? cloned.items;
  }

  if (Array.isArray(cloned.oneOf)) {
    cloned.oneOf = cloned.oneOf.map((item) => resolveSchema(doc, item, depth + 1) ?? item);
  }

  if (Array.isArray(cloned.anyOf)) {
    cloned.anyOf = cloned.anyOf.map((item) => resolveSchema(doc, item, depth + 1) ?? item);
  }

  if (Array.isArray(cloned.allOf)) {
    cloned.allOf = cloned.allOf.map((item) => resolveSchema(doc, item, depth + 1) ?? item);
  }

  return cloned;
}

function derefMaybe(doc: Record<string, unknown>, value: unknown): unknown {
  if (!isObject(value)) {
    return value;
  }

  const ref = value.$ref;
  if (typeof ref !== 'string') {
    return value;
  }

  if (!ref.startsWith('#/')) {
    return value;
  }

  const segments = ref
    .slice(2)
    .split('/')
    .map((part) => decodeURIComponent(part));

  let current: unknown = doc;
  for (const segment of segments) {
    if (!isObject(current)) {
      return value;
    }
    current = current[segment];
  }

  return current ?? value;
}

function sanitizeTypeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `api_${cleaned}`;
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isSupportedOpenApiVersion(version: string): boolean {
  const match = version.trim().match(/^(\d+)(?:\.(\d+))?/);
  if (!match) return false;

  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);

  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  if (major > 3) return true;
  if (major < 3) return false;
  return minor >= 0;
}
