'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectStatus, TaskKind, TaskLink, TaskPriority, TaskSize, TaskStatus, UpdateTaskInput, WorkRequestKind } from '@fg/shared';
import { toast } from 'sonner';
import { api, errorMessage } from './api';

/* ───── types (mirror apps/api/src/work/work.service.ts) ───── */
export interface MiniPerson {
  id: string;
  name: string;
  designation: string | null;
  avatarUrl: string | null;
  avatarColor: string;
}
export interface ProjectRef {
  id: string;
  key: string;
  name: string;
  color: string;
}
export interface TaskPlan {
  start: string;
  end: string;
  late: boolean;
}
export interface Task {
  id: string;
  ref: string | null;
  title: string;
  description: string | null;
  kind: TaskKind;
  status: TaskStatus;
  priority: TaskPriority;
  size: TaskSize;
  remainingDays: number;
  project: ProjectRef | null;
  assignee: MiniPerson | null;
  createdBy: MiniPerson | null;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  position: number;
  links: TaskLink[];
  commentCount: number;
  pendingRequest: boolean;
  overdue: boolean;
  plan: TaskPlan | null;
  can: { manage: boolean; update: boolean; request: boolean };
  createdAt: string;
  updatedAt: string;
}
export interface WorkRequest {
  id: string;
  kind: WorkRequestKind;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELLED';
  reason: string;
  rationale: string | null;
  previousDueDate: string | null;
  proposedDueDate: string | null;
  proposedAssignee: MiniPerson | null;
  requester: MiniPerson;
  decider: MiniPerson | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  task: { id: string; ref: string | null; title: string; size: TaskSize; status: TaskStatus; dueDate: string | null; project: ProjectRef | null };
  can: { decide: boolean; cancel: boolean };
}
export interface TaskDetail extends Task {
  comments: { id: string; body: string; author: MiniPerson | null; createdAt: string }[];
  activity: { id: string; kind: string; data: Record<string, unknown>; actor: MiniPerson | null; createdAt: string }[];
  requests: WorkRequest[];
}
export interface Project extends ProjectRef {
  description: string | null;
  status: ProjectStatus;
  lead: MiniPerson | null;
  members: MiniPerson[];
  startDate: string | null;
  targetDate: string | null;
  counts: { total: number; done: number; open: number; overdue: number };
  can: { manage: boolean };
  createdAt: string;
}
export type LoadLevel = 'free' | 'light' | 'steady' | 'over';
export interface Load {
  availableDays: number;
  demandDays: number;
  openDays: number;
  pct: number;
  level: LoadLevel;
  openTasks: number;
  lateTasks: number;
  freeFrom: string;
}
export interface WorkSummary {
  today: string;
  windowEnd: string;
  load: Load;
  counts: { open: number; overdue: number; dueToday: number; dueThisWeek: number; pendingRequests: number; toDecide: number };
  can: { createProject: boolean; plan: boolean; reach: 'ORG' | 'TEAM' | null };
}
export interface QueueTask {
  id: string;
  /** Work on a project you cannot see: it takes time, but its details stay private. */
  hidden: boolean;
  ref: string | null;
  title: string;
  size: TaskSize;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  remainingDays: number;
  project: ProjectRef | null;
  plan: (TaskPlan & { taskId: string }) | null;
}
export interface Suggestion {
  taskId: string;
  kind: WorkRequestKind;
  fromUserId: string;
  toUserId?: string;
  date: string;
  fromPct: number;
  toPct?: number;
  toPctAfter?: number;
  task: { id: string; ref: string | null; title: string; size: TaskSize; dueDate: string | null };
  from: MiniPerson;
  to: MiniPerson | null;
}
export interface Workload {
  today: string;
  windowEnd: string;
  people: { person: MiniPerson; load: Load; tasks: QueueTask[] }[];
  suggestions: Suggestion[];
}
export interface Relief {
  dueDate: string | null;
  remainingDays: number;
  load: Load | null;
  windowEnd: string;
  expectedEnd: string | null;
  late: boolean;
  candidates: { userId: string; pct: number; pctAfter: number; finishBy: string; late: boolean; person: MiniPerson }[];
  approvers: MiniPerson[];
}
interface ReportLine {
  id: string;
  ref: string | null;
  title: string;
  assigneeId: string | null;
}
export interface WorkReport {
  date: string;
  today: string;
  totals: { done: number; started: number; created: number; overdue: number; atRisk: number; unassigned: number; waitingForDecision: number };
  done: ReportLine[];
  started: ReportLine[];
  overdue: ReportLine[];
  atRisk: ReportLine[];
  people: { person: MiniPerson; done: number; started: number; open: number; overdue: number; pct: number; level: LoadLevel }[];
}

