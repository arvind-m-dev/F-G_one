'use client';
import { Compass, Hash, MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { PERMISSIONS } from '@fg/shared';
import { BrowseChannelsDialog } from '@/components/chat/conversation-list';
import { NewChannelDialog, NewMessageDialog } from '@/components/chat/new-conversation';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/session';

/** Desktop empty state when no conversation is open. */
export default function ChatIndex() {
  const can = useCan();
  const [dm, setDm] = useState(false);
  const [channel, setChannel] = useState(false);
  const [browse, setBrowse] = useState(false);
  return (
    <div className="bg-dots grid h-full w-full place-items-center p-8">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border bg-canvas shadow-md">
          <MessageSquarePlus className="size-6 text-primary" />
        </div>
        <h2 className="text-lg font-semibold">Pick up a conversation</h2>
        <p className="mt-1 text-sm text-muted">Choose a channel or direct message on the left, or start something new.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={() => setDm(true)}>
            <MessageSquarePlus /> New message
          </Button>
          <Button variant="outline" onClick={() => setBrowse(true)}>
            <Compass /> Browse channels
          </Button>
          {can(PERMISSIONS.CHANNELS_CREATE) && (
            <Button variant="ghost" onClick={() => setChannel(true)}>
              <Hash /> Create channel
            </Button>
          )}
        </div>
      </div>
      <NewMessageDialog open={dm} onOpenChange={setDm} />
      <NewChannelDialog open={channel} onOpenChange={setChannel} />
      <BrowseChannelsDialog open={browse} onOpenChange={setBrowse} />
    </div>
  );
}
