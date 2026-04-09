import { NextResponse } from 'next/server';
import { generateEndpointMocks, generateTsArtifacts } from '@/lib/mock';
import { parseOpenApiText } from '@/lib/openapi';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const openapi = body.openapi || body.openApi || body.document;
    const openapiText = JSON.stringify(openapi ?? {});

    const parsed = parseOpenApiText(openapiText);
    const endpoints = parsed.endpoints;
    const generated = await generateTsArtifacts(openapi ?? {}, endpoints);

    const mocks = generateEndpointMocks(endpoints, {
      count: 1,
      random: false,
      aiMode: true,
      anomalyRate: 0,
      fieldCoverage: 'all',
      fieldRules: {},
    });

    const mockData: Record<string, unknown> = {};
    for (const endpoint of endpoints) {
      const item = mocks[endpoint.id];
      mockData[`${endpoint.method.toUpperCase()} ${endpoint.path}`] = {
        response: item?.items?.[0] ?? null,
      };
    }

    return NextResponse.json({
      endpoints,
      mockData,
      tsTypes: generated.typesTs,
    });
  } catch (error) {
    return NextResponse.json({ error: `解析失败: ${(error as Error).message}` }, { status: 500 });
  }
}
