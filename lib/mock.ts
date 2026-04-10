import { faker } from '@faker-js/faker';
import { getFixedImageUrls, pickImageUrl, pickRandomImageSubset } from '@/lib/fixed-image-url';
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
    const count = shouldGenerateMultiplePayloads(endpoint) ? Math.max(strategy.count, 1) : 1;

    const items: unknown[] = [];

    for (let i = 0; i < count; i += 1) {
      if (!strategy.random) {
        faker.seed(hashCode(`${endpoint.id}-${i}`));
      }

      const payload = mockFromSchema(endpoint.responseSchema, strategy, endpoint.path, endpoint);
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
  const source = JSON.parse(JSON.stringify(openapiDocument ?? {})) as Record<string, unknown>;
  const sourcePaths = (source.paths ?? {}) as Record<string, Record<string, unknown>>;
  const selectedKeys = new Set(endpoints.map((item) => `${item.method.toLowerCase()} ${item.path}`));
  const nextPaths: Record<string, Record<string, unknown>> = {};

  for (const endpoint of endpoints) {
    const pathItem = sourcePaths[endpoint.path];
    const operation = pathItem?.[endpoint.method];
    if (!pathItem || !operation || typeof operation !== 'object') {
      continue;
    }

    if (!nextPaths[endpoint.path]) {
      nextPaths[endpoint.path] = {};
      for (const key of Object.keys(pathItem)) {
        if (!isHttpMethodKey(key) && key !== '$ref') {
          nextPaths[endpoint.path][key] = pathItem[key];
        }
      }
    }

    nextPaths[endpoint.path][endpoint.method] = operation;
  }

  const nextDoc: Record<string, unknown> = {
    ...source,
    paths: nextPaths,
  };

  const refsToVisit = new Set<string>();
  const visitedRefs = new Set<string>();

  collectRefsFromValue(nextDoc.paths, refsToVisit);

  const sourceComponents = isRecord(source.components) ? (source.components as Record<string, unknown>) : {};
  const nextComponents: Record<string, Record<string, unknown>> = {};

  while (refsToVisit.size > 0) {
    const [ref] = refsToVisit;
    refsToVisit.delete(ref);

    if (visitedRefs.has(ref) || !ref.startsWith('#/components/')) {
      continue;
    }
    visitedRefs.add(ref);

    const segments = ref.slice(2).split('/').map((part) => decodeURIComponent(part));
    if (segments.length < 3) {
      continue;
    }

    const [, sectionName, itemName] = segments;
    const sourceSection = sourceComponents[sectionName];
    if (!isRecord(sourceSection)) {
      continue;
    }

    const sourceItem = sourceSection[itemName];
    if (sourceItem === undefined) {
      continue;
    }

    if (!nextComponents[sectionName]) {
      nextComponents[sectionName] = {};
    }
    nextComponents[sectionName][itemName] = sourceItem as Record<string, unknown>;
    collectRefsFromValue(sourceItem, refsToVisit);
  }

  if (Object.keys(nextComponents).length > 0) {
    nextDoc.components = nextComponents;
  } else {
    delete nextDoc.components;
  }

  if (selectedKeys.size === 0) {
    nextDoc.paths = {};
    delete nextDoc.components;
  }

  return nextDoc;
}

function collectRefsFromValue(value: unknown, refs: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRefsFromValue(item, refs);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (typeof value.$ref === 'string') {
    refs.add(value.$ref);
  }

  for (const key of Object.keys(value)) {
    collectRefsFromValue(value[key], refs);
  }
}

function isHttpMethodKey(value: string): boolean {
  return ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace'].includes(value.toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function mockFromSchema(
  schema: Record<string, unknown> | undefined,
  strategy: MockStrategyConfig,
  contextKey: string,
  endpoint: EndpointDefinition,
): unknown {
  if (!schema) {
    return {};
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

      if (isRcField(key)) {
        out[key] = 0;
        continue;
      }

      const propSchema = props[key];
      const fromRule = byRule(strategy.fieldRules[key], key);
      out[key] = fromRule ?? mockFromSchema(propSchema, strategy, `${contextKey}.${key}`, endpoint);

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
    if (isImageFieldKey(contextKey)) {
      return pickRandomImageSubset(getFixedImageUrls());
    }

    const count = getArrayLengthForContext(endpoint, strategy, contextKey);
    return Array.from({ length: count }, (_, i) => mockFromSchema(itemsSchema, strategy, `${contextKey}[${i}]`, endpoint));
  }

  if (schema.type === 'string') {
    if (schema.format === 'email') return faker.internet.email();
    if (schema.format === 'uuid') return faker.string.uuid();
    if (schema.format === 'date-time') return formatShanghaiDateTime(faker.date.recent());
    if (schema.format === 'date') return formatShanghaiDateTime(faker.date.past());
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
    return mockFromSchema(schema.oneOf[0] as Record<string, unknown>, strategy, contextKey, endpoint);
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf[0]) {
    return mockFromSchema(schema.anyOf[0] as Record<string, unknown>, strategy, contextKey, endpoint);
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return mockFromSchema(mergeAllOfSchemas(schema.allOf as Record<string, unknown>[]), strategy, contextKey, endpoint);
  }

  return { value: inferByName(contextKey) };
}

