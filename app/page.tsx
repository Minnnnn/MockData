'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, Input, TextArea } from '@heroui/react';
import { EndpointDefinition } from '@/lib/types';

type WorkflowResponseError = { error?: string };

type WorkspaceBootstrap = {
  openapiText: string;
  parseInfo: {
    title: string;
    version: string;
    endpointCount: number;
  };
  endpoints: EndpointDefinition[];
  selectedIds: string[];
  typesTs: string;
  apiTs: string;
};

const WORKSPACE_CACHE_KEY = 'mockdata-workspace';

export default function Home() {
  const router = useRouter();
  const [openapiText, setOpenapiText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function callWorkflow<T>(payload: Record<string, unknown>): Promise<T> {
    const res = await fetch('/api/workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as T & WorkflowResponseError;
    if (!res.ok) {
      throw new Error(data.error ?? '请求失败');
    }
    return data;
  }

  function onUpload(file: File) {
    file
      .text()
      .then((text) => {
        setOpenapiText(text);
        setError(null);
      })
      .catch(() => setError('读取文件失败，请重新上传。'));
  }

  async function parseAndGenerateTs() {
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const parsed = await callWorkflow<{
        title: string;
        version: string;
        endpointCount: number;
        endpoints: EndpointDefinition[];
      }>({
        action: 'parse',
        openapiText,
      });

      const selectedIds = parsed.endpoints.map((item) => item.id);
      const tsData = await callWorkflow<{ typesTs: string; apiTs: string }>({
        action: 'generateTs',
        openapiText,
        enabledIds: selectedIds,
      });

      const payload: WorkspaceBootstrap = {
        openapiText,
        parseInfo: {
          title: parsed.title,
          version: parsed.version,
          endpointCount: parsed.endpointCount,
        },
        endpoints: parsed.endpoints,
        selectedIds,
        typesTs: tsData.typesTs,
        apiTs: tsData.apiTs,
      };

      sessionStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify(payload));
      setNotice('解析成功，正在进入下一页...');
      router.push('/workspace');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className='onboarding-page'>
      <Card className='upload-card' variant='default'>
        <Card.Header className='upload-card__header'>
          <Card.Title>上传 OpenAPI JSON</Card.Title>
          <Card.Description>黑白灰主题工作台，第一步先上传并解析生成 TS 类型</Card.Description>
        </Card.Header>

        <Card.Content className='upload-card__content'>
          <Input
            type='file'
            accept='application/json'
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
            }}
          />

          <TextArea
            value={openapiText}
            onChange={(event) => setOpenapiText(event.target.value)}
            placeholder='或直接粘贴 OpenAPI 3.0 JSON'
            rows={12}
          />

          {error ? <p className='status-text status-text--error'>{error}</p> : null}
          {notice ? <p className='status-text status-text--notice'>{notice}</p> : null}
        </Card.Content>

        <Card.Footer className='upload-card__footer'>
          <Button variant='primary' isDisabled={loading || !openapiText.trim()} onPress={parseAndGenerateTs}>
            {loading ? '处理中...' : '下一步：解析 JSON 并生成 TS'}
          </Button>
        </Card.Footer>
      </Card>
    </main>
  );
}
