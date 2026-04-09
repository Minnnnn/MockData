'use client';

import { EndpointMock, PersistedTunedMock } from '@/lib/types';

const DB_NAME = 'mockdata-ai-tuned';
const STORE_NAME = 'endpoint-mocks';
const DB_VERSION = 1;

export function buildWorkspaceId(openapiText: string): string {
  let hash = 0;
  for (let i = 0; i < openapiText.length; i += 1) {
    hash = (hash << 5) - hash + openapiText.charCodeAt(i);
    hash |= 0;
  }

  return `workspace_${Math.abs(hash || 1)}`;
}

export async function savePersistedTunedMock(input: {
  workspaceId: string;
  endpointId: string;
  items: unknown[];
  prompt: string;
}): Promise<void> {
  const db = await openDatabase();
  const record: PersistedTunedMock = {
    id: getRecordId(input.workspaceId, input.endpointId),
    workspaceId: input.workspaceId,
    endpointId: input.endpointId,
    items: input.items,
    prompt: input.prompt,
    updatedAt: new Date().toISOString(),
  };

  await runRequest(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record));
}

export async function listPersistedTunedMocks(workspaceId: string): Promise<PersistedTunedMock[]> {
  const db = await openDatabase();
  const records = (await runRequest(
    db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll(),
  )) as PersistedTunedMock[];

  return records.filter((item) => item.workspaceId === workspaceId);
}

export async function getPersistedTunedMock(
  workspaceId: string,
  endpointId: string,
): Promise<PersistedTunedMock | null> {
  const db = await openDatabase();
  const record = (await runRequest(
    db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(getRecordId(workspaceId, endpointId)),
  )) as PersistedTunedMock | undefined;

  return record ?? null;
}

export async function applyPersistedTunedMocks(
  workspaceId: string,
  mocks: Record<string, EndpointMock>,
): Promise<Record<string, EndpointMock>> {
  const persisted = await listPersistedTunedMocks(workspaceId);
  if (persisted.length === 0) {
    return mocks;
  }

  const next = { ...mocks };
  for (const item of persisted) {
    const target = next[item.endpointId];
    if (!target) {
      continue;
    }

    next[item.endpointId] = {
      ...target,
      items: Array.isArray(item.items) ? item.items : [],
    };
  }

  return next;
}

function getRecordId(workspaceId: string, endpointId: string): string {
  return `${workspaceId}:${endpointId}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error ?? new Error('无法打开 IndexedDB'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
    request.onsuccess = () => resolve(request.result);
  });
}
