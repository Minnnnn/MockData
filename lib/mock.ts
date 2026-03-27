import { faker } from '@faker-js/faker';
import { EndpointDefinition, EndpointMock, MockStrategyConfig } from '@/lib/types';

type GeneratedRoute = {
  id: string;
  routeName: { usage: string };
  raw: { operationId?: string; route?: string; method?: string };
  request: {
    path?: string;
    method?: string;
    pathParams?: unknown;
    requestParams?: unknown;
    payload?: {
      name?: string | null;
      optional?: boolean;
      type: string;
    };
  };
  response: {
    type?: string;
  };
};

export async function generateTsArtifacts(
  openapiDocument: unknown,
  endpoints: EndpointDefinition[],
): Promise<{ typesTs: string; apiTs: string }> {
  const filteredSpec = filterOpenApiDocument(openapiDocument, endpoints);
  const { generateApi } = await import('swagger-typescript-api');
  const output = await generateApi({
    spec: filteredSpec,
    modular: true,
    generateClient: true,
    extractRequestParams: true,
    extractRequestBody: true,
    extractResponseBody: true,
    extractResponseError: true,
    extractEnums: true,
    generateUnionEnums: true,
    silent: true,
    fileName: 'api.ts',
  });

  const typesFile = output.files.find((file) => `${file.fileName}${file.fileExtension}` === 'data-contracts.ts');
  const typesTs = typesFile?.fileContent?.trim() || 'export {}';
  const modelNames = new Set(output.configuration.modelTypes.map((item) => item.name));
  const routes: GeneratedRoute[] = [
    ...(output.configuration.routes.outOfModule as GeneratedRoute[]),
    ...((output.configuration.routes.combined?.flatMap((item) => item.routes) ?? []) as GeneratedRoute[]),
  ];
  const apiTs = await output.formatTSContent(buildApiFile(routes, modelNames), {
    removeUnusedImports: true,
    format: true,
  });

  return {
    typesTs,
    apiTs,
  };
}

export function generateEndpointMocks(
  endpoints: EndpointDefinition[],
  strategy: MockStrategyConfig,
): Record<string, EndpointMock> {
  const result: Record<string, EndpointMock> = {};

  for (const endpoint of endpoints) {
    const count = strategy.random
      ? faker.number.int({ min: 1, max: Math.max(strategy.count, 1) })
      : Math.max(strategy.count, 1);

    const items: unknown[] = [];

    for (let i = 0; i < count; i += 1) {
      if (!strategy.random) {
        faker.seed(hashCode(`${endpoint.id}-${i}`));
      }

      const payload = mockFromSchema(endpoint.responseSchema, strategy, endpoint.path);
      items.push(maybeInjectAnomaly(payload, strategy.anomalyRate));
    }

    result[endpoint.id] = {
      endpointId: endpoint.id,
      items,
      runtime: {
        status: endpoint.statusCodes.find((code) => code >= 200 && code < 300) ?? 200,
        delayMs: 0,
      },
    };
  }

  return result;
}

export function tuneMockJsonByPrompt(jsonText: string, prompt: string): { output: string; changedKeys: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('当前 JSON 无法解析，无法调优。');
  }

  const changed = new Set<string>();
  const lowerPrompt = prompt.toLowerCase();

  function walk(value: unknown, path: string[] = []): unknown {
    if (Array.isArray(value)) {
      return value.map((item, index) => walk(item, [...path, String(index)]));
    }

    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const key of Object.keys(obj)) {
        const currentPath = [...path, key];
        const val = obj[key];
        const lowerKey = key.toLowerCase();

        if ((lowerPrompt.includes('真实') || lowerPrompt.includes('自然')) && /nick|name|user/.test(lowerKey)) {
          next[key] = faker.person.fullName();
          changed.add(currentPath.join('.'));
          continue;
        }

        if ((lowerPrompt.includes('邮箱') || lowerPrompt.includes('email')) && /email/.test(lowerKey)) {
          next[key] = faker.internet.email();
          changed.add(currentPath.join('.'));
          continue;
        }

        if ((lowerPrompt.includes('手机号') || lowerPrompt.includes('phone')) && /phone|mobile/.test(lowerKey)) {
          next[key] = faker.phone.number('1##########');
          changed.add(currentPath.join('.'));
          continue;
        }

        next[key] = walk(val, currentPath);
      }
      return next;
    }

    return value;
  }

  const output = walk(data);

  return {
    output: JSON.stringify(output, null, 2),
    changedKeys: [...changed],
  };
}

