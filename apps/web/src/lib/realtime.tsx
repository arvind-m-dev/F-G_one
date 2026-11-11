'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { RT, type PresenceEvent } from '@fg/shared';
import { toast } from 'sonner';
import { api } from './api';
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
  // The socket is set up once; keep the latest router for toast actions without reconnecting.
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const s = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
    setSocket(s);
    s.on('connect', () => setConnected(true));
    s.on('disconnect', (reason) => {
      setConnected(false);
      // The server closes the connection when the session ends (signed out everywhere, suspended,
      // deactivated). Check the session: a 401 sends this tab to sign-in; otherwise reconnect.
      if (reason === 'io server disconnect') {
        void api('/auth/me')
          .then(() => s.connect())
          .catch(() => undefined);
      }
    });
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
    s.on(RT.CHANNEL_REMOVED, (p: { channelId: string }) => {
      // Removed from a conversation: drop what was cached so an open view stops showing it.
      void qc.invalidateQueries({ queryKey: ['channels'] });
      qc.removeQueries({ queryKey: ['messages', p.channelId] });
      void qc.invalidateQueries({ queryKey: ['channel', p.channelId] });
    });
    s.on(RT.NOTIFICATION_NEW, (n: { title: string; body: string | null; link: string | null; type: string }) => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      if (n.type === 'leave' || n.type === 'correction') {
        for (const k of ['leave-requests', 'leave-balances', 'approvals-count', 'corrections', 'attendance-history', 'attendance-board']) void qc.invalidateQueries({ queryKey: [k] });
      }
      // Don't toast chat activity for the conversation you're already reading.
      if (n.link && window.location.pathname === n.link.split('?')[0]) return;
      toast(n.title, {
        description: n.body ?? undefined,
        // In-app navigation: a full page load would drop the cache and reconnect the socket.
        action: n.link ? { label: 'Open', onClick: () => routerRef.current.push(n.link!) } : undefined,
      });
    });
    s.on(RT.ATTENDANCE_CHANGED, () => {
      void qc.invalidateQueries({ queryKey: ['attendance-today'] });
      void qc.invalidateQueries({ queryKey: ['attendance-board'] });
      void qc.invalidateQueries({ queryKey: ['attendance-history'] });
    });
    s.on(RT.ANNOUNCEMENTS_CHANGED, () => {
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    });
    // Several changes in a row (a few cards moved on a board) become one refresh.
    let workTimer: ReturnType<typeof setTimeout> | null = null;
    let workRequests = false;
    s.on(RT.WORK_CHANGED, (p?: { requests?: boolean }) => {
      workRequests ||= !!p?.requests;
      if (workTimer) return;
      workTimer = setTimeout(() => {
        workTimer = null;
        void qc.invalidateQueries({ queryKey: ['work'] });
        if (workRequests) void qc.invalidateQueries({ queryKey: ['approvals-count'] });
        workRequests = false;
      }, 800);
    });
    // After a reconnect (e.g. the server woke from sleep) refresh what may have changed meanwhile.
    s.io.on('reconnect', () => {
      void qc.invalidateQueries({ queryKey: ['channels'] });
      void qc.invalidateQueries({ queryKey: ['messages'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['attendance-today'] });
    });
    return () => {
      if (workTimer) clearTimeout(workTimer);
      s.disconnect();
    };
  }, [qc]);

  return <RealtimeContext.Provider value={{ socket, connected }}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);
