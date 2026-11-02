'use client';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery } from '@tanstack/react-query';
import { WIDGET_LABELS, type WidgetKey } from '@fg/shared';
import { Check, Eye, EyeOff, GripVertical, LayoutGrid, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { NewMessageDialog } from '@/components/chat/new-conversation';
import { WIDGETS, type DashboardData } from '@/components/dashboard/widgets';
import { StatusPicker } from '@/components/status-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useLivePerson } from '@/lib/presence-store';
import { useSession, useUpdatePreferences } from '@/lib/session';
import { cn } from '@/lib/utils';

const spanClass = { 1: 'lg:col-span-1', 2: 'lg:col-span-2', 3: 'lg:col-span-3' } as const;

function SortableWidget({ id, editing, children }: { id: WidgetKey; editing: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editing });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative min-w-0', spanClass[WIDGETS[id].span], isDragging && 'z-30 opacity-80')}
    >
      {editing && (
        <button
          {...attributes}
          {...listeners}
          className="absolute top-3 right-3 z-10 flex cursor-grab items-center gap-1 rounded-lg border bg-surface/95 px-2 py-1 text-xs font-medium text-muted shadow-sm backdrop-blur active:cursor-grabbing"
          aria-label={`Drag to reorder ${WIDGET_LABELS[id]}`}
        >
          <GripVertical className="size-3.5" /> Drag
        </button>
      )}
      <div className={cn('h-full transition', editing && 'pointer-events-none rounded-2xl ring-2 ring-primary/40 ring-offset-2 ring-offset-background select-none')}>{children}</div>
    </div>
  );
}

function Dashboard() {
  const me = useSession();
  const savePrefs = useUpdatePreferences();
  const welcome = useSearchParams().get('welcome');
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/dashboard'), refetchInterval: 60_000 });
  const [editing, setEditing] = useState(false);
  const [newMsg, setNewMsg] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const live = useLivePerson({ ...me.user, online: true });

  const allowedKey = me.organization.settings.dashboard.defaultWidgets.join(',');
  const personalKey = me.organization.settings.dashboard.allowPersonalLayout ? me.preferences.dashboardWidgets?.join(',') : undefined;
  const allowed = useMemo(() => (allowedKey ? (allowedKey.split(',') as WidgetKey[]) : []).filter((k) => k in WIDGETS), [allowedKey]);
  const initial = useMemo(() => (personalKey !== undefined ? (personalKey ? (personalKey.split(',') as WidgetKey[]) : []).filter((k) => allowed.includes(k)) : allowed), [personalKey, allowed]);
  const [order, setOrder] = useState<WidgetKey[]>(initial);
  useEffect(() => setOrder(initial), [initial]);
  const hidden = allowed.filter((k) => !order.includes(k));

  useEffect(() => {
    if (welcome) toast.success(`Welcome to FG One, ${me.user.firstName}! 🎉`, { description: 'Set your status and say hi in #general.' });
  }, [welcome, me.user.firstName]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setOrder((o) => arrayMove(o, o.indexOf(e.active.id as WidgetKey), o.indexOf(e.over!.id as WidgetKey)));
  };
  const save = async () => {
    try {
      await savePrefs({ dashboardWidgets: order });
      setEditing(false);
      toast.success('Dashboard layout saved');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const actions = { newMessage: () => setNewMsg(true), setStatus: () => setStatusOpen(true) };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Home</h2>
          <p className="text-sm text-muted">Your day at {me.organization.name}, at a glance.</p>
        </div>
        {me.organization.settings.dashboard.allowPersonalLayout && (
          <div className="flex gap-2">
            {editing ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setOrder(allowed)}>
                  <RotateCcw /> Reset
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setOrder(initial); setEditing(false); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={save}>
                  <Check /> Save layout
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <LayoutGrid /> Customize
              </Button>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mb-5 rounded-2xl border border-dashed border-primary/40 bg-primary-soft/50 p-4">
              <p className="text-sm font-medium">Drag widgets to rearrange. Toggle to show or hide.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {allowed.map((k) => {
                  const on = order.includes(k);
                  return (
                    <button
                      key={k}
                      onClick={() => setOrder((o) => (on ? o.filter((x) => x !== k) : [...o, k]))}
                      className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition', on ? 'border-primary bg-surface text-primary' : 'bg-surface/60 text-muted')}
                      aria-pressed={on}
                    >
                      {on ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />} {WIDGET_LABELS[k]}
                    </button>
                  );
                })}
              </div>
              {hidden.length > 0 && <p className="mt-2 text-xs text-muted">{hidden.length} hidden</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {dash.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-48 lg:col-span-2" />
          <Skeleton className="h-48" />
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      ) : dash.isError ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-sm">
          Couldn&apos;t load your dashboard: {errorMessage(dash.error)}{' '}
          <button className="font-medium text-primary underline" onClick={() => dash.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={rectSortingStrategy}>
            <motion.div className="grid grid-flow-dense gap-4 lg:grid-cols-3" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }}>
              {order.map((k) => {
                const W = WIDGETS[k].component;
                return (
                  <SortableWidget key={k} id={k} editing={editing}>
                    <motion.div className="h-full" variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}>
                      <W data={dash.data!} actions={actions} />
                    </motion.div>
                  </SortableWidget>
                );
              })}
            </motion.div>
          </SortableContext>
        </DndContext>
      )}

      <NewMessageDialog open={newMsg} onOpenChange={setNewMsg} />
      <Dialog open={statusOpen} onOpenChange={setStatusOpen} title="Update your status" description="Your availability is separate from attendance." className="max-w-sm">
        <StatusPicker current={live} userId={me.user.id} onDone={() => setStatusOpen(false)} />
      </Dialog>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