function buildApiFile(routes: GeneratedRoute[], modelNames: Set<string>): string {
  const lines: string[] = ["import type * as Types from './types';", ''];

  if (routes.length === 0) {
    lines.push('export {};');
    return lines.join('\n');
  }

  for (const route of routes) {
    const fnName = safeIdentifier(route.routeName.usage || route.raw.operationId || route.id);
    const signature = buildFunctionSignature(route, modelNames);
    const returnType = mapTypeExpression(route.response.type || 'unknown', modelNames);
    const pathLiteral = buildPathLiteral(route.request.path || route.raw.route || '/');
    const requestOptions = buildRequestOptions(route);

    lines.push(`export const ${fnName} = async (`);
    if (signature.length > 0) {
      lines.push(...signature.map((line) => `  ${line}`));
    }
    lines.push(
      `): Promise<${returnType}> => {`,
      `  return customRequest(${pathLiteral}, {`,
      ...requestOptions.map((line) => `    ${line}`),
      '  });',
      '};',
      '',
    );
  }

  return lines.join('\n');
}

function buildFunctionSignature(route: GeneratedRoute, modelNames: Set<string>): string[] {
  const params: string[] = [];
  const usedNames = new Set<string>();
  const pathParams = extractObjectFields(route.request.pathParams);
  const requestParams = extractObjectFields(route.request.requestParams);

  for (const field of [...pathParams, ...requestParams]) {
    const fieldName = safeIdentifier(field.name);
    if (usedNames.has(fieldName)) {
      continue;
    }
    usedNames.add(fieldName);
    params.push(`${fieldName}${field.required ? '' : '?'}: ${mapTypeExpression(field.type, modelNames)},`);
  }

  if (route.request.payload?.type) {
    const payloadName = safeIdentifier(route.request.payload.name || 'data');
    const optional = route.request.payload.optional ? '?' : '';
    params.push(`${payloadName}${optional}: ${mapTypeExpression(route.request.payload.type, modelNames)},`);
  }

  return params;
}

function buildRequestOptions(route: GeneratedRoute): string[] {
  const options = [`method: '${String(route.request.method || route.raw.method || 'get').toUpperCase()}',`];
  const queryFields = [...new Set(
    extractObjectFields(route.request.requestParams)
      .filter((field) => field.source === 'query')
      .map((field) => safeIdentifier(field.name)),
  )];

  if (queryFields.length > 0) {
    options.push('params: {');
    options.push(...queryFields.map((name) => `  ${name},`));
    options.push('},');
  }

  if (route.request.payload?.type) {
    options.push(`data: ${safeIdentifier(route.request.payload.name || 'data')},`);
  }

  return options;
}

function buildPathLiteral(path: string): string {
  const normalized = path.replace(/\{([^}]+)\}/g, '${$1}');
  return normalized.includes('${') ? `\`${normalized}\`` : `'${normalized}'`;
}

function mapTypeExpression(typeExpression: string, modelNames: Set<string>): string {
  let output = typeExpression;
  const sortedNames = [...modelNames].sort((a, b) => b.length - a.length);

  for (const name of sortedNames) {
    output = output.replace(new RegExp(`(^|[^\\w.])(${escapeRegExp(name)})(?=\\b)`, 'g'), (_, prefix, matched) => {
      if (String(prefix).endsWith('.')) {
        return `${prefix}${matched}`;
      }
      return `${prefix}Types.${matched}`;
    });
  }

  return output;
}

function extractObjectFields(schema: unknown): Array<{ name: string; type: string; required: boolean; source?: string }> {
  const schemaObject = schema as
    | {
        typeData?: { content?: unknown[] };
        rawTypeData?: { $parsed?: { content?: unknown[] } };
      }
    | undefined;
  const content = Array.isArray(schemaObject?.typeData?.content)
    ? schemaObject.typeData.content
    : (schemaObject?.rawTypeData?.$parsed?.content ?? []);

  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .map((item) => item as { name?: string; value?: string; isRequired?: boolean; in?: string })
    .filter((item) => !!item.name && !!item.value)
    .map((item) => ({
      name: String(item.name),
      type: String(item.value),
      required: Boolean(item.isRequired),
      source: typeof item.in === 'string' ? item.in : undefined,
    }));
}

function filterOpenApiDocument(openapiDocument: unknown, endpoints: EndpointDefinition[]): Record<string, unknown> {
  const doc = JSON.parse(JSON.stringify(openapiDocument ?? {})) as Record<string, unknown>;
  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
  const enabled = new Set(endpoints.map((item) => `${item.method} ${item.path}`));

  for (const path of Object.keys(paths)) {
    const pathItem = paths[path];
    if (!pathItem || typeof pathItem !== 'object') {
      delete paths[path];
      continue;
    }

    for (const method of Object.keys(pathItem)) {
      const key = `${method.toLowerCase()} ${path}`;
      if (!enabled.has(key)) {
        delete pathItem[method];
      }
    }

    if (Object.keys(pathItem).length === 0) {
      delete paths[path];
    }
  }

  doc.paths = paths;
  return doc;
}

