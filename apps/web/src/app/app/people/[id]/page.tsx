'use client';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Building2, Cake, CalendarClock, Globe, Mail, Phone, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { MessageButton } from '@/components/message-button';
import { Breadcrumbs } from '@/components/shell/page';
import { usePageTitle } from '@/lib/use-title';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { StatusLine, UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useLivePerson } from '@/lib/presence-store';
import { useSession } from '@/lib/session';
import type { Employee } from '@/lib/types';
import { parseDateOnly, timeAgo } from '@/lib/utils';

function Row({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 size-4 text-muted" />
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <div className="text-sm font-medium break-words">{value || '—'}</div>
      </div>
    </div>
  );
}

export default function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const me = useSession();
  const q = useQuery({ queryKey: ['employee', id], queryFn: () => api<Employee>(`/employees/${id}`) });
  usePageTitle(q.data?.name);
  const live = useLivePerson(q.data ?? { id, online: false, presence: 'available', statusEmoji: null, statusText: null, statusExpiresAt: null });

  if (q.isError)
    return (
      <EmptyState
        icon={<UserRound />}
        title="This profile isn't available"
        description={errorMessage(q.error)}
        className="mt-20"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" loading={q.isFetching} onClick={() => void q.refetch()}>
              Try again
            </Button>
            <Link href="/app/people">
              <Button variant="ghost">Back to the directory</Button>
            </Link>
          </div>
        }
      />
    );
  if (!q.data)
    return (
      <div className="mx-auto max-w-[1100px] px-6 pt-8 sm:px-10" role="status" aria-label="Loading profile">
        <Skeleton className="h-64" />
      </div>
    );
  const p = q.data;
  const bday = p.birthday ? (p.birthday.length === 5 ? parseDateOnly(`2000-${p.birthday}`) : parseDateOnly(p.birthday)) : null;

  return (
    <div className="mx-auto max-w-[1100px] px-6 pt-8 pb-14 sm:px-10">
      <Breadcrumbs className="mb-4" items={[{ label: 'Directory', href: '/app/people' }, { label: p.name }]} />
      <Card className="overflow-hidden">
        <div className="h-28" style={{ background: `linear-gradient(135deg, ${p.avatarColor}, ${p.department?.color ?? 'var(--brand-2)'})` }} />
        <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end">
          <div className="-mt-12 rounded-full bg-surface p-1.5">
            <UserAvatar person={p} size="xl" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight break-words">{p.name}</h1>
            <p className="text-muted">{[p.designation, p.department?.name].filter(Boolean).join(' · ')}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusLine person={live} className="rounded-full border px-2.5 py-1" />
              <Badge tone="brand">{p.role.name}</Badge>
              {p.pronouns && <Badge tone="muted">{p.pronouns}</Badge>}
              {!live.online && p.lastSeenAt && <span className="text-xs text-muted">Last seen {timeAgo(p.lastSeenAt)}</span>}
            </div>
          </div>
          <div className="flex gap-2">
            {p.id === me.user.id ? (
              <Link href="/app/profile">
                <Button variant="outline">Edit profile</Button>
              </Link>
            ) : p.status === 'ACTIVE' ? (
              <MessageButton userId={p.id} variant="gradient" />
            ) : (
              <Badge tone="muted">{p.status === 'DEACTIVATED' ? 'No longer active' : 'Not signed in yet'}</Badge>
            )}
          </div>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader title="About" icon={<UserRound />} />
          <div className="px-5 pb-5">
            <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{p.bio || <span className="text-muted">No bio yet.</span>}</p>
            <div className="mt-4 grid border-t sm:grid-cols-2">
              <Row icon={Mail} label="Email" value={<a href={`mailto:${p.email}`} className="text-primary hover:underline">{p.email}</a>} />
              <Row icon={Phone} label="Phone" value={p.phone ? <a href={`tel:${p.phone.replace(/[^+\d]/g, '')}`} className="text-primary hover:underline">{p.phone}</a> : null} />
              <Row icon={Building2} label="Department" value={p.department?.name} />
              <Row icon={Briefcase} label="Job title" value={p.designation} />
              <Row icon={CalendarClock} label="Joined" value={p.joinedAt ? parseDateOnly(p.joinedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null} />
              <Row icon={Cake} label="Birthday" value={bday ? bday.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : null} />
              <Row icon={Globe} label="Time zone" value={p.timezone} />
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Reporting line" icon={<Building2 />} />
          <div className="space-y-4 px-5 pb-5">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Manager</p>
              {p.manager ? (
                <Link href={`/app/people/${p.manager.id}`} className="flex items-center gap-2.5 rounded-lg p-1.5 hover:bg-surface-2">
                  <UserAvatar person={{ ...p.manager, name: `${p.manager.firstName} ${p.manager.lastName}` }} size="sm" showPresence={false} />
                  <span className="text-sm font-medium">{p.manager.firstName} {p.manager.lastName}</span>
                </Link>
              ) : (
                <p className="text-sm text-muted">No manager set</p>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Direct reports ({p.reports?.length ?? 0})</p>
              <div className="space-y-0.5">
                {p.reports?.map((r) => (
                  <Link key={r.id} href={`/app/people/${r.id}`} className="flex items-center gap-2.5 rounded-lg p-1.5 hover:bg-surface-2">
                    <UserAvatar person={{ ...r, name: `${r.firstName} ${r.lastName}` }} size="sm" showPresence={false} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{r.firstName} {r.lastName}</span>
                      <span className="block truncate text-xs text-muted">{r.designation}</span>
                    </span>
                  </Link>
                ))}
                {!p.reports?.length && <p className="text-sm text-muted">None</p>}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