/* ───── queries. Every key starts with "work" so one invalidation refreshes them all. ───── */
export interface TaskQuery {
  scope?: 'mine' | 'team' | 'all';
  projectId?: string;
  assigneeId?: string;
  status?: TaskStatus | 'OPEN' | 'ALL';
  q?: string;
}
const keep = <T,>(p: T | undefined) => p;
export const useWorkSummary = (enabled = true) => useQuery({ queryKey: ['work', 'summary'], queryFn: () => api<WorkSummary>('/work/summary'), enabled });
export const useProjects = (include: 'active' | 'all' = 'active', enabled = true) => useQuery({ queryKey: ['work', 'projects', include], queryFn: () => api<Project[]>('/work/projects', { query: { include } }), enabled, placeholderData: keep });
export const useProject = (id: string, enabled = true) => useQuery({ queryKey: ['work', 'project', id], queryFn: () => api<Project>(`/work/projects/${id}`), retry: false, enabled: enabled && !!id });
export const useTasks = (q: TaskQuery, enabled = true) => useQuery({ queryKey: ['work', 'tasks', q], queryFn: () => api<Task[]>('/work/tasks', { query: { ...q } }), enabled, placeholderData: keep });
export const useTask = (id: string | null) => useQuery({ queryKey: ['work', 'task', id], queryFn: () => api<TaskDetail>(`/work/tasks/${id}`), enabled: !!id, retry: false });
export const useRelief = (id: string | null) => useQuery({ queryKey: ['work', 'relief', id], queryFn: () => api<Relief>(`/work/tasks/${id}/relief`), enabled: !!id });
export const useWorkRequests = (scope: 'mine' | 'approvals', status = 'ALL', enabled = true) => useQuery({ queryKey: ['work', 'requests', scope, status], queryFn: () => api<WorkRequest[]>('/work/requests', { query: { scope, status } }), enabled });
export const useWorkload = (projectId?: string, enabled = true) => useQuery({ queryKey: ['work', 'workload', projectId ?? 'all'], queryFn: () => api<Workload>('/work/workload', { query: { projectId } }), enabled, placeholderData: keep });
export const useWorkReport = (date?: string, enabled = true) => useQuery({ queryKey: ['work', 'report', date ?? 'today'], queryFn: () => api<WorkReport>('/work/report', { query: { date } }), enabled, placeholderData: keep });

export function useRefreshWork() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['work'] });
    void qc.invalidateQueries({ queryKey: ['approvals-count'] });
  };
}

/** Change a task. Lists update at once and fall back to the server's answer if the change is refused. */
export function useUpdateTask() {
  const qc = useQueryClient();
  const refresh = useRefreshWork();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTaskInput }) => api<Task>(`/work/tasks/${id}`, { method: 'PATCH', body: patch }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['work', 'tasks'] });
      // Only fields that look the same on the server are patched locally; people and plans come back with the response.
      const { assigneeId: _a, ...local } = patch;
      const apply = <T extends Task>(t: T): T => (t.id === id ? { ...t, ...local, links: local.links ?? t.links } : t);
      qc.setQueriesData<Task[]>({ queryKey: ['work', 'tasks'] }, (list) => list?.map(apply));
      qc.setQueryData<TaskDetail>(['work', 'task', id], (t) => (t ? apply(t) : t));
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: refresh,
  });
}

/* ───── dates and labels ───── */
const noon = (ymd: string) => new Date(`${ymd}T12:00:00`);
export const addDaysYmd = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** "20 Nov", with the year only when it is not this year. */
export function fmtDay(ymd: string, opts: { weekday?: boolean } = {}) {
  const d = noon(ymd);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', weekday: opts.weekday ? 'short' : undefined, year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}
export const fmtEffort = (n: number) => (n === 0.5 ? 'half a day' : `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? 'day' : 'days'}`);

export type Tone = 'danger' | 'warning' | 'muted' | 'success';
/** How a due date reads next to a task, relative to today. */
export function dueLabel(t: Pick<Task, 'dueDate' | 'status'>, today: string): { text: string; tone: Tone } | null {
  if (!t.dueDate) return null;
  if (t.status === 'DONE' || t.status === 'CANCELLED') return { text: fmtDay(t.dueDate), tone: 'muted' };
  const n = daysBetween(today, t.dueDate);
  if (n < 0) return { text: n === -1 ? '1 day late' : `${-n} days late`, tone: 'danger' };
  if (n === 0) return { text: 'Due today', tone: 'warning' };
  if (n === 1) return { text: 'Due tomorrow', tone: 'warning' };
  if (n < 7) return { text: `Due ${noon(t.dueDate).toLocaleDateString(undefined, { weekday: 'long' })}`, tone: 'muted' };
  return { text: `Due ${fmtDay(t.dueDate)}`, tone: 'muted' };
}

export const LOAD_LABEL: Record<LoadLevel, string> = { free: 'Nothing queued', light: 'Has room', steady: 'Full', over: 'Too much' };
/** One sentence that says what a load figure means. */
export function loadSentence(load: Load, who: 'you' | string = 'you') {
  const subject = who === 'you' ? 'You have' : `${who} has`;
  if (!load.openTasks) return `${subject} nothing queued.`;
  const work = `${fmtEffort(load.demandDays)} of work due in the next two weeks`;
  if (load.availableDays === 0) return `${subject} ${work}, and no working days in that time.`;
  return `${subject} ${work} and ${load.availableDays} working ${load.availableDays === 1 ? 'day' : 'days'} to do it.`;
}
