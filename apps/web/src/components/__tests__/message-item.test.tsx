import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageItem } from '../chat/message-item';
import { TooltipProvider } from '../ui/misc';
import { SessionProvider } from '@/lib/session';
import type { ChatMessage, Me } from '@/lib/types';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const me = {
  user: { id: 'me', firstName: 'Ananya', lastName: 'Iyer', name: 'Ananya Iyer' },
  preferences: { enterToSend: true },
  permissions: [],
  organization: { primaryColor: '#6366f1', secondaryColor: '#8b5cf6', settings: { branding: { defaultTheme: 'system' } } },
} as unknown as Me;

const author = { id: 'me', name: 'Ananya Iyer', firstName: 'Ananya', lastName: 'Iyer', designation: null, avatarUrl: null, avatarColor: '#6366f1', department: null, presence: 'available', statusEmoji: null, statusText: null, statusExpiresAt: null, online: true };
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({ id: 'm1', channelId: 'c1', parentId: null, body: 'hello', deleted: false, editedAt: null, createdAt: '2026-11-12T10:00:00.000Z', replyCount: 0, author, reactions: [], ...over });

function renderMessage(m: ChatMessage, props: Partial<React.ComponentProps<typeof MessageItem>> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider me={me}>
        <TooltipProvider>
          <MessageItem m={m} compact={false} meId="me" canModerate={false} mentionables={new Set(['rohan', 'rohan.verma'])} nameOf={(id) => ({ u2: 'Rohan' })[id]} {...props} />
        </TooltipProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

describe('MessageItem', () => {
  beforeEach(() => {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'm1', deleted: true, body: '', reactions: [] }), { status: 200 })) as unknown as typeof fetch;
  });

  it('highlights only mentions of people in the conversation, and keeps the full stop out of a link', () => {
    renderMessage(msg({ body: 'Ask @Rohan.Verma or mail someone@example.com, not @nobody. See https://example.com/a.' }));
    const pill = screen.getByText('@Rohan.Verma');
    expect(pill.className).toContain('bg-primary-soft');
    expect(screen.queryByText('@example.com')).toBeNull();
    expect(screen.queryByText('@nobody')).toBeNull();
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com/a');
  });

  it('a message that failed to send offers Try again and Delete instead of the usual actions', async () => {
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    const failed = msg({ id: 'c-1', clientId: 'c-1', failed: true });
    renderMessage(failed, { onRetry, onDiscard });
    expect(screen.getByRole('alert')).toHaveTextContent('Not sent');
    expect(screen.queryByRole('button', { name: 'Message actions' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledWith(failed);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDiscard).toHaveBeenCalledWith(failed);
  });

  it('deleting asks first and only then calls the server', async () => {
    renderMessage(msg());
    await userEvent.click(screen.getByRole('button', { name: 'Message actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete message' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this message?' });
    expect(global.fetch).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/messages/m1');
    expect(init.method).toBe('DELETE');
  });

  it('editing has Save and Cancel, and Cancel leaves the message alone', async () => {
    renderMessage(msg(), { editing: true, onEditingChange: vi.fn() });
    const box = screen.getByRole('textbox', { name: 'Edited text' });
    expect(box).toHaveValue('hello');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('says who reacted', () => {
    renderMessage(msg({ reactions: [{ emoji: 'thumbs-up', userIds: ['u2', 'me'], count: 2 }] }));
    expect(screen.getByRole('button', { name: 'Agree 2' })).toHaveAttribute('aria-pressed', 'true');
  });
});
