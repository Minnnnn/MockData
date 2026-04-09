import { ComposerAttachments, UserMessageAttachments } from '@/components/attachment';
import { MarkdownText } from '@/components/markdown-text';
import { useTuneAssistantContext } from '@/components/tune-assistant-context';
import { ToolFallback } from '@/components/tool-fallback';
import { TooltipIconButton } from '@/components/tooltip-icon-button';
import { Button } from '@heroui/react';
import { cn } from '@/lib/utils';
import {
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState
} from '@assistant-ui/react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  ListFilterIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon
} from 'lucide-react';
import type { FC } from 'react';

export const Thread: FC = () => {
  return (
    <ThreadPrimitive.Root
      className='aui-root aui-thread-root @container flex h-full flex-col bg-background'
      style={{
        ['--thread-max-width' as string]: '44rem',
        ['--composer-radius' as string]: '24px',
        ['--composer-padding' as string]: '10px'
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor='top'
        className='aui-thread-viewport relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4'
      >
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <ThreadWelcome />
        </AuiIf>

        <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>

        <ThreadPrimitive.ViewportFooter className='aui-thread-viewport-footer sticky bottom-0 mx-auto mt-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible rounded-t-(--composer-radius) bg-background pb-4 md:pb-6'>
          <ThreadScrollToBottom />
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);
  if (isEditing) return <EditComposer />;
  if (role === 'user') return <UserMessage />;
  return <AssistantMessage />;
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom
      render={
        <TooltipIconButton
          tooltip='Scroll to bottom'
          variant='outline'
          className='aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:border-border dark:bg-background dark:hover:bg-accent'
        />
      }
    >
      <ArrowDownIcon />
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className='aui-thread-welcome-root mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col'>
      <div className='aui-thread-welcome-center flex w-full grow flex-col items-center justify-center'>
        <div className='aui-thread-welcome-message flex size-full flex-col justify-center px-4'>
          <h1 className='aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-semibold text-2xl duration-200'>
            调整你的接口数据
          </h1>
          <p className='aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground text-xl delay-75 duration-200'>
            直接描述你想批量修改的 mock 规则，我会保存并立即生效。
          </p>
        </div>
      </div>
    </div>
  );
};

const Composer: FC = () => {
  return (
    <ComposerPrimitive.Root className='aui-composer-root relative flex w-full flex-col'>
      <ComposerPrimitive.AttachmentDropzone
        render={
          <div
            data-slot='composer-shell'
            className='flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-background p-(--composer-padding) transition-shadow focus-within:border-ring/75 focus-within:ring-2 focus-within:ring-ring/20 data-[dragging=true]:border-ring data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/50'
          />
        }
      >
        <ComposerAttachments />
        <ComposerPrimitive.Input
          placeholder='输入你的调优要求，例如：把已选接口改成电商订单场景'
          className='aui-composer-input max-h-32 min-h-10 w-full resize-none bg-transparent px-1.75 py-1 text-sm outline-none placeholder:text-muted-foreground/80'
          rows={1}
          autoFocus
          aria-label='Message input'
        />
        <ComposerAction />
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  const { selectedIds, setPickerOpen } = useTuneAssistantContext();

  return (
    <div className='aui-composer-action-wrapper relative flex items-center justify-between'>
      <div className='aui-composer-action-left'>
        <TooltipIconButton
          tooltip={`选择接口（已选 ${selectedIds.length} 个）`}
          side='top'
          variant='outline'
          size='sm'
          onClick={() => setPickerOpen(true)}
        >
          <ListFilterIcon className='size-4' />
        </TooltipIconButton>
        {/* <ComposerAddAttachment /> */}
      </div>
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send
          render={
            <TooltipIconButton
              tooltip='Send message'
              side='bottom'
              variant='solid'
              size='sm'
              className='aui-composer-send size-8 rounded-full'
              aria-label='Send message'
            />
          }
        >
          <ArrowUpIcon className='aui-composer-send-icon size-4' />
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel
          render={
            <Button
              variant='primary'
              size='sm'
              isIconOnly
              className='aui-composer-cancel size-8 rounded-full'
              aria-label='Stop generating'
            />
          }
        >
          <SquareIcon className='aui-composer-cancel-icon size-3 fill-current' />
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className='aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200'>
        <ErrorPrimitive.Message className='aui-message-error-message line-clamp-2' />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className='aui-assistant-message-root fade-in slide-in-from-bottom-1 relative mx-auto w-full max-w-(--thread-max-width) animate-in py-3 duration-150'
      data-role='assistant'
    >
      <div className='aui-assistant-message-content wrap-break-word px-2 text-foreground leading-relaxed'>
        <MessagePrimitive.Parts>
          {({ part }) => {
            if (part.type === 'text') return <MarkdownText />;
            if (part.type === 'tool-call') return part.toolUI ?? <ToolFallback {...part} />;
            return null;
          }}
        </MessagePrimitive.Parts>
        <MessageError />
      </div>

      <div className='aui-assistant-message-footer mt-1 ml-2 flex min-h-6 items-center'>
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide='not-last'
      className='aui-assistant-action-bar-root col-start-3 row-start-2 -ml-1 flex gap-1 text-muted-foreground'
    >
      <ActionBarPrimitive.Copy render={<TooltipIconButton tooltip='Copy' />}>
        <AuiIf condition={(s) => s.message.isCopied}>
          <CheckIcon />
        </AuiIf>
        <AuiIf condition={(s) => !s.message.isCopied}>
          <CopyIcon />
        </AuiIf>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload render={<TooltipIconButton tooltip='Refresh' />}>
        <RefreshCwIcon />
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className='aui-user-message-root fade-in slide-in-from-bottom-1 mx-auto grid w-full max-w-(--thread-max-width) animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 py-3 duration-150 [&:where(>*)]:col-start-2'
      data-role='user'
    >
      <UserMessageAttachments />

      <div className='aui-user-message-content-wrapper relative col-start-2 min-w-0'>
        <div className='aui-user-message-content wrap-break-word peer rounded-2xl bg-muted px-4 py-2.5 text-foreground empty:hidden'>
          <MessagePrimitive.Parts />
        </div>
        <div className='aui-user-action-bar-wrapper absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2 peer-empty:hidden'>
          <UserActionBar />
        </div>
      </div>

      <BranchPicker className='aui-user-branch-picker col-span-full col-start-1 row-start-3 -mr-1 justify-end' />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide='not-last'
      className='aui-user-action-bar-root flex flex-col items-end'
    >
      <ActionBarPrimitive.Edit render={<TooltipIconButton tooltip='Edit' className='aui-user-action-edit p-4' />}>
        <PencilIcon />
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root className='aui-edit-composer-wrapper mx-auto flex w-full max-w-(--thread-max-width) flex-col px-2 py-3'>
      <ComposerPrimitive.Root className='aui-edit-composer-root ml-auto flex w-full max-w-[85%] flex-col rounded-2xl bg-muted'>
        <ComposerPrimitive.Input
          className='aui-edit-composer-input min-h-14 w-full resize-none bg-transparent p-4 text-foreground text-sm outline-none'
          autoFocus
        />
        <div className='aui-edit-composer-footer mx-3 mb-3 flex items-center gap-2 self-end'>
          <ComposerPrimitive.Cancel render={<Button variant='secondary' size='sm' />}>Cancel</ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send render={<Button variant='primary' size='sm' />}>Update</ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        'aui-branch-picker-root mr-2 -ml-2 inline-flex items-center text-muted-foreground text-xs',
        className
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous render={<TooltipIconButton tooltip='Previous' />}>
        <ChevronLeftIcon />
      </BranchPickerPrimitive.Previous>
      <span className='aui-branch-picker-state font-medium'>
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next render={<TooltipIconButton tooltip='Next' />}>
        <ChevronRightIcon />
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
