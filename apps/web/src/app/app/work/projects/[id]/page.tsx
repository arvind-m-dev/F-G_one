'use client';
import { PROJECT_STATUS_LABELS, TASK_STATUS_LABELS, type TaskStatus } from '@fg/shared';
import { useMutation } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Ellipsis, FolderX, ListTodo, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui/dropdown';
import { Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { ProjectDialog } from '@/components/work/project-form';
import { AvatarStack, BOARD_STATUSES, StatusIcon } from '@/components/work/task-bits';
import { NewTaskDialog, type NewTaskDefaults } from '@/components/work/task-form';
import { TaskPanel } from '@/components/work/task-panel';
import { TaskRow } from '@/components/work/task-row';
import { BoardView, ProjectProgress, targetLabel, TaskFilters, TimelineView, ViewTabs } from '@/components/work/views';
import { WorkloadView } from '@/components/work/workload';
import { api, errorMessage } from '@/lib/api';
import { useOrgToday } from '@/lib/session';
import { useUrlState } from '@/lib/url-state';
import { useProject, useRefreshWork, useTasks, useWorkSummary, type Project } from '@/lib/work';
import { cn } from '@/lib/utils';

const VIEWS = ['board', 'list', 'timeline', 'team'] as const;
type View = (typeof VIEWS)[number];
const LABELS: Record<View, string> = { board: 'Board', list: 'List', timeline: 'Timeline', team: 'Team load' };

function TaskList({ projectId, who, today, onOpen, onNew }: { projectId: string; who: string; today: string; onOpen: (id: string) => void; onNew: () => void }) {
  const q = useTasks({ scope: who === 'me' ? 'mine' : 'all', projectId, status: 'ALL' });
  const groups = useMemo(() => ([...BOARD_STATUSES, 'CANCELLED'] as TaskStatus[]).map((s) => ({ status: s, tasks: (q.data ?? []).filter((t) => t.status === s) })).filter((g) => g.tasks.length), [q.data]);
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <EmptyState icon={<ListTodo />} title="Tasks couldn't be loaded" description={errorMessage(q.error)} action={<Button variant="outline" onClick={() => void q.refetch()}>Try again</Button>} />;
  if (!groups.length) return <EmptyState icon={<ListTodo />} title={who === 'me' ? 'Nothing here is yours yet' : 'No tasks yet'} description="Break the project into tasks so the work can be planned and shared out." action={<Button onClick={onNew}><Plus /> New task</Button>} className="rounded-xl border border-dashed" />;
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.status}>
          <h2 className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted">
            <StatusIcon status={g.status} className="size-3.5" /> {TASK_STATUS_LABELS[g.status]} · {g.tasks.length}
          </h2>
          <ul className="divide-y overflow-hidden rounded-xl border">
            {g.tasks.map((t) => (
              <TaskRow key={t.id} task={t} today={today} onOpen={onOpen} showOwner />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [get, set] = useUrlState({ view: 'board', task: '', new: '', who: '' });
  const project = useProject(id);
  const summary = useWorkSummary();
  const refresh = useRefreshWork();
  const orgToday = useOrgToday().today();
  const today = summary.data?.today ?? orgToday;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [taskDefaults, setTaskDefaults] = useState<NewTaskDefaults>({ projectId: id });

  const setStatus = useMutation({
    mutationFn: (status: Project['status']) => api<Project>(`/work/projects/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: (p) => {
      toast.success(p.status === 'ARCHIVED' ? 'Project archived' : 'Project reopened');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/work/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Project deleted');
      refresh();
      router.push('/app/work?view=projects');
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      setDeleting(false);
    },
  });

  const crumbs = [{ label: 'Work', href: '/app/work' }, { label: 'Projects', href: '/app/work?view=projects' }];
  if (project.isPending) {
    return (
      <div className="mx-auto max-w-[1280px] px-6 pt-8 pb-14 sm:px-10">
        <Skeleton className="h-24" />
        <Skeleton className="mt-6 h-[50dvh]" />
      </div>
    );
  }
  if (project.isError) {
    return (
      <div className="mx-auto max-w-[1280px] px-6 pt-8 pb-14 sm:px-10">
        <PageHeader className="px-0 pt-0 sm:px-0" title="Project not found" breadcrumbs={[...crumbs, { label: 'Not found' }]} />
        <EmptyState icon={<FolderX />} title="This project isn't available" description="It may have been deleted, or you are not on it. Ask the project lead to add you." action={<Link href="/app/work?view=projects" className="text-sm font-medium text-primary hover:underline">Back to projects</Link>} className="rounded-xl border border-dashed" />
      </div>
    );
  }
  const p = project.data;
  const closed = p.status === 'ARCHIVED' || p.status === 'COMPLETED';
  const canPlan = p.can.manage || summary.data?.can.reach === 'ORG';
  const available = VIEWS.filter((v) => v !== 'team' || canPlan);
  const view: View = available.includes(get('view') as View) ? (get('view') as View) : 'board';
  const openTask = (taskId: string) => set({ task: taskId }, { push: true });
  const newTask = (status?: TaskStatus) => {
    setTaskDefaults({ projectId: id, ...(status ? { status } : {}), assignee: null });
    set({ new: '1' });
  };
  const target = targetLabel(p, today);

  return (
    <div className="mx-auto max-w-[1280px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader
        className="px-0 pt-0 pb-5 sm:px-0"
        breadcrumbs={[...crumbs, { label: p.name }]}
        documentTitle={p.name}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="size-3.5 shrink-0 rounded-[5px]" style={{ background: p.color }} aria-hidden />
            {p.name}
            <span className="font-mono text-xs font-medium text-muted">{p.key}</span>
            {p.status !== 'ACTIVE' && <Badge tone={p.status === 'COMPLETED' ? 'success' : 'muted'}>{PROJECT_STATUS_LABELS[p.status]}</Badge>}
          </span>
        }
        description={p.description ?? undefined}
        actions={
          <>
            {p.can.manage && (
              <DropdownMenu>
                <DropdownTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Project options">
                    <Ellipsis />
                  </Button>
                </DropdownTrigger>
                <DropdownContent>
                  <DropdownItem onSelect={() => setEditing(true)}>
                    <Pencil /> Edit project
                  </DropdownItem>
                  {p.status === 'ARCHIVED' ? (
                    <DropdownItem onSelect={() => setStatus.mutate('ACTIVE')}>
                      <ArchiveRestore /> Reopen project
                    </DropdownItem>
                  ) : (
                    <DropdownItem onSelect={() => setStatus.mutate('ARCHIVED')}>
                      <Archive /> Archive project
                    </DropdownItem>
                  )}
                  <DropdownSeparator />
                  <DropdownItem danger onSelect={() => setDeleting(true)}>
                    <Trash2 /> Delete project
                  </DropdownItem>
                </DropdownContent>
              </DropdownMenu>
            )}
            {!closed && (
              <Button onClick={() => newTask()}>
                <Plus /> New task
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid items-center gap-x-8 gap-y-4 rounded-2xl border bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:p-5">
        <ProjectProgress counts={p.counts} />
        <div className="flex items-center gap-2.5">
          {p.lead ? (
            <>
              <UserAvatar person={p.lead} size="sm" />
              <span className="text-[13px]">
                <span className="block text-xs text-muted">Lead</span>
                <span className="font-medium">{p.lead.name}</span>
              </span>
            </>
          ) : (
            <span className="text-[13px] text-muted">No lead</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <AvatarStack people={p.members} max={6} size="sm" />
          <span className="text-[13px]">
            <span className="block text-xs text-muted">
              {p.members.length} {p.members.length === 1 ? 'person' : 'people'}
            </span>
            <span className={cn('font-medium', target?.late && 'text-danger')}>{target?.text ?? 'No target date'}</span>
          </span>
        </div>
      </div>

      <ViewTabs tabs={available.map((v) => [v, LABELS[v]] as const)} value={view} onChange={(v) => set({ view: v }, { push: true })} label="Project views" />
      {view !== 'team' && <TaskFilters project={id} who={get('who')} projects={undefined} hideProject onChange={(x) => set(x)} />}
      {view === 'board' && <BoardView project={id} who={get('who')} today={today} onOpen={openTask} onAdd={closed ? () => toast.info('Reopen the project to add tasks') : newTask} showProject={false} />}
      {view === 'list' && <TaskList projectId={id} who={get('who')} today={today} onOpen={openTask} onNew={() => newTask()} />}
      {view === 'timeline' && <TimelineView project={id} who={get('who')} today={today} onOpen={openTask} onNew={() => newTask()} />}
      {view === 'team' && canPlan && <WorkloadView projectId={id} onOpen={openTask} />}

      <TaskPanel id={get('task') || null} onClose={() => set({ task: null })} />
      <NewTaskDialog open={get('new') === '1'} onOpenChange={(o) => set({ new: o ? '1' : null })} defaults={taskDefaults} />
      <ProjectDialog open={editing} onOpenChange={setEditing} project={p} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this project?"
        description={p.counts.total ? `${p.name} has tasks, so it cannot be deleted. Archive it instead to keep its history.` : `${p.name} has no tasks and will be removed for everyone.`}
        confirmLabel={p.counts.total ? 'Archive instead' : 'Delete project'}
        danger={!p.counts.total}
        loading={remove.isPending || setStatus.isPending}
        onConfirm={() => {
          if (p.counts.total) {
            setStatus.mutate('ARCHIVED');
            setDeleting(false);
          } else remove.mutate();
        }}
      />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ProjectPage />
    </Suspense>
  );
}