function mockFromSchema(
  schema: Record<string, unknown> | undefined,
  strategy: MockStrategyConfig,
  contextKey: string,
): unknown {
  if (!schema) {
    return { message: 'ok' };
  }

  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  if (schema.type === 'object' || typeof schema.properties === 'object') {
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    const out: Record<string, unknown> = {};

    for (const key of Object.keys(props)) {
      const include = strategy.fieldCoverage === 'all' || required.has(key);
      if (!include) continue;

      const propSchema = props[key];
      const fromRule = byRule(strategy.fieldRules[key], key);
      out[key] = fromRule ?? mockFromSchema(propSchema, strategy, `${contextKey}.${key}`);

      if (out[key] === null || out[key] === undefined) {
        out[key] = inferByName(key);
      }
    }

    if (Object.keys(out).length === 0) {
      out.id = faker.string.uuid();
      out.name = faker.person.fullName();
    }

    return out;
  }

  if (schema.type === 'array') {
    const itemsSchema = schema.items as Record<string, unknown> | undefined;
    const count = strategy.random ? faker.number.int({ min: 1, max: 3 }) : 1;
    return Array.from({ length: count }, (_, i) => mockFromSchema(itemsSchema, strategy, `${contextKey}[${i}]`));
  }

  if (schema.type === 'string') {
    if (schema.format === 'email') return faker.internet.email();
    if (schema.format === 'uuid') return faker.string.uuid();
    if (schema.format === 'date-time') return faker.date.recent().toISOString();
    if (schema.format === 'date') return faker.date.past().toISOString().slice(0, 10);
    return faker.lorem.words(2);
  }

  if (schema.type === 'integer') {
    return faker.number.int({ min: toNum(schema.minimum, 1), max: toNum(schema.maximum, 1000) });
  }

  if (schema.type === 'number') {
    return faker.number.float({ min: toNum(schema.minimum, 1), max: toNum(schema.maximum, 1000), fractionDigits: 2 });
  }

  if (schema.type === 'boolean') {
    return faker.datatype.boolean();
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf[0]) {
    return mockFromSchema(schema.oneOf[0] as Record<string, unknown>, strategy, contextKey);
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf[0]) {
    return mockFromSchema(schema.anyOf[0] as Record<string, unknown>, strategy, contextKey);
  }

  return { value: inferByName(contextKey) };
}

function maybeInjectAnomaly(input: unknown, anomalyRate: number): unknown {
  if (anomalyRate <= 0 || !input || typeof input !== 'object') {
    return input;
  }

  const hit = faker.number.int({ min: 1, max: 100 }) <= anomalyRate;
  if (!hit) {
    return input;
  }

  const cloned = structuredClone(input) as Record<string, unknown>;
  const keys = Object.keys(cloned);
  if (keys.length === 0) {
    return input;
  }

  const key = keys[faker.number.int({ min: 0, max: keys.length - 1 })];
  cloned[key] = null;
  return cloned;
}

function byRule(rule: string | undefined, key: string): unknown {
  if (!rule) return null;

  const trimmed = rule.trim();

  if (trimmed === 'faker.internet.email') return faker.internet.email();
  if (trimmed === 'faker.phone.number') return faker.phone.number('1##########');
  if (trimmed === 'faker.person.fullName') return faker.person.fullName();

  const randomMatch = trimmed.match(/^random\((\d+),(\d+)\)$/);
  if (randomMatch) {
    const min = Number(randomMatch[1]);
    const max = Number(randomMatch[2]);
    return faker.number.int({ min, max });
  }

  return inferByName(key);
}

function inferByName(key: string): unknown {
  const lower = key.toLowerCase();
  if (/email/.test(lower)) return faker.internet.email();
  if (/phone|mobile/.test(lower)) return faker.phone.number('1##########');
  if (/name|title|nick/.test(lower)) return faker.person.fullName();
  if (/id$|_id$|uuid/.test(lower)) return faker.string.uuid();
  if (/url|avatar|image/.test(lower)) return faker.image.url();
  if (/price|amount|money/.test(lower)) return faker.number.float({ min: 10, max: 9999, fractionDigits: 2 });
  if (/status/.test(lower)) return 'success';
  return faker.lorem.word();
}

function safeIdentifier(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_$]/g, '_');
  return /^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toNum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}
