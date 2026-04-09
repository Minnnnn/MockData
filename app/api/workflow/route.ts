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
  fieldRules: {},
};

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

      const tuned = await tuneMockJsonByPrompt(jsonText, prompt);
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
        apiTs: generated.apiTs,
      });
    }

    if (action === 'generateMock') {
      const strategy: MockStrategyConfig = {
        ...DEFAULT_STRATEGY,
        ...(body.strategy as Partial<MockStrategyConfig>),
      };
      strategy.count = Math.max(1, Number(strategy.count || 1));
      strategy.anomalyRate = Math.max(0, Math.min(30, Number(strategy.anomalyRate || 0)));
      strategy.fieldRules = strategy.fieldRules && typeof strategy.fieldRules === 'object' ? strategy.fieldRules : {};

      return NextResponse.json({
        endpoints: selected,
        mocks: generateEndpointMocks(selected, strategy),
      });
    }

    return NextResponse.json({ error: `未知 action: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

async function tuneMockJsonByPrompt(jsonText: string, prompt: string): Promise<{ output: string; changedKeys: string[] }> {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('缺少 DEEPSEEK_API_KEY，无法执行 AI 调优。');
  }

  const openai = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
  });

  const completion = await openai.chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      {
        role: 'system',
        content:
          '你是一个严格输出 JSON 的 Mock 数据调优助手。你只能返回合法 JSON，不要输出解释、markdown、代码围栏或额外文本。保持原有 JSON 的整体结构与字段类型，结合用户要求优化内容真实性。',
      },
      {
        role: 'user',
        content: `用户调优要求：${prompt}\n\n当前 JSON：\n${jsonText}`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  const output = extractJsonText(content);
  const before = JSON.parse(jsonText) as unknown;
  const after = JSON.parse(output) as unknown;

  return {
    output: JSON.stringify(after, null, 2),
    changedKeys: collectChangedKeys(before, after),
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
