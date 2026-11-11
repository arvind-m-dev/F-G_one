'use client';
import type { TaskStatus } from '@fg/shared';
import { FolderPlus, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { PageHeader } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { ProjectDialog } from '@/components/work/project-form';
import { ReportView } from '@/components/work/report';
import { NewTaskDialog, type NewTaskDefaults } from '@/components/work/task-form';
import { TaskPanel } from '@/components/work/task-panel';
import { BoardView, MyWork, ProjectsView, TaskFilters, TimelineView, ViewTabs } from '@/components/work/views';
import { WorkloadView } from '@/components/work/workload';
import { useOrgToday } from '@/lib/session';
import { useUrlState } from '@/lib/url-state';
import { useProjects, useWorkSummary } from '@/lib/work';

const VIEWS = ['mine', 'board', 'timeline', 'projects', 'team', 'report'] as const;
type View = (typeof VIEWS)[number];
const LABELS: Record<View, string> = { mine: 'My work', board: 'Board', timeline: 'Timeline', projects: 'Projects', team: 'Team load', report: 'Daily report' };
const DESCRIPTIONS: Record<View, string> = {
  mine: 'What is on your plate, in the order to do it, and whether it fits in your time.',
  board: 'Every task by stage. Drag a card to move it along.',
  timeline: 'When each task is expected to be worked on and finished, against its due date.',
  projects: 'Groups of work with a lead, a team and a target date.',
  team: 'Who has too much, who has room, and what to move.',
  report: 'What was finished and started on a day, and what needs attention now.',
};

function WorkPage() {
  const router = useRouter();
  const [get, set] = useUrlState({ view: 'mine', task: '', new: '', project: '', who: '', date: '', all: '' });
  const summary = useWorkSummary();
  const projects = useProjects();
  const orgToday = useOrgToday().today();
  const today = summary.data?.today ?? orgToday;
  const canPlan = summary.data?.can.plan ?? false;
  const [taskDefaults, setTaskDefaults] = useState<NewTaskDefaults>({});
  const [newProject, setNewProject] = useState(false);

  const available = VIEWS.filter((v) => v !== 'team' || canPlan);
  const requested = get('view') as View;
  // "Team load" in a shared link falls back to "My work" for people who do not plan anyone's work.
  const view: View = available.includes(requested) ? requested : summary.isPending && requested === 'team' ? 'team' : 'mine';
  const openTask = (id: string) => set({ task: id }, { push: true });
  const newTask = (defaults: NewTaskDefaults = {}) => {
    setTaskDefaults(defaults);
    set({ new: '1' });
  };
  const project = get('project');
  const who = get('who');

  return (
    <div className="mx-auto max-w-[1280px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader
        className="px-0 pt-0 pb-5 sm:px-0"
        title="Work"
        documentTitle={view === 'mine' ? 'Work' : `${LABELS[view]} · Work`}
        description={DESCRIPTIONS[view]}
        actions={
          <>
            {view === 'projects' && summary.data?.can.createProject && (
              <Button variant="outline" onClick={() => setNewProject(true)}>
                <FolderPlus /> New project
              </Button>
            )}
            <Button onClick={() => newTask(project && project !== 'none' && (view === 'board' || view === 'timeline') ? { projectId: project } : {})}>
              <Plus /> New task
            </Button>
          </>
        }
      />
      <ViewTabs tabs={available.map((v) => [v, LABELS[v]] as const)} value={view} onChange={(v) => set({ view: v, date: null }, { push: true })} label="Work views" />

      {view === 'mine' && <MyWork onOpen={openTask} onNew={() => newTask()} />}
      {(view === 'board' || view === 'timeline') && <TaskFilters project={project} who={who} projects={projects.data} onChange={(p) => set(p)} />}
      {view === 'board' && <BoardView project={project} who={who} today={today} onOpen={openTask} onAdd={(status: TaskStatus) => newTask({ status, ...(project && project !== 'none' ? { projectId: project } : {}) })} />}
      {view === 'timeline' && <TimelineView project={project} who={who} today={today} onOpen={openTask} onNew={() => newTask()} />}
      {view === 'projects' && <ProjectsView showAll={get('all') === '1'} onShowAll={(v) => set({ all: v ? '1' : null })} onNew={() => setNewProject(true)} canCreate={summary.data?.can.createProject ?? false} today={today} />}
      {view === 'team' && canPlan && <WorkloadView onOpen={openTask} />}
      {view === 'report' && <ReportView date={get('date')} onDate={(d) => set({ date: d })} onOpen={openTask} />}

      <TaskPanel id={get('task') || null} onClose={() => set({ task: null })} />
      <NewTaskDialog open={get('new') === '1'} onOpenChange={(o) => set({ new: o ? '1' : null })} defaults={taskDefaults} />
      <ProjectDialog open={newProject} onOpenChange={setNewProject} onSaved={(p) => router.push(`/app/work/projects/${p.id}`)} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <WorkPage />
    </Suspense>
  );
}
