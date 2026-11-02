'use client';
import { usePathname } from 'next/navigation';
import { ConversationList } from '@/components/chat/conversation-list';
import { cn } from '@/lib/utils';

/** Chat workspace: conversation list + conversation. Single-view navigation on mobile. */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const inConversation = /^\/app\/chat\/.+/.test(usePathname());
  return (
    <div className="flex h-full min-h-0">
      <aside className={cn('w-full shrink-0 border-r md:w-[300px]', inConversation ? 'hidden md:block' : 'block')}>
        <ConversationList />
      </aside>
      <section className={cn('min-w-0 flex-1', inConversation ? 'flex' : 'hidden md:flex')}>{children}</section>
    </div>
  );
}
