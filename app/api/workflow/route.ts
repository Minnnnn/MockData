import { NextResponse } from 'next/server';
import { generateEndpointMocks, generateTsArtifacts, tuneMockJsonByPrompt } from '@/lib/mock';
import { parseOpenApiText, selectEnabledEndpoints } from '@/lib/openapi';
import { MockStrategyConfig } from '@/lib/types';

const DEFAULT_STRATEGY: MockStrategyConfig = {
  count: 1,
  random: false,
  aiMode: false,
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

      const tuned = tuneMockJsonByPrompt(jsonText, prompt);
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
