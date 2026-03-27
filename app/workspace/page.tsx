'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Accordion, Button, Card, Chip, Input, Tabs, TextArea } from '@heroui/react';
import { EndpointDefinition, EndpointMock, MockStrategyConfig, RequestLogEntry, ServerRouteConfig } from '@/lib/types';

type WorkflowResponseError = { error?: string };

type ParseInfo = {
  title: string;
  version: string;
  endpointCount: number;
};

type WorkspaceBootstrap = {
  openapiText: string;
  parseInfo: ParseInfo;
  endpoints: EndpointDefinition[];
  selectedIds: string[];
  typesTs: string;
  apiTs: string;
};

const WORKSPACE_CACHE_KEY = 'mockdata-workspace';
const DEFAULT_PORT = 3666;

const DEFAULT_STRATEGY: MockStrategyConfig = {
  count: 1,
  random: false,
  aiMode: false,
  anomalyRate: 0,
  fieldCoverage: 'all',
  fieldRules: {},
};

export default function WorkspacePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [activeTab, setActiveTab] = useState('types');
  const [mockStep, setMockStep] = useState(1);

  const [openapiText, setOpenapiText] = useState('');
  const [parseInfo, setParseInfo] = useState<ParseInfo | null>(null);
  const [endpoints, setEndpoints] = useState<EndpointDefinition[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [typesTs, setTypesTs] = useState('');
  const [apiTs, setApiTs] = useState('');

  const [strategy, setStrategy] = useState<MockStrategyConfig>(DEFAULT_STRATEGY);
  const [mocks, setMocks] = useState<Record<string, EndpointMock>>({});
  const [activeMockEndpointId, setActiveMockEndpointId] = useState('');
  const [activeMockJson, setActiveMockJson] = useState('[]');
  const [tunePrompt, setTunePrompt] = useState('让返回数据更贴近真实业务场景');
  const [tuneChanges, setTuneChanges] = useState<string[]>([]);

  const [serverRunning, setServerRunning] = useState(false);
  const [logs, setLogs] = useState<RequestLogEntry[]>([]);

  const [loading, setLoading] = useState(false);

  const selectedEndpoints = useMemo(() => {
    const picked = new Set(selectedIds);
    return endpoints.filter((item) => picked.has(item.id));
  }, [endpoints, selectedIds]);

  const groupedEndpoints = useMemo(() => {
    const map = new Map<string, EndpointDefinition[]>();
    for (const item of endpoints) {
      const tags = item.tags?.length ? item.tags : ['未分类'];
      for (const tag of tags) {
        if (!map.has(tag)) {
          map.set(tag, []);
        }
        map.get(tag)!.push(item);
      }
    }
    return Array.from(map.entries());
  }, [endpoints]);

  const canAdjustCount = useMemo(
    () => selectedEndpoints.some((endpoint) => isPaginatedEndpoint(endpoint) || isArrayDataEndpoint(endpoint)),
    [selectedEndpoints],
  );

  const activeEndpoint = selectedEndpoints.find((item) => item.id === activeMockEndpointId) ?? selectedEndpoints[0];

  useEffect(() => {
    const raw = sessionStorage.getItem(WORKSPACE_CACHE_KEY);
    if (!raw) {
      setReady(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as WorkspaceBootstrap;
      setOpenapiText(parsed.openapiText);
      setParseInfo(parsed.parseInfo);
      setEndpoints(parsed.endpoints);
      setSelectedIds(parsed.selectedIds);
      setTypesTs(parsed.typesTs);
      setApiTs(parsed.apiTs);
    } catch {
      sessionStorage.removeItem(WORKSPACE_CACHE_KEY);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!activeEndpoint) {
      setActiveMockJson('[]');
      return;
    }
    setActiveMockJson(JSON.stringify(mocks[activeEndpoint.id]?.items ?? [], null, 2));
  }, [activeEndpoint, mocks]);

  useEffect(() => {
    if (!ready || !parseInfo || !openapiText.trim()) {
      return;
    }

    persistWorkspace({
      openapiText,
      parseInfo,
      endpoints,
      selectedIds,
      typesTs,
      apiTs,
    });
  }, [ready, openapiText, parseInfo, endpoints, selectedIds, typesTs, apiTs]);

  function persistWorkspace(next: Partial<WorkspaceBootstrap>) {
    const payload: WorkspaceBootstrap = {
      openapiText,
      parseInfo: parseInfo ?? { title: '', version: '', endpointCount: 0 },
      endpoints,
      selectedIds,
      typesTs,
      apiTs,
      ...next,
    };
    sessionStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify(payload));
  }

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

  function downloadText(filename: string, text: string) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function toggleEndpoint(id: string, isSelected?: boolean) {
    setSelectedIds((prev) => {
      const currentlySelected = prev.includes(id);
      const nextSelected = typeof isSelected === 'boolean' ? isSelected : !currentlySelected;
      if (nextSelected) {
        return [...new Set([...prev, id])];
      }
      return prev.filter((item) => item !== id);
    });
  }

  async function regenerateTypes() {
    setLoading(true);
    try {
      const data = await callWorkflow<{ typesTs: string; apiTs: string }>({
        action: 'generateTs',
        openapiText,
        enabledIds: selectedIds,
      });
      setTypesTs(data.typesTs);
      setApiTs(data.apiTs);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function generateMockAndContinue() {
    setLoading(true);
    try {
      const data = await callWorkflow<{ mocks: Record<string, EndpointMock> }>({
        action: 'generateMock',
        openapiText,
        enabledIds: selectedIds,
        strategy,
      });
      setMocks(data.mocks);
      const firstId = selectedEndpoints[0]?.id || Object.keys(data.mocks)[0] || '';
      setActiveMockEndpointId(firstId);
      setTuneChanges([]);
      setMockStep(3);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function tuneMock() {
    if (!activeEndpoint) return;

    setLoading(true);
    try {
      const data = await callWorkflow<{ output: string; changedKeys: string[] }>({
        action: 'tune',
        jsonText: activeMockJson,
        prompt: tunePrompt,
      });
      const nextItems = JSON.parse(data.output) as unknown[];
      setMocks((prev) => ({
        ...prev,
        [activeEndpoint.id]: {
          ...(prev[activeEndpoint.id] ?? {
            endpointId: activeEndpoint.id,
            runtime: { status: 200, delayMs: 0 },
          }),
          items: Array.isArray(nextItems) ? nextItems : [nextItems],
        },
      }));
      setTuneChanges(data.changedKeys);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function startService() {
    setLoading(true);
    try {
      const routes: ServerRouteConfig[] = selectedEndpoints.map((endpoint) => {
        const endpointMock = mocks[endpoint.id];
        const payload =
          endpointMock?.items?.length === 1 ? endpointMock.items[0] : (endpointMock?.items ?? { ok: true });
        return {
          endpointId: endpoint.id,
          method: endpoint.method.toUpperCase(),
          path: endpoint.path,
          description: endpoint.description || endpoint.summary || endpoint.operationId || endpoint.path,
          payload,
          totalCount: endpointMock?.items?.length ?? 0,
          status: endpointMock?.runtime.status ?? 200,
          delayMs: endpointMock?.runtime.delayMs ?? 0,
        };
      });

      await fetch('/api/mock-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'configure', routes }),
      });

      const res = await fetch('/api/mock-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', port: DEFAULT_PORT }),
      });
      const state = await res.json();
      setServerRunning(Boolean(state.running));
      await refreshServerState();
    } catch (e) {
      console.error(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function enterServiceStep() {
    await startService();
    setMockStep(4);
  }

  async function refreshServerState() {
    const res = await fetch('/api/mock-server');
    const data = await res.json();
    setLogs(Array.isArray(data.logs) ? data.logs : []);
    setServerRunning(Boolean(data.running));
  }

  async function pushRuntimeToServer(endpointId: string) {
    const runtime = mocks[endpointId]?.runtime;
    if (!runtime) return;
    await fetch('/api/mock-server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateRoute', endpointId, status: runtime.status, delayMs: runtime.delayMs }),
    });
    await refreshServerState();
  }

  function updateRuntime(endpointId: string, key: 'status' | 'delayMs', value: number) {
    setMocks((prev) => {
      const old = prev[endpointId];
      if (!old) return prev;
      return {
        ...prev,
        [endpointId]: {
          ...old,
          runtime: {
            ...old.runtime,
            [key]: value,
          },
        },
      };
    });
  }

  if (!ready) {
    return <main className='workspace-page' />;
  }

  if (!openapiText.trim() || !parseInfo) {
    return (
      <main className='workspace-page'>
        <Card className='workspace-empty' variant='default'>
          <Card.Header>
            <Card.Title>没有可用数据</Card.Title>
            <Card.Description>请先回到第一页上传并解析 OpenAPI JSON</Card.Description>
          </Card.Header>
          <Card.Footer>
            <Button variant='primary' onPress={() => router.push('/')}>
              返回上传页
            </Button>
          </Card.Footer>
        </Card>
      </main>
    );
  }

  return (
    <main className='workspace-page'>
      <section className='workspace-header'>
        <h1>MockData 工作区</h1>
        <p>
          {parseInfo.title} · v{parseInfo.version} · {parseInfo.endpointCount} 个接口
        </p>
      </section>

      <Tabs
        selectedKey={activeTab}
        onSelectionChange={(key) => setActiveTab(String(key))}
        variant='primary'
        className='workspace-tabs'
      >
        <Tabs.List>
          <Tabs.Tab id='types'>TS 类型生成</Tabs.Tab>
          <Tabs.Tab id='mock'>Mock 数据（4步）</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel id='types'>
          <Card variant='default' className='panel-card'>
            <Card.Header className='panel-card__header'>
              <Card.Title>TS 类型预览与下载</Card.Title>
              <Card.Description>可先在 Mock 步骤 1 调整接口勾选，再回来重新生成 TS</Card.Description>
            </Card.Header>
            <Card.Content>
              <TextArea value={typesTs || '// 暂无类型内容'} readOnly rows={16} className='mono-area' />
            </Card.Content>
            <Card.Footer className='panel-actions'>
              <Button variant='outline' onPress={regenerateTypes} isDisabled={selectedIds.length === 0 || loading}>
                重新生成 TS
              </Button>
              <Button variant='outline' onPress={() => downloadText('types.ts', typesTs)} isDisabled={!typesTs}>
                下载 types.ts
              </Button>
              <Button variant='primary' onPress={() => downloadText('api.ts', apiTs)} isDisabled={!apiTs}>
                下载 api.ts
              </Button>
            </Card.Footer>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id='mock'>
          <Card variant='default' className='panel-card'>
            <Card.Header className='panel-card__header'>
              <Card.Title>Mock 数据流程</Card.Title>
            </Card.Header>

            <Card.Content>
              <div className='mock-stepper'>
                {[1, 2, 3, 4].map((item) => (
                  <Button
                    key={item}
                    variant={mockStep === item ? 'primary' : 'outline'}
                    onPress={() => setMockStep(item)}
                  >
                    {item}. {['接口确认', '策略生成', '预览调优', '服务状态'][item - 1]}
                  </Button>
                ))}
              </div>

              {mockStep === 1 ? (
                <section className='step-panel'>
                  <div className='selection-summary'>
                    <p>按照接口 tag 确认要参与 Mock 的结构</p>
                    <span>
                      已选 {selectedIds.length} / {endpoints.length}
                    </span>
                  </div>

                  <Accordion allowsMultipleExpanded defaultExpandedKeys={groupedEndpoints.map(([tag]) => tag)}>
                    {groupedEndpoints.map(([tag, groupItems]) => {
                      const selectedCount = groupItems.filter((item) => selectedIds.includes(item.id)).length;

                      return (
                        <Accordion.Item key={tag} id={tag}>
                          <Accordion.Heading>
                            <Accordion.Trigger className='workspace-tag-trigger'>
                              <span className='workspace-tag-trigger__name'>{tag}</span>
                              <span className='workspace-tag-trigger__count'>
                                {groupItems.length} 个接口 · 已选 {selectedCount}
                              </span>
                              <Accordion.Indicator />
                            </Accordion.Trigger>
                          </Accordion.Heading>
                          <Accordion.Panel>
                            <Accordion.Body className='workspace-tag-body'>
                              <div className='endpoint-selection-grid'>
                                {groupItems.map((item) => {
                                  const selected = selectedIds.includes(item.id);

                                  return (
                                    <Card
                                      key={item.id}
                                      variant='default'
                                      onClick={() => toggleEndpoint(item.id)}
                                      className={`endpoint-option-card ${selected ? 'endpoint-option-card--selected' : ''}`}
                                    >
                                      <Card.Content className='endpoint-option-card__content'>
                                        <div className='endpoint-option-card__header'>
                                          <Chip className='endpoint-option-card__method' variant='primary'>
                                            {item.method.toUpperCase()}
                                          </Chip>
                                          <div className='endpoint-option-card__state' aria-hidden='true'>
                                            <span
                                              className={`endpoint-option-card__indicator ${selected ? 'endpoint-option-card__indicator--selected' : ''}`}
                                            />
                                            <span>{selected ? '已选中' : '未选中'}</span>
                                          </div>
                                        </div>
                                        <div className='endpoint-option-card__body'>
                                          <strong className='endpoint-option-card__path'>{item.path}</strong>
                                          <p className='workspace-endpoint-card__description'>
                                            {item.description || item.summary || item.operationId || '暂无描述'}
                                          </p>
                                        </div>
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

                  <div className='panel-actions'>
                    <Button variant='outline' onPress={regenerateTypes} isDisabled={selectedIds.length === 0 || loading}>
                      同步并更新 TS
                    </Button>
                    <Button variant='primary' onPress={() => setMockStep(2)} isDisabled={selectedIds.length === 0}>
                      下一步
                    </Button>
                  </div>
                </section>
              ) : null}

              {mockStep === 2 ? (
                <section className='step-panel'>
                  <div className='form-grid'>
                    <label className='native-field'>
                      数据条数
                      <Input
                        type='number'
                        min={1}
                        value={String(canAdjustCount ? strategy.count : 1)}
                        disabled={!canAdjustCount}
                        onChange={(event) =>
                          setStrategy((prev) => ({ ...prev, count: Math.max(1, Number(event.target.value) || 1) }))
                        }
                      />
                      <small className='native-field__hint'>仅对分页接口或 `data` 为数组的接口生效，其他接口固定生成 1 条。</small>
                    </label>
                    <label className='native-field'>
                      AI 模式
                      <select
                        value={strategy.aiMode ? 'on' : 'off'}
                        onChange={(event) => setStrategy((prev) => ({ ...prev, aiMode: event.target.value === 'on' }))}
                      >
                        <option value='off'>关闭</option>
                        <option value='on'>开启</option>
                      </select>
                    </label>
                  </div>
                  <div className='panel-actions'>
                    <Button variant='outline' onPress={() => setMockStep(1)}>
                      上一步
                    </Button>
                    <Button
                      variant='primary'
                      onPress={generateMockAndContinue}
                      isDisabled={selectedIds.length === 0 || loading}
                    >
                      生成 Mock 并下一步
                    </Button>
                  </div>
                </section>
              ) : null}

              {mockStep === 3 ? (
                <section className='step-panel'>
                  <label className='native-field'>
                    当前接口
                    <select
                      value={activeEndpoint?.id ?? ''}
                      onChange={(event) => setActiveMockEndpointId(event.target.value)}
                    >
                      {selectedEndpoints.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.method.toUpperCase()} {item.path}
                        </option>
                      ))}
                    </select>
                  </label>

                  <TextArea value={activeMockJson} readOnly rows={12} className='mono-area' />
                  {strategy.aiMode ? (
                    <>
                      <label className='native-field'>
                        调优指令
                        <TextArea value={tunePrompt} onChange={(event) => setTunePrompt(event.target.value)} rows={3} />
                      </label>
                      <p className='status-text'>变更字段：{tuneChanges.length ? tuneChanges.join(', ') : '暂无'}</p>
                    </>
                  ) : null}
                  <div className='panel-actions'>
                    <Button variant='outline' onPress={() => setMockStep(2)}>
                      上一步
                    </Button>
                    {strategy.aiMode ? (
                      <Button variant='outline' onPress={tuneMock} isDisabled={loading || !activeEndpoint}>
                        调优
                      </Button>
                    ) : null}
                    <Button
                      variant='primary'
                      onPress={enterServiceStep}
                      isDisabled={loading || selectedEndpoints.length === 0}
                    >
                      下一步
                    </Button>
                  </div>
                </section>
              ) : null}

              {mockStep === 4 ? (
                <section className='step-panel'>
                  <div className='panel-actions'>
                    <Button variant='outline' onPress={() => setMockStep(3)}>
                      返回预览
                    </Button>
                    <Button variant='outline' onPress={refreshServerState}>
                      刷新日志
                    </Button>
                    <span className='status-pill'>{serverRunning ? '服务运行中' : '服务未启动'}</span>
                  </div>

                  <div className='server-grid'>
                    {selectedEndpoints.map((endpoint) => {
                      const runtime = mocks[endpoint.id]?.runtime ?? { status: 200, delayMs: 0 };
                      return (
                        <Card key={endpoint.id} variant='default' className='server-card'>
                          <Card.Header>
                            <Card.Title>
                              {endpoint.method.toUpperCase()} {endpoint.path}
                            </Card.Title>
                          </Card.Header>
                          <Card.Content>
                            <div className='runtime-grid'>
                              <label className='native-field'>
                                状态码
                                <select
                                  value={runtime.status}
                                  onChange={(event) => updateRuntime(endpoint.id, 'status', Number(event.target.value))}
                                >
                                  {[200, 403, 500].map((code) => (
                                    <option key={code} value={code}>
                                      {code}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className='native-field'>
                                延迟
                                <select
                                  value={runtime.delayMs}
                                  onChange={(event) => updateRuntime(endpoint.id, 'delayMs', Number(event.target.value))}
                                >
                                  {[0, 500, 2000].map((delay) => (
                                    <option key={delay} value={delay}>
                                      {delay}ms
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <Button variant='outline' onPress={() => pushRuntimeToServer(endpoint.id)} isDisabled={loading}>
                                热更新
                              </Button>
                            </div>
                            <pre className='mono-block'>{`curl http://localhost:${DEFAULT_PORT}/mock-api${endpoint.path}`}</pre>
                          </Card.Content>
                        </Card>
                      );
                    })}
                  </div>

                  <Card variant='default'>
                    <Card.Header>
                      <Card.Title>请求日志</Card.Title>
                    </Card.Header>
                    <Card.Content className='log-list'>
                      {logs.length === 0 ? <p className='status-text'>暂无日志</p> : null}
                      {logs.map((log) => (
                        <div key={log.id} className='log-row'>
                          <span>{new Date(log.time).toLocaleString()}</span>
                          <span>{log.method}</span>
                          <span>{log.path}</span>
                          <span>{log.status}</span>
                          <span>{log.delayMs}ms</span>
                        </div>
                      ))}
                    </Card.Content>
                  </Card>
                </section>
              ) : null}
            </Card.Content>
          </Card>
        </Tabs.Panel>
      </Tabs>
    </main>
  );
}

function isPaginatedEndpoint(endpoint: EndpointDefinition): boolean {
  const lowerPath = endpoint.path.toLowerCase();
  if (/page/.test(lowerPath)) {
    return true;
  }

  return hasPaginatedShape(endpoint.responseSchema);
}

function isArrayDataEndpoint(endpoint: EndpointDefinition): boolean {
  return getDataSchema(endpoint.responseSchema)?.type === 'array';
}

function hasPaginatedShape(schema?: Record<string, unknown>): boolean {
  const dataSchema = getDataSchema(schema);
  if (!dataSchema || !isRecord(dataSchema.properties)) {
    return false;
  }

  const properties = dataSchema.properties;
  const hasItems = isRecord(properties.items) && (properties.items.type === 'array' || properties.items.items !== undefined);
  const hasTotal = properties.total !== undefined || properties.totalCount !== undefined;

  return hasItems && hasTotal;
}

function getDataSchema(schema?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!schema || !isRecord(schema.properties) || !isRecord(schema.properties.data)) {
    return undefined;
  }

  return schema.properties.data;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
