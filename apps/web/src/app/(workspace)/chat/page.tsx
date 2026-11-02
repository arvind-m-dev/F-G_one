'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hash, MessageSquarePlus, Plus, Search, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PERMISSIONS } from '@fg/shared';
import { NewChannelDialog, NewMessageDialog } from '@/components/chat/new-conversation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/session';

interface BrowseChannel {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  isMember: boolean;
  isDefault: boolean;
  lastMessageAt: string | null;
}

export default function ChatHome() {
  const can = useCan();
  const qc = useQueryClient();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [newChannel, setNewChannel] = useState(false);
  const [newDm, setNewDm] = useState(false);
  const browse = useQuery({ queryKey: ['channels', 'browse'], queryFn: () => api<BrowseChannel[]>('/channels/browse') });
  const join = useMutation({
    mutationFn: (id: string) => api(`/channels/${id}/join`, { method: 'POST' }),
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: ['channels'] });
      router.push(`/chat/${id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = (browse.data ?? []).filter((c) => !q || c.name.includes(q.toLowerCase()) || c.description?.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Messages</h2>
          <p className="text-sm text-muted">Browse public channels or start a conversation.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setNewDm(true)}>
            <MessageSquarePlus /> New message
          </Button>
          {can(PERMISSIONS.CHANNELS_CREATE) && (
            <Button onClick={() => setNewChannel(true)}>
              <Plus /> Create channel
            </Button>
          )}
        </div>
      </div>
      <div className="relative mb-4">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channels" className="pl-9" aria-label="Search channels" />
      </div>
      {browse.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={<Hash />} title="No channels found" description="Try a different search, or create a new channel." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((c, i) => (
            <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Card className="flex h-full items-start gap-3 p-4 transition hover:border-primary/40 hover:shadow-md">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                  <Hash className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold">{c.name}</p>
                    {c.isDefault && <Badge tone="brand">company-wide</Badge>}
                  </div>
                  <p className="line-clamp-2 text-sm text-muted">{c.description || 'No description'}</p>
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-muted">
                    <Users className="size-3.5" /> {c.memberCount} members
                  </p>
                </div>
                {c.isMember ? (
                  <Button size="sm" variant="secondary" onClick={() => router.push(`/chat/${c.id}`)}>
                    Open
                  </Button>
                ) : (
                  <Button size="sm" loading={join.isPending && join.variables === c.id} onClick={() => join.mutate(c.id)}>
                    Join
                  </Button>
                )}
              </Card>
            </motion.div>
          ))}
        </div>
      )}
      <NewChannelDialog open={newChannel} onOpenChange={setNewChannel} />
      <NewMessageDialog open={newDm} onOpenChange={setNewDm} />
    </div>
  );
}
