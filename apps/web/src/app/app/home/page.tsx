'use client';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery } from '@tanstack/react-query';
import { WIDGET_LABELS, type WidgetKey } from '@fg/shared';
import { GripVertical, House, Lock, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { NewMessageDialog } from '@/components/chat/new-conversation';
import { WIDGETS, type DashboardData } from '@/components/dashboard/widgets';
import { StatusPicker } from '@/components/status-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, Skeleton, Switch } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useLivePerson } from '@/lib/presence-store';
import { useSession, useUpdatePreferences } from '@/lib/session';
import { usePageTitle } from '@/lib/use-title';
import { cn } from '@/lib/utils';

function SortableRow({ id, visible, onToggle }: { id: WidgetKey; visible: boolean; onToggle: (v: boolean) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const fixed = WIDGETS[id].fixed;
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('flex items-center gap-3 rounded-lg border bg-surface px-3 py-2', isDragging && 'z-10 shadow-md')}>
      <button {...attributes} {...listeners} className="cursor-grab rounded p-0.5 text-subtle hover:text-foreground active:cursor-grabbing" aria-label={`Reorder ${WIDGET_LABELS[id]}`}>
        <GripVertical className="size-4" />
      </button>
      <span className={cn('flex-1 text-[13px]', !visible && 'text-muted')}>{WIDGET_LABELS[id]}</span>
      {fixed ? <Lock className="size-3.5 text-subtle" aria-label="Always shown" /> : <Switch checked={visible} onCheckedChange={onToggle} aria-label={`Show ${WIDGET_LABELS[id]}`} />}
    </li>
  );
}

function Customize({ open, onOpenChange, allowed, initial, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; allowed: WidgetKey[]; initial: WidgetKey[]; onSave: (order: WidgetKey[]) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  // Working order includes hidden widgets (appended) so they can be re-enabled in place.
  const [order, setOrder] = useState<WidgetKey[]>([]);
  const [visible, setVisible] = useState<Set<WidgetKey>>(new Set());
  useEffect(() => {
    if (!open) return;
    setOrder([...initial, ...allowed.filter((k) => !initial.includes(k))]);
    setVisible(new Set(initial));
  }, [open, initial, allowed]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setOrder((o) => arrayMove(o, o.indexOf(e.active.id as WidgetKey), o.indexOf(e.over!.id as WidgetKey)));
  };
  const columns = [
    ['header', 'Top of page'],
    ['main', 'Main column'],
    ['side', 'Side column'],
  ] as const;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} side="right" title="Customize Home" description="Drag to reorder within a section. Turn sections off to hide them.">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="space-y-5">
          {columns.map(([col, label]) => {
            const items = order.filter((k) => WIDGETS[k].column === col);
            if (!items.length) return null;
            return (
              <div key={col}>
                <p className="mb-2 text-xs font-medium text-muted">{label}</p>
                <SortableContext items={items} strategy={verticalListSortingStrategy}>
                  <ul className="space-y-1.5">
                    {items.map((k) => (
                      <SortableRow key={k} id={k} visible={visible.has(k) || !!WIDGETS[k].fixed} onToggle={(v) => setVisible((s) => { const n = new Set(s); if (v) n.add(k); else n.delete(k); return n; })} />
                    ))}
                  </ul>
                </SortableContext>
              </div>
            );
          })}
        </div>
      </DndContext>
      <div className="mt-6 flex items-center justify-between border-t pt-4">
        <Button variant="ghost" onClick={() => { setOrder(allowed); setVisible(new Set(allowed)); }}>
          <RotateCcw /> Restore default
        </Button>
        <Button
          loading={saving}
          onClick={async () => {
            setSaving(true);
            await onSave(order.filter((k) => visible.has(k) || WIDGETS[k].fixed));
            setSaving(false);
          }}
        >
          Save layout
        </Button>
      </div>
    </Dialog>
  );
}

function Home() {
  const me = useSession();
  const savePrefs = useUpdatePreferences();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const welcome = params.get('welcome');
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/dashboard'), refetchInterval: 60_000 });
  const [customizing, setCustomizing] = useState(false);
  const [newMsg, setNewMsg] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const live = useLivePerson({ ...me.user, online: true });
  usePageTitle('Home', dash.data?.unreadTotal ?? 0);

  const allowedKey = me.organization.settings.dashboard.defaultWidgets.join(',');
  const personalKey = me.organization.settings.dashboard.allowPersonalLayout ? me.preferences.dashboardWidgets?.join(',') : undefined;
  const allowed = useMemo(() => (allowedKey ? (allowedKey.split(',') as WidgetKey[]) : []).filter((k) => k in WIDGETS), [allowedKey]);
  const order = useMemo(() => {
    const base = personalKey !== undefined ? (personalKey ? (personalKey.split(',') as WidgetKey[]) : []).filter((k) => allowed.includes(k)) : allowed;
    return base.includes('welcome') ? base : (['welcome', ...base] as WidgetKey[]);
  }, [personalKey, allowed]);

  // Greet once, then take the marker out of the address so a refresh or Back doesn't greet again.
  useEffect(() => {
    if (!welcome) return;
    toast.success(`Welcome to FG One, ${me.user.firstName}`, { id: 'welcome', description: 'Set your status and say hello in a channel.' });
    const next = new URLSearchParams(params.toString());
    next.delete('welcome');
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welcome]);

  const actions = { newMessage: () => setNewMsg(true), setStatus: () => setStatusOpen(true), search: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true })) };
  const render = (col: 'header' | 'main' | 'side') =>
    order
      .filter((k) => WIDGETS[k].column === col)
      .map((k) => {
        const W = WIDGETS[k].component;
        return <W key={k} data={dash.data!} actions={actions} />;
      });

  return (
    <div className="relative min-h-full">
      <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 h-72" />
      <div className="relative mx-auto max-w-[1180px] px-6 pt-10 pb-16 sm:px-10">
        {dash.isPending ? (
          <div className="space-y-8">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-10 w-96 max-w-full" />
            <Skeleton className="h-24 w-full" />
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
              <Skeleton className="h-72" />
              <Skeleton className="h-72" />
            </div>
          </div>
        ) : dash.isError ? (
          <EmptyState
            className="mt-10"
            icon={<House />}
            title="Home couldn't be loaded"
            description={errorMessage(dash.error)}
            action={
              <Button variant="outline" loading={dash.isFetching} onClick={() => void dash.refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <>
            <div className="space-y-7">{render('header')}</div>
            <div className="mt-10 grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 space-y-10">{render('main')}</div>
              <aside className="space-y-9 lg:border-l lg:pl-10">{render('side')}</aside>
            </div>
            {me.organization.settings.dashboard.allowPersonalLayout && (
              <div className="mt-12 flex justify-center">
                <Button variant="ghost" size="sm" onClick={() => setCustomizing(true)}>
                  <SlidersHorizontal /> Customize Home
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <Customize
        open={customizing}
        onOpenChange={setCustomizing}
        allowed={allowed}
        initial={order}
        onSave={async (o) => {
          // A failed save is reported (and undone) by the preferences hook itself.
          if (!(await savePrefs({ dashboardWidgets: o }))) return;
          setCustomizing(false);
          toast.success('Home layout saved');
        }}
      />
      <NewMessageDialog open={newMsg} onOpenChange={setNewMsg} />
      <Dialog open={statusOpen} onOpenChange={setStatusOpen} title="Update your status" description="Your availability is separate from attendance." className="max-w-[400px]">
        <StatusPicker current={live} userId={me.user.id} onDone={() => setStatusOpen(false)} />
      </Dialog>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}
