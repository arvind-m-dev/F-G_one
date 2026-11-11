import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from '../chat/composer';
import { TooltipProvider } from '../ui/misc';
import { clearDrafts } from '@/lib/drafts';
import { SessionProvider } from '@/lib/session';
import type { ChannelDetails, Me } from '@/lib/types';

const person = (id: string, firstName: string, lastName: string) => ({
  id,
  name: `${firstName} ${lastName}`,
  firstName,
  lastName,
  designation: null,
  avatarUrl: null,
  avatarColor: '#6366f1',
  department: null,
  presence: 'available',
  statusEmoji: null,
  statusText: null,
  statusExpiresAt: null,
  online: true,
  role: 'MEMBER' as const,
});
const members: ChannelDetails['members'] = [person('me', 'Ananya', 'Iyer'), person('u2', 'Rohan', 'Verma'), person('u3', 'Meera', 'Nair')];
const me = {
  user: { id: 'me', firstName: 'Ananya', lastName: 'Iyer', name: 'Ananya Iyer' },
  preferences: { enterToSend: true },
  permissions: [],
  organization: { primaryColor: '#6366f1', secondaryColor: '#8b5cf6', settings: { branding: { defaultTheme: 'system' } } },
} as unknown as Me;

function renderComposer(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onSend = vi.fn();
  const onEditLast = vi.fn();
  const view = render(
    <SessionProvider me={me}>
      <TooltipProvider>
        <Composer channelId="c1" placeholder="Message #general" members={members} onSend={onSend} onEditLast={onEditLast} {...props} />
      </TooltipProvider>
    </SessionProvider>,
  );
  return { ...view, onSend, onEditLast, box: screen.getByRole('textbox', { name: 'Message' }) };
}

describe('Composer', () => {
  beforeEach(() => {
    clearDrafts();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  });

  it('suggests people after "@" and Enter picks one instead of sending', async () => {
    const { box, onSend } = renderComposer();
    await userEvent.type(box, 'Thanks @ro');
    const list = screen.getByRole('listbox', { name: 'People you can mention' });
    expect(list).toHaveTextContent('Rohan Verma');
    expect(list).not.toHaveTextContent('Meera Nair');
    // you can't mention yourself
    expect(list).not.toHaveTextContent('Ananya Iyer');

    await userEvent.keyboard('{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue('Thanks @Rohan.Verma ');
    expect(screen.queryByRole('listbox')).toBeNull();

    await userEvent.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('Thanks @Rohan.Verma');
    expect(box).toHaveValue('');
  });

  it('the Mention button opens the list and Escape closes it without losing the text', async () => {
    const { box } = renderComposer();
    await userEvent.type(box, 'Hi');
    await userEvent.click(screen.getByRole('button', { name: 'Mention someone' }));
    expect(box).toHaveValue('Hi @');
    expect(await screen.findByRole('listbox', { name: 'People you can mention' })).toBeInTheDocument();
    box.focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box).toHaveValue('Hi @');
  });

  it('keeps an unsent message for the conversation and forgets it once sent', async () => {
    const first = renderComposer();
    await userEvent.type(first.box, 'half written');
    first.unmount();

    const second = renderComposer();
    expect(second.box).toHaveValue('half written');
    // another conversation has its own (empty) draft
    second.unmount();
    expect(renderComposer({ channelId: 'c2' }).box).toHaveValue('');
  });

  it('Up arrow in an empty box asks to edit the last message', async () => {
    const { box, onEditLast } = renderComposer();
    box.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(onEditLast).toHaveBeenCalledTimes(1);
  });
});
