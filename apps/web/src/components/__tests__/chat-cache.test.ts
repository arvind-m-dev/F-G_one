import { QueryClient } from '@tanstack/react-query';
import { mentionHandles, normalizeMention, patchMessage, toggleReaction, type MessagePages } from '../chat/cache';
import { splitUrl } from '../chat/message-item';
import type { ChatMessage } from '@/lib/types';

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  channelId: 'c1',
  parentId: null,
  body: 'hello',
  deleted: false,
  editedAt: null,
  createdAt: '2026-11-12T10:00:00.000Z',
  replyCount: 0,
  author: null,
  reactions: [],
  ...over,
});

describe('toggleReaction', () => {
  it('adds a first reaction, then a second person, then removes them again', () => {
    let m = toggleReaction(msg(), 'thumbs-up', 'me');
    expect(m.reactions).toEqual([{ emoji: 'thumbs-up', userIds: ['me'], count: 1 }]);
    m = toggleReaction(m, 'thumbs-up', 'you');
    expect(m.reactions[0]).toMatchObject({ userIds: ['me', 'you'], count: 2 });
    m = toggleReaction(m, 'thumbs-up', 'me');
    expect(m.reactions[0]).toMatchObject({ userIds: ['you'], count: 1 });
    // the last person leaving removes the chip altogether
    expect(toggleReaction(m, 'thumbs-up', 'you').reactions).toEqual([]);
  });
});

describe('patchMessage', () => {
  it('changes the message in the channel list and the thread, and undoes both', () => {
    const qc = new QueryClient();
    const reply = msg({ id: 'r1', parentId: 'm1' });
    const pages = (items: ChatMessage[]): MessagePages => ({ pages: [{ items, hasMore: false }], pageParams: [undefined] });
    qc.setQueryData(['messages', 'c1'], pages([msg(), reply]));
    qc.setQueryData(['thread', 'm1'], pages([reply]));

    const undo = patchMessage(qc, reply, (old) => ({ ...old, deleted: true }));
    expect(qc.getQueryData<MessagePages>(['messages', 'c1'])!.pages[0]!.items.map((m) => m.deleted)).toEqual([false, true]);
    expect(qc.getQueryData<MessagePages>(['thread', 'm1'])!.pages[0]!.items[0]!.deleted).toBe(true);

    undo();
    expect(qc.getQueryData<MessagePages>(['messages', 'c1'])!.pages[0]!.items[1]!.deleted).toBe(false);
    expect(qc.getQueryData<MessagePages>(['thread', 'm1'])!.pages[0]!.items[0]!.deleted).toBe(false);
  });
});

describe('mentions', () => {
  it('offers the handles the server recognises, most specific first', () => {
    expect(mentionHandles({ name: 'Rohan Verma', firstName: 'Rohan', lastName: 'Verma' })).toEqual(['Rohan.Verma', 'Rohan']);
    // a display name adds a third handle, without spaces
    expect(mentionHandles({ name: 'Ro V', firstName: 'Rohan', lastName: 'Verma' })).toEqual(['Rohan.Verma', 'Rohan', 'RoV']);
    // names that can't be typed as one word are left out
    expect(mentionHandles({ name: 'Mary Ann Lee', firstName: 'Mary Ann', lastName: 'Lee' })).toEqual([]);
  });

  it('compares a mention the way the server does', () => {
    expect(normalizeMention('@Rohan.Verma.')).toBe('rohan.verma');
    expect(normalizeMention('@ROHAN-')).toBe('rohan');
  });
});

describe('splitUrl', () => {
  it('leaves sentence punctuation out of the link', () => {
    expect(splitUrl('https://example.com/a.')).toEqual(['https://example.com/a', '.']);
    expect(splitUrl('https://example.com/a),')).toEqual(['https://example.com/a', '),']);
    expect(splitUrl('https://example.com/a?x=1')).toEqual(['https://example.com/a?x=1', '']);
  });

  it('keeps a closing bracket that belongs to the address', () => {
    expect(splitUrl('https://en.wikipedia.org/wiki/Leave_(disambiguation)')).toEqual(['https://en.wikipedia.org/wiki/Leave_(disambiguation)', '']);
  });
});