function mergeAllOfSchemas(items: Record<string, unknown>[]): Record<string, unknown> {
  const merged: Record<string, unknown> = { type: 'object', properties: {}, required: [] };

  for (const item of items) {
    if (item.type && merged.type !== item.type) {
      merged.type = item.type;
    }

    if (item.properties && typeof item.properties === 'object') {
      merged.properties = {
        ...(merged.properties as Record<string, unknown>),
        ...(item.properties as Record<string, unknown>),
      };
    }

    if (Array.isArray(item.required)) {
      merged.required = [...new Set([...(merged.required as string[]), ...item.required as string[]])];
    }

    if (item.items) {
      merged.items = item.items;
    }

    if (item.example !== undefined) {
      merged.example = item.example;
    }

    if (item.default !== undefined) {
      merged.default = item.default;
    }
  }

  return merged;
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
  if (isRcField(lower)) return 0;
  if (/email/.test(lower)) return faker.internet.email();
  if (/phone|mobile/.test(lower)) return faker.phone.number('1##########');
  if (/name|title|nick/.test(lower)) return faker.person.fullName();
  if (/id$|_id$|uuid/.test(lower)) return faker.string.uuid();
  if (/img|image|avatar|cover|pic|photo/.test(lower)) return pickImageUrl();
  if (/time|date|createdat|updatedat|createtime|updatetime/.test(lower)) return formatShanghaiDateTime();
  if (/url/.test(lower)) return 'https://example.com';
  if (/price|amount|money/.test(lower)) return faker.number.float({ min: 10, max: 9999, fractionDigits: 2 });
  if (/status/.test(lower)) return 'success';
  return faker.lorem.word();
}

function shouldGenerateMultiplePayloads(endpoint: EndpointDefinition): boolean {
  return isPaginatedEndpoint(endpoint);
}

function getArrayLengthForContext(endpoint: EndpointDefinition, strategy: MockStrategyConfig, contextKey: string): number {
  if (isPaginatedItemsContext(endpoint, contextKey) || isArrayDataContext(endpoint, contextKey)) {
    return Math.max(strategy.count, 1);
  }

  return 1;
}

function isPaginatedItemsContext(endpoint: EndpointDefinition, contextKey: string): boolean {
  return isPaginatedEndpoint(endpoint) && /\.data\.items(\[\d+\])?$/.test(contextKey);
}

function isArrayDataContext(endpoint: EndpointDefinition, contextKey: string): boolean {
  return isArrayDataEndpoint(endpoint) && /\.data(\[\d+\])?$/.test(contextKey);
}

function isPaginatedEndpoint(endpoint: EndpointDefinition): boolean {
  const lowerPath = endpoint.path.toLowerCase();
  if (/page/.test(lowerPath)) {
    return true;
  }

  const dataSchema = getDataSchema(endpoint.responseSchema);
  if (!dataSchema || !isRecord(dataSchema.properties)) {
    return false;
  }

  const properties = dataSchema.properties as Record<string, unknown>;
  const itemsSchema = properties.items;
  const hasItems = isRecord(itemsSchema) && (itemsSchema.type === 'array' || itemsSchema.items !== undefined);
  const hasTotal = properties.total !== undefined || properties.totalCount !== undefined;

  return hasItems && hasTotal;
}

function isArrayDataEndpoint(endpoint: EndpointDefinition): boolean {
  return getDataSchema(endpoint.responseSchema)?.type === 'array';
}

function getDataSchema(schema?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!schema || !isRecord(schema.properties)) {
    return undefined;
  }

  const data = (schema.properties as Record<string, unknown>).data;
  return isRecord(data) ? data : undefined;
}

function formatShanghaiDateTime(input: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return formatter.format(input).replace(' ', ' ');
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

function isImageFieldKey(key: string): boolean {
  return /(?:^|[.\[_])(img|image|avatar|cover|pic|photo)/i.test(key);
}

function isRcField(key: string): boolean {
  return /(^|[._\[])(rc)(\]|$)/i.test(key);
}

