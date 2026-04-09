'use client';

import { useMemo, useState } from 'react';
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from '@assistant-ui/react';
import { Thread } from '@/components/thread';
import { TuneAssistantProvider } from '@/components/tune-assistant-context';
import { EndpointDefinition } from '@/lib/types';
import { Button } from '@heroui/react';
import { XIcon } from 'lucide-react';

type TuneAssistantDialogProps = {
  endpoints: EndpointDefinition[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  tunedEndpointIds: string[];
  onToggleTarget: (endpointId: string) => void;
  onSelectAll: () => void;
  onInvertAll: () => void;
  onTuneByPrompt: (prompt: string, targetIds: string[]) => Promise<string>;
};

export function TuneAssistantDialog({
  endpoints,
  open,
  onOpenChange,
  selectedIds,
  tunedEndpointIds,
  onToggleTarget,
  onSelectAll,
  onInvertAll,
  onTuneByPrompt
}: TuneAssistantDialogProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const runtime = useLocalRuntime(
    useMemo<ChatModelAdapter>(
      () => ({
        async run(options) {
          const prompt = getLastUserMessageText(options.messages);
          if (!prompt.trim()) {
            return {
              content: [{ type: 'text', text: '请输入本次批量调优要求。' }]
            };
          }

          if (selectedIds.length === 0) {
            return {
              content: [{ type: 'text', text: '请先选择至少一个接口，再发起调优。' }]
            };
          }

          const summary = await onTuneByPrompt(prompt, selectedIds);
          return {
            content: [{ type: 'text', text: summary }]
          };
        }
      }),
      [onTuneByPrompt, selectedIds]
    )
  );

  return (
    <>
      {/* <Button className='ai-fab' isIconOnly variant='primary' onPress={() => onOpenChange(true)}>
        <Comments />
      </Button> */}
      {open ? (
        <section className='tune-dialog tune-dialog--support' aria-label='AI 对话调优面板'>
          <div className='support-chat'>
            <Button
              isIconOnly
              className='support-chat__close'
              onPress={() => onOpenChange(false)}
              aria-label='关闭 AI 对话'
            >
              <XIcon size={18} />
            </Button>
            <div className='support-chat__header'>
              <div className='support-chat__tabs'>
                <span className='support-chat__tab'>批量调优</span>
              </div>
              <h2 className='support-chat__title'>AI对话调整！</h2>
              <p className='support-chat__desc'>
                <span className='support-chat__status-dot' />
                调整后会立即回填到对应接口的 Mock 数据区
              </p>
            </div>
            <div className='support-chat__body'>
              <TuneAssistantProvider
                value={{
                  endpoints,
                  selectedIds,
                  tunedEndpointIds,
                  pickerOpen,
                  setPickerOpen
                }}
              >
                <div className='tune-dialog__thread'>
                  <AssistantRuntimeProvider runtime={runtime}>
                    <Thread />
                  </AssistantRuntimeProvider>
                </div>
              </TuneAssistantProvider>

              {pickerOpen ? (
                <div className='endpoint-picker'>
                  <div className='endpoint-picker__header'>
                    <strong>选择接口</strong>
                    <div className='endpoint-picker__actions'>
                      <Button variant='outline' size='sm' onPress={onSelectAll}>
                        全选
                      </Button>
                      <Button variant='outline' size='sm' onPress={onInvertAll}>
                        反选
                      </Button>
                      <Button variant='ghost' size='sm' onPress={() => setPickerOpen(false)}>
                        收起
                      </Button>
                    </div>
                  </div>
                  <div className='endpoint-picker__list'>
                    {endpoints.map((endpoint) => {
                      const selected = selectedIds.includes(endpoint.id);
                      const tuned = tunedEndpointIds.includes(endpoint.id);
                      return (
                        <Button
                          key={endpoint.id}
                          className={`ai-target-chip ${selected ? 'ai-target-chip--selected' : ''}`}
                          onPress={() => onToggleTarget(endpoint.id)}
                        >
                          <span>
                            {endpoint.method.toUpperCase()} {endpoint.path}
                          </span>
                          {tuned ? <span className='ai-target-chip__tag'>AI</span> : null}
                        </Button>
                      );
                    })}
                  </div>
                  <div className='tune-dialog__meta'>已选接口：{selectedIds.length} 个</div>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}

function getLastUserMessageText(
  messages: readonly { role: string; content?: readonly { type?: string; text?: string }[] }[]
): string {
  const reversed = [...messages].reverse();
  const userMessage = reversed.find((message) => message.role === 'user');
  if (!userMessage?.content) {
    return '';
  }

  return userMessage.content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
}
