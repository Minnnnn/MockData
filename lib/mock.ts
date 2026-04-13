import { faker } from '@faker-js/faker';
import { getFixedImageUrls, pickImageUrl, pickRandomImageSubset } from '@/lib/fixed-image-url';
import { EndpointDefinition, EndpointMock, MockStrategyConfig } from '@/lib/types';

export async function generateTsArtifacts(
  _openapiDocument: unknown,
  endpoints: EndpointDefinition[]
): Promise<{ typesTs: string; apiTs: string }> {
  const typesTs = buildTypesFile(endpoints);
  const apiTs = buildApiFile(endpoints);

  return {
    typesTs,
    apiTs
  };
}

export function generateEndpointMocks(
  endpoints: EndpointDefinition[],
  strategy: MockStrategyConfig
): Record<string, EndpointMock> {
  const result: Record<string, EndpointMock> = {};

  for (const endpoint of endpoints) {
    const count = shouldGenerateMultiplePayloads(endpoint) ? Math.max(strategy.count, 1) : 1;

    const items: unknown[] = [];

    for (let i = 0; i < count; i += 1) {
      if (!strategy.random) {
        faker.seed(hashCode(`${endpoint.id}-${i}`));
      }

      const payload = normalizeGeneratedPayload(
        mockFromSchema(endpoint.responseSchema, strategy, endpoint.path, endpoint)
      );
      items.push(maybeInjectAnomaly(payload, strategy.anomalyRate));
    }

    result[endpoint.id] = {
      endpointId: endpoint.id,
      items,
      runtime: {
        status: endpoint.statusCodes.find((code) => code >= 200 && code < 300) ?? 200,
        delayMs: 0
      }
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
    changedKeys: [...changed]
  };
}

function buildTypesFile(endpoints: EndpointDefinition[]): string {
  if (endpoints.length === 0) {
    return 'export {};';
  }

  const lines: string[] = [];

  for (const endpoint of endpoints) {
    const baseName = buildEndpointTypeName(endpoint);
    const requestType = schemaToTs(endpoint.requestSchema, `${baseName}Request`, 0);
    const responseType = schemaToTs(endpoint.responseSchema, `${baseName}Response`, 0);
    const endpointDescription = endpoint.description || endpoint.summary || endpoint.path;

    lines.push(...buildJsDocLines(`${endpointDescription} - 请求参数`));
    lines.push(`export type ${baseName}Request = ${requestType};`);
    lines.push(...buildJsDocLines(`${endpointDescription} - 响应结果`));
    lines.push(`export type ${baseName}Response = ${responseType};`);
    lines.push('');
  }

  return lines.join('\n').trim();
}

function buildApiFile(endpoints: EndpointDefinition[]): string {
  const lines: string[] = ["import type * as Types from './types';", ''];

  if (endpoints.length === 0) {
    lines.push('export {};');
    return lines.join('\n');
  }

  lines.push(
    'type RequestOptions = {',
    "  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';",
    '  params?: Record<string, unknown>;',
    '  data?: unknown;',
    '};',
    '',
    'declare function customRequest<T>(path: string, options: RequestOptions): Promise<T>;',
    ''
  );

  for (const endpoint of endpoints) {
    const baseName = buildEndpointTypeName(endpoint);
    const fnName = safeIdentifier(endpoint.operationId || `${endpoint.method}_${endpoint.path}`);
    const pathLiteral = buildPathLiteral(endpoint.path);
    const method = endpoint.method.toUpperCase();
    const endpointDescription = endpoint.description || endpoint.summary || endpoint.path;

    lines.push(...buildJsDocLines([endpointDescription, `${method} ${endpoint.path}`]));
    lines.push(`export const ${fnName} = async (`);
    lines.push(`  request?: Types.${baseName}Request,`);
    lines.push(
      `): Promise<Types.${baseName}Response> => {`,
      `  return customRequest(${pathLiteral}, {`,
      `    method: '${method}',`,
      "    params: request as Record<string, unknown>,",
      "    data: request,",
      '  });',
      '};',
      ''
    );
  }

  return lines.join('\n');
}

function buildPathLiteral(path: string): string {
  const normalized = path.replace(/\{([^}]+)\}/g, '${$1}');
  return normalized.includes('${') ? `\`${normalized}\`` : `'${normalized}'`;
}

function buildEndpointTypeName(endpoint: EndpointDefinition): string {
  const source = endpoint.operationId || `${endpoint.method}_${endpoint.path}`;
  return `${toPascalCase(source)}Payload`;
}

function toPascalCase(value: string): string {
  const normalized = value
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();
  const words = normalized ? normalized.split(/\s+/) : ['endpoint'];
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
}

