'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Accordion, Alert, Button, Card, Chip, Input, Spinner, Tabs, TextArea } from '@heroui/react';
import { TuneAssistantDialog } from '@/components/tune-assistant-dialog';
import {
  applyPersistedTunedMocks,
  buildWorkspaceId,
  deletePersistedTunedMocks,
  listPersistedTunedMocks,
  savePersistedTunedMock
} from '@/lib/tuned-mock-db';
import { EndpointDefinition, EndpointMock, MockStrategyConfig, ServerRouteConfig } from '@/lib/types';

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
  aiMode: true,
  anomalyRate: 0,
  fieldCoverage: 'all',
  fieldRules: {}
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
  const [mockDrafts, setMockDrafts] = useState<Record<string, string>>({});
  const [mockDraftErrors, setMockDraftErrors] = useState<Record<string, string>>({});
  const [activeMockEndpointId, setActiveMockEndpointId] = useState('');
  const [tunePrompt, setTunePrompt] = useState('让返回数据更贴近真实业务场景');
  const [tuneTargetIds, setTuneTargetIds] = useState<string[]>([]);
  const [tunedEndpointIds, setTunedEndpointIds] = useState<string[]>([]);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [inlineTuneOpen, setInlineTuneOpen] = useState<Record<string, boolean>>({});
  const [inlineTunePrompts, setInlineTunePrompts] = useState<Record<string, string>>({});
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [endpointUpdateState, setEndpointUpdateState] = useState<
    Record<string, 'idle' | 'loading' | 'success' | 'error'>
  >({});

  const [serverRunning, setServerRunning] = useState(false);

  const [loading, setLoading] = useState(false);
  const mockDraftSourceRef = useRef<Record<string, string>>({});

  const selectedEndpoints = useMemo(() => {
    const picked = new Set(selectedIds);
    return endpoints.filter((item) => picked.has(item.id));
  }, [endpoints, selectedIds]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedEndpointIdSet = useMemo(() => new Set(selectedEndpoints.map((item) => item.id)), [selectedEndpoints]);

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
  const defaultExpandedTags = useMemo(() => (groupedEndpoints[0] ? [groupedEndpoints[0][0]] : []), [groupedEndpoints]);
  const tunedEndpointIdSet = useMemo(() => new Set(tunedEndpointIds), [tunedEndpointIds]);
  const activeEndpoint = useMemo(
    () => selectedEndpoints.find((item) => item.id === activeMockEndpointId) ?? selectedEndpoints[0] ?? null,
    [selectedEndpoints, activeMockEndpointId]
  );

  const canAdjustCount = useMemo(
    () => selectedEndpoints.some((endpoint) => isPaginatedEndpoint(endpoint) || isArrayDataEndpoint(endpoint)),
    [selectedEndpoints]
  );

  const workspaceId = useMemo(() => buildWorkspaceId(openapiText), [openapiText]);

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
    if (!ready || !parseInfo || !openapiText.trim()) {
      return;
    }

    const payload: WorkspaceBootstrap = {
      openapiText,
      parseInfo,
      endpoints,
      selectedIds,
      typesTs,
      apiTs
    };
    sessionStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify(payload));
  }, [ready, openapiText, parseInfo, endpoints, selectedIds, typesTs, apiTs]);

  useEffect(() => {
    if (!ready || !workspaceId) {
      return;
    }

    void (async () => {
      const records = await listPersistedTunedMocks(workspaceId);
      setTunedEndpointIds(records.map((item) => item.endpointId));
    })();
  }, [ready, workspaceId]);

  useEffect(() => {
    if (!selectedEndpoints.length) {
      return;
    }

    const firstId = selectedEndpoints[0]?.id ?? '';
    if (!activeMockEndpointId || !selectedEndpointIdSet.has(activeMockEndpointId)) {
      setActiveMockEndpointId(firstId);
    }

    setTuneTargetIds((prev) => prev.filter((id) => selectedEndpointIdSet.has(id)));
  }, [selectedEndpoints, selectedEndpointIdSet, activeMockEndpointId]);

  useEffect(() => {
    const nextSource: Record<string, string> = {};
    for (const [endpointId, endpointMock] of Object.entries(mocks)) {
      nextSource[endpointId] = JSON.stringify(getEditableMockPayload(endpointMock), null, 2);
    }

    setMockDrafts((prev) => {
      const nextDrafts: Record<string, string> = {};
      let changed = false;

      for (const [endpointId, serialized] of Object.entries(nextSource)) {
        const previousDraft = prev[endpointId];
        const previousSource = mockDraftSourceRef.current[endpointId];
        const nextDraft = previousDraft === undefined || previousDraft === previousSource ? serialized : previousDraft;
        nextDrafts[endpointId] = nextDraft;
        if (nextDraft !== previousDraft) {
          changed = true;
        }
      }

      if (Object.keys(prev).length !== Object.keys(nextDrafts).length) {
        changed = true;
      }

      mockDraftSourceRef.current = nextSource;
      return changed ? nextDrafts : prev;
    });

    setMockDraftErrors((prev) => {
      const nextEntries = Object.entries(prev).filter(([endpointId]) => endpointId in nextSource);
      if (nextEntries.length === Object.keys(prev).length) {
        return prev;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [mocks]);

  useEffect(() => {
    setInlineTunePrompts((prev) => {
      const next = { ...prev };
      for (const endpoint of selectedEndpoints) {
        if (!next[endpoint.id]) {
          next[endpoint.id] = '';
        }
      }
      return next;
    });
  }, [selectedEndpoints]);

  async function callWorkflow<T>(payload: Record<string, unknown>): Promise<T> {
    const res = await fetch('/api/workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
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

  async function resetWorkspace() {
    setLoading(true);
    try {
      sessionStorage.removeItem(WORKSPACE_CACHE_KEY);
      await fetch('/api/mock-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' })
      });

      setActiveTab('types');
      setMockStep(1);
      setOpenapiText('');
      setParseInfo(null);
      setEndpoints([]);
      setSelectedIds([]);
      setTypesTs('');
      setApiTs('');
      setStrategy(DEFAULT_STRATEGY);
      setMocks({});
      setMockDrafts({});
      setMockDraftErrors({});
      setActiveMockEndpointId('');
      setTunePrompt('让返回数据更贴近真实业务场景');
      setTuneTargetIds([]);
      setTunedEndpointIds([]);
      setAssistantOpen(false);
      setInlineTuneOpen({});
      setInlineTunePrompts({});
      setActionMessage(null);
      setEndpointUpdateState({});
      setServerRunning(false);

      router.push('/');
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
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

  function selectAllEndpoints() {
    setSelectedIds(endpoints.map((item) => item.id));
  }

  function invertSelectedEndpoints() {
    const selected = new Set(selectedIds);
    setSelectedIds(endpoints.filter((item) => !selected.has(item.id)).map((item) => item.id));
  }

  async function regenerateTypes() {
    setLoading(true);
    try {
      const data = await callWorkflow<{ typesTs: string; apiTs: string }>({
        action: 'generateTs',
        openapiText,
        enabledIds: selectedIds
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
        strategy
      });
      const nextMocks = await applyPersistedTunedMocks(workspaceId, data.mocks);
      setMocks(nextMocks);
      const firstId = selectedEndpoints[0]?.id || Object.keys(nextMocks)[0] || '';
      setActiveMockEndpointId(firstId);
      setTuneTargetIds(firstId ? [firstId] : []);
      await startServiceWithMocks(nextMocks);
      setMockStep(3);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function refreshMockData() {
    setLoading(true);
    try {
      await deletePersistedTunedMocks(
        workspaceId,
        selectedEndpoints.map((endpoint) => endpoint.id)
      );
      const data = await callWorkflow<{ mocks: Record<string, EndpointMock> }>({
        action: 'generateMock',
        openapiText,
        enabledIds: selectedIds,
        strategy
      });
      const nextMocks = data.mocks;
      setMocks(nextMocks);
      await startServiceWithMocks(nextMocks, { preferPersisted: false });
      await refreshPersistedTunedState();
      setEndpointUpdateState((prev) => {
        const next = { ...prev };
        for (const endpoint of selectedEndpoints) {
          next[endpoint.id] = 'success';
        }
        return next;
      });
      setActionMessage({
        type: 'success',
        text: `刷新成功，已重生成并热更新 ${selectedEndpoints.length} 个接口的 Mock 数据。`
      });
    } catch (e) {
      console.error(e);
      setActionMessage({
        type: 'error',
        text: `刷新失败：${(e as Error).message}`
      });
    } finally {
      setLoading(false);
    }
  }

  async function tuneMock(targetIds: string[], promptOverride?: string): Promise<string[]> {
    const effectiveTargetIds = targetIds.filter((id) => mocks[id]);
    if (effectiveTargetIds.length === 0) return [];
    setLoading(true);
    try {
      const changedKeys: string[] = [];
      let nextState = { ...mocks };
      const effectivePrompt = promptOverride ?? tunePrompt;

      for (const endpointId of effectiveTargetIds) {
        const jsonText = JSON.stringify(getEditableMockPayload(nextState[endpointId]), null, 2);
        const data = await callWorkflow<{ output: string; changedKeys: string[] }>({
          action: 'tune',
          jsonText,
          prompt: effectivePrompt
        });
        const nextItems = JSON.parse(data.output) as unknown[];
        const normalizedItems = Array.isArray(nextItems) ? nextItems : [nextItems];
        await savePersistedTunedMock({
          workspaceId,
          endpointId,
          items: normalizedItems,
          prompt: effectivePrompt
        });

        nextState = {
          ...nextState,
          [endpointId]: {
            ...(nextState[endpointId] ?? {
              endpointId,
              runtime: { status: 200, delayMs: 0 }
            }),
            items: normalizedItems
          }
        };
        changedKeys.push(...data.changedKeys.map((key) => `${endpointId}:${key}`));
      }

      setMocks(nextState);
      setTunePrompt(effectivePrompt);
      await refreshPersistedTunedState();
      if (serverRunning) {
        await startServiceWithMocks(nextState);
      }
      return changedKeys;
    } catch (e) {
      console.error(e);
      return [];
    } finally {
      setLoading(false);
    }
  }

  async function startServiceWithMocks(
    sourceMocks: Record<string, EndpointMock>,
    options: { preferPersisted?: boolean } = {}
  ) {
    const resolvedMocks =
      options.preferPersisted === false ? sourceMocks : await applyPersistedTunedMocks(workspaceId, sourceMocks);
    setMocks(resolvedMocks);

    const routes: ServerRouteConfig[] = selectedEndpoints.map((endpoint) => {
      const endpointMock = resolvedMocks[endpoint.id];
      const payload = endpointMock?.items?.length === 1 ? endpointMock.items[0] : (endpointMock?.items ?? { ok: true });
      return {
        endpointId: endpoint.id,
        method: endpoint.method.toUpperCase(),
        path: endpoint.path,
        description: endpoint.description || endpoint.summary || endpoint.operationId || endpoint.path,
        payload,
        totalCount: endpointMock?.items?.length ?? 0,
        status: endpointMock?.runtime.status ?? 200,
        delayMs: endpointMock?.runtime.delayMs ?? 0
      };
    });

    await fetch('/api/mock-server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'configure', routes })
    });

    const res = await fetch('/api/mock-server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', port: DEFAULT_PORT })
    });
    const state = await res.json();
    setServerRunning(Boolean(state.running));
  }

  async function startService() {
    setLoading(true);
    try {
      await startServiceWithMocks(mocks);
      await refreshServerState();
    } catch (e) {
      console.error(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function refreshPersistedTunedState() {
    const records = await listPersistedTunedMocks(workspaceId);
    setTunedEndpointIds(records.map((item) => item.endpointId));
  }

  function toggleTuneTarget(endpointId: string) {
    setTuneTargetIds((prev) =>
      prev.includes(endpointId) ? prev.filter((id) => id !== endpointId) : [...prev, endpointId]
    );
  }

  async function tuneByPrompt(prompt: string, targetIds: string[]) {
    const changedKeys = await tuneMock(targetIds, prompt);
    const endpointLabels = selectedEndpoints
      .filter((item) => targetIds.includes(item.id))
      .map((item) => `${item.method.toUpperCase()} ${item.path}`);

    return `已按要求调优 ${targetIds.length} 个接口：\n${endpointLabels.join('\n')}\n\n最新变更字段：${changedKeys.length ? changedKeys.join(', ') : '已更新数据结构内容。'}`;
  }

  async function handleInlineTune(endpointId: string) {
    const prompt = (inlineTunePrompts[endpointId] ?? tunePrompt).trim();
    if (!prompt) {
      setEndpointUpdateState((prev) => ({ ...prev, [endpointId]: 'error' }));
      setActionMessage({
        type: 'error',
        text: '请输入本次 AI 调优要求。'
      });
      return;
    }

    setEndpointUpdateState((prev) => ({ ...prev, [endpointId]: 'loading' }));
    await waitForNextPaint();
    const changedKeys = await tuneMock([endpointId], prompt);
    if (changedKeys.length === 0) {
      setEndpointUpdateState((prev) => ({ ...prev, [endpointId]: 'error' }));
      setActionMessage({
        type: 'error',
        text: `接口 ${endpointId} 调优失败或未产生有效修改。`
      });
      return;
    }

    setInlineTuneOpen((prev) => ({ ...prev, [endpointId]: false }));
    setInlineTunePrompts((prev) => ({ ...prev, [endpointId]: prompt }));
    setEndpointUpdateState((prev) => ({ ...prev, [endpointId]: 'success' }));
    setActionMessage({
      type: 'success',
      text: `接口 ${endpointId} AI 调优成功，已回填最新 Mock 数据。`
    });
  }

  async function refreshServerState() {
    const res = await fetch('/api/mock-server');
    const data = await res.json();
    setServerRunning(Boolean(data.running));
  }

  async function pushRuntimeToServer(endpointId: string) {
    const runtime = mocks[endpointId]?.runtime;
    if (!runtime) return;
    setEndpointUpdateState((prev) => ({ ...prev, [endpointId]: 'loading' }));
    await waitForNextPaint();
    const draft = mockDrafts[endpointId]?.trim();
    if (!draft) {
      setMockDraftErrors((prev) => ({ ...prev, [endpointId]: '请输入合法的 JSON 数据。' }));
      setEndpointUpdateState((prev) => ({ ...prev, [endpointId]: 'error' }));
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setMockDraftErrors((prev) => ({ ...prev, [endpointId]: 'JSON 格式错误，请先修正后再热更新。' }));
      setEndpointUpdateState((prev) => ({ ...prev, [endpointId]: 'error' }));
      setActionMessage({
        type: 'error',
        text: `接口 ${endpointId} 热更新失败：JSON 格式错误。`
      });
      return;
    }

    const nextItems = Array.isArray(parsed) ? parsed : [parsed];
    const nextMocks = {
      ...mocks,
      [endpointId]: {
        ...(mocks[endpointId] ?? {
          endpointId,
          runtime: { status: 200, delayMs: 0 }
        }),
        items: nextItems
      }
    };

    setMockDraftErrors((prev) => ({ ...prev, [endpointId]: '' }));
    try {
      setMocks(nextMocks);
      await startServiceWithMocks(nextMocks, { preferPersisted: false });
      await savePersistedTunedMock({
        workspaceId,
        endpointId,
        items: nextItems,
        prompt: 'manual-edit'
      });
      await refreshPersistedTunedState();
      await refreshServerState();
      setEndpointUpdateState((prev) => ({ ...prev, [endpointId]: 'success' }));
      setActionMessage({
        type: 'success',
        text: `接口 ${endpointId} 热更新成功，接口返回与 IndexedDB 已同步更新。`
      });
    } catch (e) {
      console.error(e);
      setEndpointUpdateState((prev) => ({ ...prev, [endpointId]: 'error' }));
      setActionMessage({
        type: 'error',
        text: `接口 ${endpointId} 热更新失败：${(e as Error).message}`
      });
    }
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
            [key]: value
          }
        }
      };
    });
  }

  function updateMockDraft(endpointId: string, value: string) {
    setMockDrafts((prev) => ({
      ...prev,
      [endpointId]: value
    }));

    setMockDraftErrors((prev) => {
      if (!prev[endpointId]) {
        return prev;
      }

      return {
        ...prev,
        [endpointId]: ''
      };
    });
    setActionMessage(null);
  }

  function renderRequestParamsHint(schema?: Record<string, unknown>) {
    const hints = collectSchemaHints(schema);

    if (hints.length === 0) {
      return <p className='status-text'>该接口未解析出明确的请求参数定义。</p>;
    }

    return (
      <div className='param-hint-list'>
        {hints.map((hint) => (
          <div key={hint.key} className='param-hint-row'>
            <div className='param-hint-row__main'>
              <span className='param-hint-row__name'>{hint.key}</span>
              {hint.description ? <p className='param-hint-row__desc'>{hint.description}</p> : null}
            </div>
            <div className='param-hint-row__meta'>
              <span className='param-hint-row__type'>{hint.type}</span>
              <span className={`param-hint-row__required ${hint.required ? 'param-hint-row__required--yes' : ''}`}>
                {hint.required ? '必填' : '选填'}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!ready) {
    return <main className='workspace-page' />;
  }

  if (!openapiText.trim() || !parseInfo) {
    return (
      <main className='workspace-page workspace-page--empty'>
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
        <div>
          <h1>MockData 工作区</h1>
          <p>
            {parseInfo.title} · v{parseInfo.version} · {parseInfo.endpointCount} 个接口
          </p>
        </div>
        <Button variant='outline' className='workspace-reset-button' onPress={resetWorkspace} isDisabled={loading}>
          重置工作区
        </Button>
      </section>

      <Tabs
        selectedKey={activeTab}
        onSelectionChange={(key) => setActiveTab(String(key))}
        variant='primary'
        className='workspace-tabs'
      >
        <Tabs.List>
          <Tabs.Tab id='types'>
            TS 类型生成
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id='mock'>
            Mock 数据（3步） <Tabs.Indicator />
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel id='types'>
          <Card variant='default' className='panel-card'>
            <Card.Header className='panel-card__header'>
              <Card.Title>TS 类型预览与下载</Card.Title>
              <Card.Description>可先在 Mock 步骤 1 调整接口勾选，再回来重新生成 TS</Card.Description>
            </Card.Header>
            <Card.Content className='panel-card__content panel-card__content--fill'>
              <TextArea value={typesTs || '// 暂无类型内容'} readOnly rows={45} />
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
              {actionMessage ? (
                <p
                  className={`status-text ${actionMessage.type === 'error' ? 'status-text--error' : 'status-text--notice'}`}
                >
                  {actionMessage.text}
                </p>
              ) : null}
              <div className='mock-stepper'>
                {[1, 2, 3].map((item) => (
                  <Button
                    key={item}
                    variant={mockStep === item ? 'primary' : 'outline'}
                    onPress={() => setMockStep(item)}
                  >
                    {item}. {['接口确认', '策略生成', '服务状态'][item - 1]}
                  </Button>
                ))}
              </div>

              {mockStep === 1 ? (
                <section className='step-panel'>
                  <div className='selection-summary'>
                    <div className='selection-summary__copy'>
                      <p>按照接口 tag 确认要参与 Mock 的结构</p>
                      <span>
                        已选 {selectedIds.length} / {endpoints.length}
                      </span>
                    </div>
                    <div className='selection-summary__actions'>
                      <Button variant='outline' onPress={selectAllEndpoints} isDisabled={endpoints.length === 0}>
                        全选
                      </Button>
                      <Button variant='outline' onPress={invertSelectedEndpoints} isDisabled={endpoints.length === 0}>
                        反选
                      </Button>
                    </div>
                  </div>

                  <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedTags}>
                    {groupedEndpoints.map(([tag, groupItems]) => {
                      const selectedCount = groupItems.filter((item) => selectedIdSet.has(item.id)).length;

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
                                  const selected = selectedIdSet.has(item.id);

                                  return (
                                    <WorkspaceSelectionCard
                                      key={item.id}
                                      endpoint={item}
                                      selected={selected}
                                      onToggle={toggleEndpoint}
                                    />
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
                    <Button
                      variant='outline'
                      onPress={regenerateTypes}
                      isDisabled={selectedIds.length === 0 || loading}
                    >
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
                      <small className='native-field__hint'>
                        仅对分页接口或 `data` 为数组的接口生效，其他接口固定生成 1 条。
                      </small>
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
                      生成 Mock 并启动服务
                    </Button>
                  </div>
                </section>
              ) : null}

              {mockStep === 3 ? (
                <section className='step-panel'>
                  <div className='panel-actions'>
                    <Button variant='outline' onPress={() => setMockStep(2)}>
                      上一步
                    </Button>
                    <Button
                      variant='outline'
                      onPress={refreshMockData}
                      isDisabled={loading || selectedEndpoints.length === 0}
                    >
                      刷新 Mock 数据
                    </Button>
                    <Button
                      variant='outline'
                      onPress={startService}
                      isDisabled={loading || selectedEndpoints.length === 0}
                    >
                      重新启动服务
                    </Button>
                    <span className='status-pill'>{serverRunning ? '服务运行中' : '服务未启动'}</span>
                  </div>

                  <div className='server-grid server-grid--focused'>
                    <div className='server-endpoint-list'>
                      {selectedEndpoints.map((endpoint) => (
                        <ServerEndpointNavButton
                          key={endpoint.id}
                          endpoint={endpoint}
                          active={endpoint.id === activeEndpoint?.id}
                          tuned={tunedEndpointIdSet.has(endpoint.id)}
                          updateState={endpointUpdateState[endpoint.id] ?? 'idle'}
                          onPress={() => setActiveMockEndpointId(endpoint.id)}
                        />
                      ))}
                    </div>
                    <div className='server-detail-panel'>
                      {activeEndpoint ? (
                        <Card key={activeEndpoint.id} variant='default' className='server-card'>
                          <Card.Header>
                            <Alert
                              status={
                                (endpointUpdateState[activeEndpoint.id] ?? 'idle') === 'success'
                                  ? 'success'
                                  : (endpointUpdateState[activeEndpoint.id] ?? 'idle') === 'error'
                                    ? 'danger'
                                    : undefined
                              }
                              style={{ marginBottom: '10px' }}
                            >
                              <Alert.Indicator>
                                {endpointUpdateState[activeEndpoint.id] === 'loading' ? <Spinner size='sm' /> : null}
                              </Alert.Indicator>
                              <Alert.Content>
                                <Card.Title>
                                  {activeEndpoint.method.toUpperCase()} {activeEndpoint.path}
                                </Card.Title>
                              </Alert.Content>
                            </Alert>
                            {tunedEndpointIdSet.has(activeEndpoint.id) ? <Card.Description>已优先使用 AI 调优数据</Card.Description> : null}
                          </Card.Header>
                          <Card.Content>
                            <div className='runtime-grid'>
                              <label className='native-field'>
                                状态码
                                <select
                                  value={mocks[activeEndpoint.id]?.runtime?.status ?? 200}
                                  onChange={(event) =>
                                    updateRuntime(activeEndpoint.id, 'status', Number(event.target.value))
                                  }
                                >
                                  {[200, 403, 500].map((code) => (
                                    <option key={code} value={code}>
                                      {code}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className='native-field'>
                                延迟（ms）
                                <Input
                                  type='number'
                                  min={0}
                                  step={100}
                                  value={String(mocks[activeEndpoint.id]?.runtime?.delayMs ?? 0)}
                                  onChange={(event) =>
                                    updateRuntime(activeEndpoint.id, 'delayMs', Number(event.target.value))
                                  }
                                />
                              </label>
                              <Button
                                variant='outline'
                                onPress={() => pushRuntimeToServer(activeEndpoint.id)}
                                isDisabled={loading}
                              >
                                热更新
                              </Button>
                            </div>
                            <div className='server-card__meta'>
                              <div className='server-card__console'>
                                <pre className='mono-block'>{`curl http://localhost:${DEFAULT_PORT}/mock-api${activeEndpoint.path}`}</pre>
                                <div className='mock-preview-panel'>
                                  <div className='mock-preview-panel__header'>
                                    <h3>Mock 数据预览</h3>
                                    <Button
                                      variant='outline'
                                      onPress={() =>
                                        setInlineTuneOpen((prev) => ({
                                          ...prev,
                                          [activeEndpoint.id]: !prev[activeEndpoint.id]
                                        }))
                                      }
                                      isDisabled={loading}
                                    >
                                      AI 调优
                                    </Button>
                                  </div>
                                  {inlineTuneOpen[activeEndpoint.id] ? (
                                    <div className='inline-tune-panel'>
                                      <TextArea
                                        fullWidth
                                        value={inlineTunePrompts[activeEndpoint.id] ?? tunePrompt}
                                        onChange={(event) =>
                                          setInlineTunePrompts((prev) => ({
                                            ...prev,
                                            [activeEndpoint.id]: event.target.value
                                          }))
                                        }
                                        rows={3}
                                        placeholder='请输入调优要求，例如：只把 price 改成 99.9，其他字段保持不变'
                                      />
                                      <div className='inline-tune-panel__actions'>
                                        <Button
                                          variant='outline'
                                          onPress={() =>
                                            setInlineTuneOpen((prev) => ({
                                              ...prev,
                                              [activeEndpoint.id]: false
                                            }))
                                          }
                                          style={{ marginRight: '5px' }}
                                        >
                                          取消
                                        </Button>
                                        <Button
                                          variant='primary'
                                          onPress={() => handleInlineTune(activeEndpoint.id)}
                                          isDisabled={loading}
                                        >
                                          提交调优
                                        </Button>
                                      </div>
                                    </div>
                                  ) : null}
                                  <TextArea
                                    value={
                                      mockDrafts[activeEndpoint.id] ??
                                      JSON.stringify(getEditableMockPayload(mocks[activeEndpoint.id]), null, 2)
                                    }
                                    onChange={(event) => updateMockDraft(activeEndpoint.id, event.target.value)}
                                    rows={18}
                                    className='mono-area mono-area--preview'
                                  />
                                  {mockDraftErrors[activeEndpoint.id] ? (
                                    <p className='status-text status-text--error'>{mockDraftErrors[activeEndpoint.id]}</p>
                                  ) : null}
                                </div>
                              </div>
                              <div className='server-card__tips'>
                                <h3>请求参数提示</h3>
                                {renderRequestParamsHint(activeEndpoint.requestSchema)}
                              </div>
                            </div>
                          </Card.Content>
                        </Card>
                      ) : (
                        <p className='status-text'>当前没有可预览的接口。</p>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}
            </Card.Content>
          </Card>
        </Tabs.Panel>
      </Tabs>
      {mockStep === 3 ? (
        <TuneAssistantDialog
          endpoints={selectedEndpoints}
          open={assistantOpen}
          onOpenChange={setAssistantOpen}
          selectedIds={tuneTargetIds}
          tunedEndpointIds={tunedEndpointIds}
          onToggleTarget={toggleTuneTarget}
          onSelectAll={() => setTuneTargetIds(selectedEndpoints.map((item) => item.id))}
          onInvertAll={() => {
            const selected = new Set(tuneTargetIds);
            setTuneTargetIds(selectedEndpoints.filter((item) => !selected.has(item.id)).map((item) => item.id));
          }}
          onTuneByPrompt={tuneByPrompt}
        />
      ) : null}
    </main>
  );
}

const WorkspaceSelectionCard = memo(function WorkspaceSelectionCard({
  endpoint,
  selected,
  onToggle
}: {
  endpoint: EndpointDefinition;
  selected: boolean;
  onToggle: (id: string, isSelected?: boolean) => void;
}) {
  return (
    <Card
      variant='default'
      onClick={() => onToggle(endpoint.id)}
      className={`endpoint-option-card ${selected ? 'endpoint-option-card--selected' : ''}`}
    >
      <Card.Content className='endpoint-option-card__content'>
        <div className='endpoint-option-card__header'>
          <Chip className='endpoint-option-card__method' variant='primary'>
            {endpoint.method.toUpperCase()}
          </Chip>
          <div className='endpoint-option-card__state' aria-hidden='true'>
            <span className={`endpoint-option-card__indicator ${selected ? 'endpoint-option-card__indicator--selected' : ''}`} />
            <span>{selected ? '已选中' : '未选中'}</span>
          </div>
        </div>
        <div className='endpoint-option-card__body'>
          <strong className='endpoint-option-card__path'>{endpoint.path}</strong>
          <p className='workspace-endpoint-card__description'>
            {endpoint.description || endpoint.summary || endpoint.operationId || '暂无描述'}
          </p>
        </div>
      </Card.Content>
    </Card>
  );
});

const ServerEndpointNavButton = memo(function ServerEndpointNavButton({
  endpoint,
  active,
  tuned,
  updateState,
  onPress
}: {
  endpoint: EndpointDefinition;
  active: boolean;
  tuned: boolean;
  updateState: 'idle' | 'loading' | 'success' | 'error';
  onPress: () => void;
}) {
  return (
    <button
      type='button'
      className={`server-endpoint-nav ${active ? 'server-endpoint-nav--active' : ''}`}
      onClick={onPress}
    >
      <div className='server-endpoint-nav__header'>
        <Chip className='endpoint-option-card__method' variant='primary'>
          {endpoint.method.toUpperCase()}
        </Chip>
        <span className={`server-endpoint-nav__state server-endpoint-nav__state--${updateState}`}>
          {updateState === 'loading'
            ? '更新中'
            : updateState === 'success'
              ? '已更新'
              : updateState === 'error'
                ? '失败'
                : tuned
                  ? '已调优'
                  : '默认'}
        </span>
      </div>
      <strong className='server-endpoint-nav__path'>{endpoint.path}</strong>
      <span className='server-endpoint-nav__desc'>
        {endpoint.description || endpoint.summary || endpoint.operationId || '暂无描述'}
      </span>
    </button>
  );
});

function collectSchemaHints(
  schema?: Record<string, unknown>
): Array<{ key: string; type: string; required: boolean; description?: string }> {
  if (!schema || !isRecord(schema.properties)) {
    return [];
  }

  const properties = schema.properties;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);

  return Object.entries(properties)
    .map(([key, value]) => {
      const prop = isRecord(value) ? value : {};
      const type = Array.isArray(prop.enum)
        ? `enum(${prop.enum.length})`
        : typeof prop.type === 'string'
          ? prop.type
          : prop.properties
            ? 'object'
            : prop.items
              ? 'array'
              : 'unknown';

      return {
        key,
        type,
        required: required.has(key),
        description: typeof prop.description === 'string' ? prop.description : undefined
      };
    })
    .slice(0, 12);
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
  const hasItems =
    isRecord(properties.items) && (properties.items.type === 'array' || properties.items.items !== undefined);
  const hasTotal = properties.total !== undefined || properties.totalCount !== undefined;

  return hasItems && hasTotal;
}

function getDataSchema(schema?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!schema || !isRecord(schema.properties) || !isRecord(schema.properties.data)) {
    return undefined;
  }

  return schema.properties.data;
}

function getEditableMockPayload(endpointMock?: EndpointMock): unknown {
  if (!endpointMock?.items?.length) {
    return [];
  }

  return endpointMock.items.length === 1 ? endpointMock.items[0] : endpointMock.items;
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
