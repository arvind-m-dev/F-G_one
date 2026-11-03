'use client';
import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import { Conversation } from '@/components/chat/conversation';

export default function ChannelPage() {
  const { channelId } = useParams<{ channelId: string }>();
  return (
    <Suspense>
      <Conversation channelId={channelId} />
    </Suspense>
  );
}