function schemaToTs(schema: Record<string, unknown> | undefined, fallbackName: string, depth: number): string {
  if (!schema) {
    return 'Record<string, unknown>';
  }

  if (schema.$ref && typeof schema.$ref === 'string') {
    return toPascalCase(schema.$ref.split('/').pop() || fallbackName);
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map((item) => JSON.stringify(item)).join(' | ');
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return schema.oneOf
      .map((item, index) => schemaToTs(asSchema(item), `${fallbackName}Option${index + 1}`, depth + 1))
      .join(' | ');
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return schema.anyOf
      .map((item, index) => schemaToTs(asSchema(item), `${fallbackName}Variant${index + 1}`, depth + 1))
      .join(' | ');
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return schema.allOf
      .map((item, index) => schemaToTs(asSchema(item), `${fallbackName}Part${index + 1}`, depth + 1))
      .join(' & ');
  }

  if (schema.type === 'array') {
    return `Array<${schemaToTs(asSchema(schema.items), `${fallbackName}Item`, depth + 1)}>`;
  }

  if (schema.type === 'object' || isRecord(schema.properties)) {
    const properties = isRecord(schema.properties) ? (schema.properties as Record<string, unknown>) : {};
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    const entries = Object.entries(properties);

    if (entries.length === 0) {
      return 'Record<string, unknown>';
    }

    const indent = '  '.repeat(depth + 1);
    const closingIndent = '  '.repeat(depth);
    const lines = entries.flatMap(([key, value]) => {
      const optional = required.has(key) ? '' : '?';
      const propertySchema = asSchema(value);
      const propertyType = schemaToTs(propertySchema, `${fallbackName}${toPascalCase(key)}`, depth + 1);
      const description = propertySchema?.description;
      const commentLines =
        typeof description === 'string' && description.trim()
          ? buildJsDocLines(description, depth + 1)
          : [];

      return [...commentLines, `${indent}${JSON.stringify(key)}${optional}: ${propertyType};`];
    });

    if (schema.additionalProperties) {
      lines.push(
        `${indent}[key: string]: ${schemaToTs(asSchema(schema.additionalProperties), `${fallbackName}Value`, depth + 1)};`
      );
    }

    return `{\n${lines.join('\n')}\n${closingIndent}}`;
  }

  if (schema.type === 'string') return 'string';
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'null') return 'null';
  return 'unknown';
}

function asSchema(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function buildJsDocLines(content: string | string[], depth = 0): string[] {
  const values = Array.isArray(content) ? content : [content];
  const cleaned = values
    .flatMap((item) => String(item).split('\n'))
    .map((item) => item.trim())
    .filter(Boolean);

  if (cleaned.length === 0) {
    return [];
  }

  const indent = '  '.repeat(depth);
  const lines = [`${indent}/**`];
  for (const line of cleaned) {
    lines.push(`${indent} * ${sanitizeComment(line)}`);
  }
  lines.push(`${indent} */`);
  return lines;
}

function sanitizeComment(value: string): string {
  return value.replace(/\*\//g, '* /');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function mockFromSchema(
  schema: Record<string, unknown> | undefined,
  strategy: MockStrategyConfig,
  contextKey: string,
  endpoint: EndpointDefinition
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
    return Array.from({ length: count }, (_, i) =>
      mockFromSchema(itemsSchema, strategy, `${contextKey}[${i}]`, endpoint)
    );
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
        ...(item.properties as Record<string, unknown>)
      };
    }

    if (Array.isArray(item.required)) {
      merged.required = [...new Set([...(merged.required as string[]), ...(item.required as string[])])];
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
  return isArrayDataEndpoint(endpoint);
}

function normalizeGeneratedPayload(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => normalizeGeneratedPayload(item));
  }

  if (!isRecord(input)) {
    return input;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = normalizeGeneratedPayload(value);
  }

  syncPaginationFields(output);
  return output;
}

function syncPaginationFields(record: Record<string, unknown>) {
  const collection = getPaginationCollection(record);
  if (!collection) {
    return;
  }

  const total = collection.length;

  if ('total' in record) {
    record.total = total;
  }

  if ('totalCount' in record) {
    record.totalCount = total;
  }

  if ('hasMore' in record) {
    record.hasMore = false;
  }

  if ('hasmore' in record) {
    record.hasmore = false;
  }
}

function getPaginationCollection(record: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(record.items)) {
    return record.items;
  }

  if (Array.isArray(record.item)) {
    return record.item;
  }

  return null;
}

function getArrayLengthForContext(
  endpoint: EndpointDefinition,
  strategy: MockStrategyConfig,
  contextKey: string
): number {
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
    hour12: false
  });

  return formatter.format(input).replace(' ', ' ');
}

function safeIdentifier(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_$]/g, '_');
  return /^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`;
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
