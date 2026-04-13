import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { generateEndpointMocks, generateTsArtifacts } from '@/lib/mock';
import { parseOpenApiText, selectEnabledEndpoints } from '@/lib/openapi';
import { MockStrategyConfig } from '@/lib/types';

const DEFAULT_STRATEGY: MockStrategyConfig = {
  count: 1,
  random: false,
  aiMode: true,
  anomalyRate: 0,
  fieldCoverage: 'all',
  fieldRules: {}
};

const TUNE_SYSTEM_PROMPT = `你是一名资深 Mock 数据调优专家和数据一致性审校专家。

你的唯一任务是：基于用户要求，对当前 JSON 做最小必要修改。

必须严格遵守以下规则：
1. 你只能返回合法 JSON。
2. 不要输出解释、备注、markdown、代码围栏或任何额外文本。
3. 保持原始 JSON 的整体结构不变。
4. 保持未被用户明确要求修改的字段完全不变。
5. 当用户只要求调整某个字段、某几个字段、某类字段时，只允许修改这些字段，其他字段的 key、value、顺序、层级都尽量保持原样。
6. 不要擅自补充新字段、删除字段、重命名字段。
7. 不要改变字段类型；字符串保持字符串，数字保持数字，布尔值保持布尔值，数组保持数组，对象保持对象。
8. 如果用户要求与现有 JSON 结构冲突，也只能在最小范围内调整，并优先保留原结构。
9. 如果用户的要求不明确，优先做最保守的修改，不要扩大修改范围。
10. 如果用户要求修改某个字段内容，请只更新该字段的值，不要联动修改其他字段，除非用户明确要求。
11. 输出结果必须可以直接被 JSON.parse 解析。
12. 如果有id字段保证id字段唯一，包括但不限于id, productId，等等任意包含id的字段。
`;

const AI_LOG_PREFIX = '[mock-workflow:tune]';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = String(body.action ?? '');

    if (action === 'tune') {
      const jsonText = String(body.jsonText ?? '');
      const prompt = String(body.prompt ?? '');
      if (!jsonText.trim() || !prompt.trim()) {
        return NextResponse.json({ error: 'jsonText 与 prompt 不能为空。' }, { status: 400 });
      }

      const requestId = createTuneRequestId();
      logTuneRequestStart(requestId, prompt, jsonText);
      const tuned = await tuneMockJsonByPrompt(jsonText, prompt, requestId);
      logTuneRequestSuccess(requestId, tuned.changedKeys, tuned.output);
      return NextResponse.json(tuned);
    }

    const openapiText = String(body.openapiText ?? '');
    if (!openapiText.trim()) {
      return NextResponse.json({ error: 'openapiText 不能为空。' }, { status: 400 });
    }

    const parsed = parseOpenApiText(openapiText);
    const openapiDocument = JSON.parse(openapiText) as Record<string, unknown>;
    const enabledIds = Array.isArray(body.enabledIds) ? (body.enabledIds as string[]) : undefined;
    const selected = selectEnabledEndpoints(parsed.endpoints, enabledIds);

    if (action === 'parse') {
      return NextResponse.json(parsed);
    }

    if (action === 'generateTs') {
      const generated = await generateTsArtifacts(openapiDocument, selected);

      return NextResponse.json({
        endpoints: selected,
        typesTs: generated.typesTs,
        apiTs: generated.apiTs
      });
    }

    if (action === 'generateMock') {
      const strategy: MockStrategyConfig = {
        ...DEFAULT_STRATEGY,
        ...(body.strategy as Partial<MockStrategyConfig>)
      };
      strategy.count = Math.max(1, Number(strategy.count || 1));
      strategy.anomalyRate = Math.max(0, Math.min(30, Number(strategy.anomalyRate || 0)));
      strategy.fieldRules = strategy.fieldRules && typeof strategy.fieldRules === 'object' ? strategy.fieldRules : {};

      return NextResponse.json({
        endpoints: selected,
        mocks: generateEndpointMocks(selected, strategy)
      });
    }

    return NextResponse.json({ error: `未知 action: ${action}` }, { status: 400 });
  } catch (error) {
    logTuneRequestFailure(error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

async function tuneMockJsonByPrompt(
  jsonText: string,
  prompt: string,
  requestId: string
): Promise<{ output: string; changedKeys: string[] }> {
  if (!process.env.API_KEY) {
    throw new Error('缺少 API_KEY，无法执行 AI 调优。');
  }

  if (!process.env.BASE_URL) {
    throw new Error('缺少 BASE_URL，无法执行 AI 调优。');
  }

  const openai = new OpenAI({
    baseURL: process.env.BASE_URL,
    apiKey: process.env.API_KEY
  });

  const completion = await openai.chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      {
        role: 'system',
        content: TUNE_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: buildTuneUserPrompt(prompt, jsonText)
      }
    ]
  });

  console.info(
    `${AI_LOG_PREFIX} requestId=${requestId} requestBody="${summarizeForLog(buildTuneUserPrompt(prompt, jsonText), 240)}"`
  );

  const content = completion.choices[0]?.message?.content;

  console.info(`${AI_LOG_PREFIX} requestId=${requestId} rawResponse="${summarizeForLog(content ?? '', 240)}"`);

  const output = extractJsonText(content);
  const before = JSON.parse(jsonText) as unknown;
  const after = JSON.parse(output) as unknown;

  return {
    output: JSON.stringify(after, null, 2),
    changedKeys: collectChangedKeys(before, after)
  };
}

function extractJsonText(input: string | null | undefined): string {
  if (!input?.trim()) {
    throw new Error('AI 未返回有效内容。');
  }

  const fenced = input.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  return input.trim();
}

function buildTuneUserPrompt(prompt: string, jsonText: string): string {
  return `请根据下面的要求调优当前 JSON。

用户要求：
${prompt}

执行要求：
- 只修改用户明确要求调整的字段
- 其他未提及字段必须保持不变
- 保持原有 JSON 结构与字段类型不变
- 返回结果只能是合法 JSON

当前 JSON：
${jsonText}`;
}

function collectChangedKeys(before: unknown, after: unknown, path: string[] = []): string[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    const output: string[] = [];
    for (let i = 0; i < length; i += 1) {
      output.push(...collectChangedKeys(before[i], after[i], [...path, String(i)]));
    }
    return output;
  }

  if (isRecord(before) && isRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const output: string[] = [];
    for (const key of keys) {
      output.push(...collectChangedKeys(before[key], after[key], [...path, key]));
    }
    return output;
  }

  if (JSON.stringify(before) !== JSON.stringify(after)) {
    return [path.join('.') || 'root'];
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createTuneRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function logTuneRequestStart(requestId: string, prompt: string, jsonText: string) {
  console.info(
    `${AI_LOG_PREFIX} requestId=${requestId} start prompt="${summarizeForLog(prompt, 120)}" payloadChars=${jsonText.length}`
  );
}

function logTuneRequestSuccess(requestId: string, changedKeys: string[], output: string) {
  console.info(
    `${AI_LOG_PREFIX} requestId=${requestId} success changedKeys=${changedKeys.length ? changedKeys.join(',') : 'none'} outputChars=${output.length}`
  );
}

function logTuneRequestFailure(error: unknown) {
  console.error(`${AI_LOG_PREFIX} failure message=${error instanceof Error ? error.message : String(error)}`);
}

function summarizeForLog(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLength)}...`;
}
