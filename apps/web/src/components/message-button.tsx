'use client';
import { MessageSquare } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { Button, type ButtonProps } from './ui/button';

export function MessageButton({ userId, label = 'Message', ...props }: { userId: string; label?: string } & ButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      {...props}
      loading={loading}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setLoading(true);
        try {
          const c = await api<{ id: string }>('/dm', { body: { userIds: [userId] } });
          router.push(`/chat/${c.id}`);
        } catch (err) {
          toast.error(errorMessage(err));
          setLoading(false);
        }
      }}
    >
      <MessageSquare /> {label}
    </Button>
  );
}
