'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Accordion, Button, Card, Checkbox, Chip, TextArea } from '@heroui/react';
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
  const [step, setStep] = useState<'upload' | 'select'>('upload');
  const [openapiText, setOpenapiText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [parseInfo, setParseInfo] = useState<{ title: string; version: string; endpointCount: number } | null>(null);
  const [endpoints, setEndpoints] = useState<EndpointDefinition[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  async function callWorkflow<T>(payload: Record<string, unknown>): Promise<T> {
    const res = await fetch('/api/workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = (await res.json()) as T & WorkflowResponseError;
    if (!res.ok) throw new Error(data.error ?? '请求失败');
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

  async function handleParse() {
    setLoading(true);
    setError(null);
    try {
      const parsed = await callWorkflow<{
        title: string;
        version: string;
        endpointCount: number;
        endpoints: EndpointDefinition[];
      }>({ action: 'parse', openapiText });

      setParseInfo({ title: parsed.title, version: parsed.version, endpointCount: parsed.endpointCount });
      setEndpoints(parsed.endpoints);
      setSelectedIds(parsed.endpoints.map((e) => e.id));
      setStep('select');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateTs() {
    setLoading(true);
    setError(null);
    try {
      const tsData = await callWorkflow<{ typesTs: string; apiTs: string }>({
        action: 'generateTs',
        openapiText,
        enabledIds: selectedIds
      });

      const payload: WorkspaceBootstrap = {
        openapiText,
        parseInfo: parseInfo!,
        endpoints,
        selectedIds,
        typesTs: tsData.typesTs,
        apiTs: tsData.apiTs
      };
      sessionStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify(payload));
      router.push('/workspace');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const tagGroups = useMemo(() => {
    const map = new Map<string, EndpointDefinition[]>();
    for (const ep of endpoints) {
      const tags = ep.tags?.length ? ep.tags : ['未分类'];
      for (const tag of tags) {
        if (!map.has(tag)) map.set(tag, []);
        map.get(tag)!.push(ep);
      }
    }
    return Array.from(map.entries());
  }, [endpoints]);

  const allIds = endpoints.map((e) => e.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));
  const someSelected = !allSelected && selectedIds.length > 0;

  function toggleAll() {
    setSelectedIds(allSelected ? [] : allIds);
  }

  function toggleEndpoint(id: string, checked: boolean) {
    setSelectedIds((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  }

  function toggleGroup(groupIds: string[], checked: boolean) {
    setSelectedIds((prev) => {
      const set = new Set(prev);
      for (const id of groupIds) {
        if (checked) {
          set.add(id);
        } else {
          set.delete(id);
        }
      }
      return Array.from(set);
    });
  }

  if (step === 'upload') {
    return (
      <main className='onboarding-page'>
        <Card className='upload-card' variant='default'>
          <Card.Header className='upload-card__header'>
            <Card.Title>上传 OpenAPI JSON</Card.Title>
            <Card.Description>上传并解析后选择需要生成的接口</Card.Description>
          </Card.Header>

          <Card.Content className='upload-card__content'>
            <input
              type='file'
              accept='application/json,.yaml,.yml'
              className='file-input'
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
              }}
            />

            <TextArea
              value={openapiText}
              onChange={(e) => setOpenapiText(e.target.value)}
              placeholder='或直接粘贴 OpenAPI 3.0 JSON'
              rows={12}
            />

            {error ? <p className='status-text status-text--error'>{error}</p> : null}
          </Card.Content>

          <Card.Footer className='upload-card__footer'>
            <Button variant='primary' isDisabled={loading || !openapiText.trim()} onPress={handleParse}>
              {loading ? '解析中...' : '下一步：解析并选择接口'}
            </Button>
          </Card.Footer>
        </Card>
      </main>
    );
  }

  return (
    <main className='workspace-page'>
      <section className='workspace-header'>
        <div>
          <h1>{parseInfo?.title}</h1>
          <p>
            v{parseInfo?.version} · 共 {endpoints.length} 个接口 · 已选 {selectedIds.length} 个
          </p>
        </div>
        <Button variant='outline' onPress={() => setStep('upload')}>
          重新上传
        </Button>
      </section>

      {error ? <p className='status-text status-text--error'>{error}</p> : null}

      <Card variant='default' className='panel-card'>
        <Card.Header className='panel-card__header'>
          <Card.Title>选择需要生成 TS 类型的接口</Card.Title>
          <Card.Description>默认全选，取消勾选的接口不会生成类型，Mock 数据也会跳过</Card.Description>
        </Card.Header>

        <Card.Content className='panel-card__content'>
          <div className='selection-summary'>
            <label className='select-all-row'>
              <Checkbox isSelected={allSelected} isIndeterminate={someSelected} onChange={toggleAll} />
              <span>{allSelected ? '取消全选' : '全选'}</span>
            </label>
            <span className='select-count'>
              {selectedIds.length} / {allIds.length}
            </span>
          </div>

          <Accordion allowsMultipleExpanded defaultExpandedKeys={tagGroups.map(([tag]) => tag)}>
            {tagGroups.map(([tag, groupEndpoints]) => {
              const groupIds = groupEndpoints.map((e) => e.id);
              const selectedCount = groupIds.filter((id) => selectedIds.includes(id)).length;
              const groupAllSelected = groupIds.every((id) => selectedIds.includes(id));
              const groupSomeSelected = !groupAllSelected && groupIds.some((id) => selectedIds.includes(id));

              return (
                <Accordion.Item key={tag} id={tag}>
                  <Accordion.Heading>
                    <Accordion.Trigger className='workspace-tag-trigger'>
                      <label className='tag-trigger__check' onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          isSelected={groupAllSelected}
                          isIndeterminate={groupSomeSelected}
                          onChange={(checked) => toggleGroup(groupIds, checked)}
                        />
                      </label>
                      <span className='workspace-tag-trigger__name'>{tag}</span>
                      <span className='tag-trigger__count-wrap'>
                        <span className='tag-trigger__selected'>{selectedCount} 已选</span>
                        <span className='workspace-tag-trigger__count'>{groupEndpoints.length} 个接口</span>
                      </span>
                      <Accordion.Indicator />
                    </Accordion.Trigger>
                  </Accordion.Heading>
                  <Accordion.Panel>
                    <Accordion.Body className='workspace-tag-body'>
                      <div className='endpoint-selection-grid'>
                        {groupEndpoints.map((ep) => {
                          const checked = selectedIds.includes(ep.id);
                          return (
                            <Card
                              key={ep.id}
                              variant='default'
                              onClick={() => toggleEndpoint(ep.id, !checked)}
                              className={`endpoint-option-card ${checked ? 'endpoint-option-card--selected' : ''}`}
                            >
                              <Card.Content className='endpoint-option-card__content'>
                                <div className='endpoint-option-card__header'>
                                  <Chip className='endpoint-option-card__method' variant='primary'>
                                    {ep.method.toUpperCase()}
                                  </Chip>
                                  <div className='endpoint-option-card__state' aria-hidden='true'>
                                    <span
                                      className={`endpoint-option-card__indicator ${checked ? 'endpoint-option-card__indicator--selected' : ''}`}
                                    />
                                    <span>{checked ? '已选中' : '未选中'}</span>
                                  </div>
                                </div>
                                <div className='endpoint-option-card__body'>
                                  <strong className='endpoint-option-card__path'>{ep.path}</strong>
                                  <p className='workspace-endpoint-card__description'>
                                    {ep.description ?? ep.summary ?? ep.path}
                                  </p>
                                </div>
                                <label className='select-endpoint-checkbox' onClick={(e) => e.stopPropagation()}>
                                  <Checkbox isSelected={checked} onChange={(v) => toggleEndpoint(ep.id, v)} />
                                </label>
                              </Card.Content>
                            </Card>
                          );
                        })}
                      </div>
                    </Accordion.Body>
                  </Accordion.Panel>
                </Accordion.Item>
              );
            })}
          </Accordion>
        </Card.Content>

        <Card.Footer className='panel-actions'>
          <Button variant='outline' onPress={() => setStep('upload')}>
            上一步
          </Button>
          <Button variant='primary' isDisabled={loading || selectedIds.length === 0} onPress={handleGenerateTs}>
            {loading ? '生成中...' : `下一步：生成 TS 类型（${selectedIds.length} 个接口）`}
          </Button>
        </Card.Footer>
      </Card>
    </main>
  );
}
