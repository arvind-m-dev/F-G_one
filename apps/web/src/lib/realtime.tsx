'use client';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { RT, type PresenceEvent } from '@fg/shared';
import { presenceStore } from './presence-store';
import type { ChatMessage, Me } from './types';

const RealtimeContext = createContext<{ socket: Socket | null; connected: boolean }>({ socket: null, connected: false });

/**
 * One Socket.IO connection per tab, authenticated by the httpOnly session cookie.
 * Keeps React Query caches (channel list, messages) in sync with server events.
 */
export function RealtimeProvider({ me, children }: { me: Me; children: React.ReactNode }) {
  const qc = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const meId = useRef(me.user.id);

  useEffect(() => {
    const s = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
    setSocket(s);
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on(RT.ONLINE_SNAPSHOT, (p: { userIds: string[] }) => presenceStore.setOnline(p.userIds));
    s.on(RT.PRESENCE_UPDATED, (evt: PresenceEvent) => {
      presenceStore.apply(evt);
      if (evt.userId === meId.current && evt.presence !== undefined) void qc.invalidateQueries({ queryKey: ['me'] });
    });
    s.on(RT.MESSAGE_NEW, (m: ChatMessage) => {
      if (!m.parentId) {
        qc.setQueryData<{ pages: { items: ChatMessage[]; hasMore: boolean }[]; pageParams: unknown[] }>(['messages', m.channelId], (old) => {
          if (!old) return old;
          const pages = [...old.pages];
          const first = pages[0]!;
          const items = first.items.filter((x) => x.id !== m.id && !(m.clientId && x.clientId === m.clientId));
          pages[0] = { ...first, items: [...items, m] };
          return { ...old, pages };
        });
      } else {
        void qc.invalidateQueries({ queryKey: ['thread', m.parentId] });
      }
      void qc.invalidateQueries({ queryKey: ['channels'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    });
    s.on(RT.MESSAGE_UPDATED, (m: ChatMessage) => {
      const patch = (old: { pages: { items: ChatMessage[]; hasMore: boolean }[]; pageParams: unknown[] } | undefined) =>
        old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === m.id ? m : x)) })) } : old;
      qc.setQueryData(['messages', m.channelId], patch);
      if (m.parentId) void qc.invalidateQueries({ queryKey: ['thread', m.parentId] });
    });
    s.on(RT.CHANNEL_UPDATED, (p: { channelId: string }) => {
      void qc.invalidateQueries({ queryKey: ['channels'] });
      void qc.invalidateQueries({ queryKey: ['channel', p.channelId] });
    });
    s.on(RT.CHANNEL_REMOVED, () => void qc.invalidateQueries({ queryKey: ['channels'] }));
    return () => {
      s.disconnect();
    };
  }, [qc]);

  return <RealtimeContext.Provider value={{ socket, connected }}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);
