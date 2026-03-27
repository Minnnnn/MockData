'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Checkbox, Input, Tabs, TextArea } from '@heroui/react';
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

const DEFAULT_STRATEGY: MockStrategyConfig = {
  count: 1,
  random: false,
  aiMode: false,
  anomalyRate: 0,
  fieldCoverage: 'all',
  fieldRules: {
    email: 'faker.internet.email',
    phone: 'faker.phone.number',
    price: 'random(10,1000)',
  },
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
  const [fieldRulesText, setFieldRulesText] = useState(JSON.stringify(DEFAULT_STRATEGY.fieldRules, null, 2));

  const [mocks, setMocks] = useState<Record<string, EndpointMock>>({});
  const [activeMockEndpointId, setActiveMockEndpointId] = useState('');
  const [activeMockJson, setActiveMockJson] = useState('[]');
  const [tunePrompt, setTunePrompt] = useState('这个用户昵称太假了，改成更真实一点');
  const [tuneChanges, setTuneChanges] = useState<string[]>([]);

  const [serverRunning, setServerRunning] = useState(false);
  const [port, setPort] = useState(3000);
  const [logs, setLogs] = useState<RequestLogEntry[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedEndpoints = useMemo(() => {
    const picked = new Set(selectedIds);
    return endpoints.filter((item) => picked.has(item.id));
  }, [endpoints, selectedIds]);

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
      setError('缓存读取失败，请重新上传 JSON。');
    } finally {
      setReady(true);
    }
  }, []);

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

  async function regenerateTypes() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = await callWorkflow<{ typesTs: string; apiTs: string }>({
        action: 'generateTs',
        openapiText,
        enabledIds: selectedIds,
      });
      setTypesTs(data.typesTs);
      setApiTs(data.apiTs);
      persistWorkspace({ selectedIds, typesTs: data.typesTs, apiTs: data.apiTs });
      setNotice('TS 类型已更新');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function generateMock() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const fieldRules = JSON.parse(fieldRulesText) as Record<string, string>;
      const data = await callWorkflow<{ mocks: Record<string, EndpointMock> }>({
        action: 'generateMock',
        openapiText,
        enabledIds: selectedIds,
        strategy: { ...strategy, fieldRules },
      });
      setMocks(data.mocks);
      const firstId = selectedEndpoints[0]?.id || Object.keys(data.mocks)[0] || '';
      setActiveMockEndpointId(firstId);
      setActiveMockJson(JSON.stringify(data.mocks[firstId]?.items ?? [], null, 2));
      setMockStep(3);
      setNotice('Mock 数据生成完成');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function tuneMock() {
    setLoading(true);
    setError(null);
    try {
      const data = await callWorkflow<{ output: string; changedKeys: string[] }>({
        action: 'tune',
        jsonText: activeMockJson,
        prompt: tunePrompt,
      });
      setActiveMockJson(data.output);
      setTuneChanges(data.changedKeys);
      setNotice(`调优完成，变更 ${data.changedKeys.length} 项`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function syncCurrentMock() {
    if (!activeEndpoint) return;
    try {
      const value = JSON.parse(activeMockJson);
      setMocks((prev) => ({
        ...prev,
        [activeEndpoint.id]: {
          ...(prev[activeEndpoint.id] ?? {
            endpointId: activeEndpoint.id,
            runtime: { status: 200, delayMs: 0 },
          }),
          items: Array.isArray(value) ? value : [value],
        },
      }));
      setError(null);
      setNotice('当前 JSON 已同步');
    } catch {
      setError('JSON 不合法，无法同步');
    }
  }

  async function startService() {
    setLoading(true);
    setError(null);
    try {
      const routes: ServerRouteConfig[] = selectedEndpoints.map((endpoint) => {
        const endpointMock = mocks[endpoint.id];
        const payload = endpointMock?.items?.length === 1 ? endpointMock.items[0] : endpointMock?.items ?? { ok: true };
        return {
          endpointId: endpoint.id,
          method: endpoint.method.toUpperCase(),
          path: endpoint.path,
          payload,
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
        body: JSON.stringify({ action: 'start', port }),
      });
      const state = await res.json();
      setServerRunning(Boolean(state.running));
      await refreshServerState();
      setNotice(`服务已启动，逻辑端口 ${state.port}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function stopService() {
    setLoading(true);
    try {
      await fetch('/api/mock-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      setServerRunning(false);
      setNotice('服务已停止');
    } finally {
      setLoading(false);
    }
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
    return (
      <main className='workspace-page'>
        <p className='status-text'>正在加载工作区...</p>
      </main>
    );
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

      {loading ? <p className='status-text'>处理中...</p> : null}
      {error ? <p className='status-text status-text--error'>{error}</p> : null}
      {notice ? <p className='status-text status-text--notice'>{notice}</p> : null}

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
              <Card.Description>四步：结构确认 → 策略生成 → 预览调优 → 启动服务</Card.Description>
            </Card.Header>

            <Card.Content>
              <div className='mock-stepper'>
                {[1, 2, 3, 4].map((item) => (
                  <Button
                    key={item}
                    variant={mockStep === item ? 'primary' : 'outline'}
                    onPress={() => setMockStep(item)}
                  >
                    {item}. {['结构确认', '策略生成', '预览调优', '启动服务'][item - 1]}
                  </Button>
                ))}
              </div>

              {mockStep === 1 ? (
                <section className='step-panel'>
                  {endpoints.map((item) => {
                    const checked = selectedIds.includes(item.id);
                    return (
                      <label key={item.id} className='endpoint-row'>
                        <Checkbox
                          isSelected={checked}
                          onChange={(isSelected) => {
                            if (isSelected) {
                              setSelectedIds((prev) => [...new Set([...prev, item.id])]);
                            } else {
                              setSelectedIds((prev) => prev.filter((id) => id !== item.id));
                            }
                          }}
                        />
                        <div>
                          <strong>
                            {item.method.toUpperCase()} {item.path}
                          </strong>
                          <small>{item.operationId || item.summary || '无描述'}</small>
                        </div>
                      </label>
                    );
                  })}
                  <div className='panel-actions'>
                    <Button variant='outline' onPress={regenerateTypes} isDisabled={selectedIds.length === 0 || loading}>
                      同步并更新 TS
                    </Button>
                    <Button
                      variant='primary'
                      onPress={() => {
                        persistWorkspace({ selectedIds });
                        setMockStep(2);
                      }}
                    >
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
                        value={String(strategy.count)}
                        onChange={(event) =>
                          setStrategy((prev) => ({ ...prev, count: Math.max(1, Number(event.target.value) || 1) }))
                        }
                      />
                    </label>
                    <label className='native-field'>
                      随机模式
                      <select
                        value={strategy.random ? 'random' : 'fixed'}
                        onChange={(event) => setStrategy((prev) => ({ ...prev, random: event.target.value === 'random' }))}
                      >
                        <option value='fixed'>固定</option>
                        <option value='random'>随机</option>
                      </select>
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
                    <label className='native-field'>
                      异常比例 (0-30)
                      <Input
                        type='number'
                        min={0}
                        max={30}
                        value={String(strategy.anomalyRate)}
                        onChange={(event) =>
                          setStrategy((prev) => ({
                            ...prev,
                            anomalyRate: Math.max(0, Math.min(30, Number(event.target.value) || 0)),
                          }))
                        }
                      />
                    </label>
                    <label className='native-field'>
                      字段覆盖
                      <select
                        value={strategy.fieldCoverage}
                        onChange={(event) =>
                          setStrategy((prev) => ({ ...prev, fieldCoverage: event.target.value === 'key' ? 'key' : 'all' }))
                        }
                      >
                        <option value='all'>全字段</option>
                        <option value='key'>关键字段</option>
                      </select>
                    </label>
                  </div>
                  <label className='native-field'>
                    字段规则 JSON
                    <TextArea value={fieldRulesText} onChange={(event) => setFieldRulesText(event.target.value)} rows={8} className='mono-area' />
                  </label>
                  <div className='panel-actions'>
                    <Button variant='outline' onPress={() => setMockStep(1)}>
                      上一步
                    </Button>
                    <Button variant='primary' onPress={generateMock} isDisabled={selectedIds.length === 0 || loading}>
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
                      onChange={(event) => {
                        const id = event.target.value;
                        setActiveMockEndpointId(id);
                        setActiveMockJson(JSON.stringify(mocks[id]?.items ?? [], null, 2));
                      }}
                    >
                      {selectedEndpoints.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.method.toUpperCase()} {item.path}
                        </option>
                      ))}
                    </select>
                  </label>

                  <TextArea value={activeMockJson} onChange={(event) => setActiveMockJson(event.target.value)} rows={12} className='mono-area' />
                  <label className='native-field'>
                    调优指令
                    <TextArea value={tunePrompt} onChange={(event) => setTunePrompt(event.target.value)} rows={3} />
                  </label>
                  <p className='status-text'>变更字段：{tuneChanges.length ? tuneChanges.join(', ') : '暂无'}</p>
                  <div className='panel-actions'>
                    <Button variant='outline' onPress={() => setMockStep(2)}>
                      上一步
                    </Button>
                    <Button variant='outline' onPress={tuneMock} isDisabled={loading}>
                      调优
                    </Button>
                    <Button variant='outline' onPress={syncCurrentMock}>
                      同步 JSON
                    </Button>
                    <Button variant='outline' onPress={() => downloadText('mock.json', activeMockJson)}>
                      下载 JSON
                    </Button>
                    <Button
                      variant='primary'
                      onPress={() => {
                        syncCurrentMock();
                        setMockStep(4);
                      }}
                    >
                      下一步
                    </Button>
                  </div>
                </section>
              ) : null}

              {mockStep === 4 ? (
                <section className='step-panel'>
                  <div className='panel-actions'>
                    <label className='native-field'>
                      端口
                      <Input type='number' value={String(port)} onChange={(event) => setPort(Number(event.target.value) || 3000)} />
                    </label>
                    <Button variant='outline' onPress={() => setMockStep(3)}>
                      上一步
                    </Button>
                    <Button variant='primary' isDisabled={loading || selectedEndpoints.length === 0} onPress={startService}>
                      启动服务
                    </Button>
                    <Button variant='outline' isDisabled={loading || !serverRunning} onPress={stopService}>
                      停止服务
                    </Button>
                    <Button variant='outline' onPress={refreshServerState}>
                      刷新日志
                    </Button>
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
                              <Button variant='outline' onPress={() => pushRuntimeToServer(endpoint.id)}>
                                热更新
                              </Button>
                            </div>
                            <pre className='mono-block'>{`curl http://localhost:${port}/api/mock${endpoint.path}`}</pre>
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
