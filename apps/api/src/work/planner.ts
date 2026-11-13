import { TASK_SIZE_DAYS, type TaskPriority, type TaskSize, type TaskStatus } from '@fg/shared';
import { addDays } from '../common/tz';

/**
 * Work planner. Pure functions, no database: the service loads tasks, leave and holidays
 * and asks these to lay the work out on the calendar.
 *
 * Model (kept simple so people can check it by hand):
 *  - a task's size is its effort in working days (TASK_SIZE_DAYS);
 *  - started work has less left: 60% when in progress, 20% when in review;
 *  - one person does one day of work per working day, none on leave;
 *  - each person's open tasks are queued by due date, then priority, and laid end to end from today.
 */
export interface PlanTask {
  id: string;
  assigneeId: string | null;
  size: TaskSize;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string | null;
  dueDate: string | null;
  createdAt: Date | string;
}

export interface PlanCalendar {
  /** Today in the organization's time zone (YYYY-MM-DD). */
  today: string;
  /** Company working day (weekends and holidays excluded). */
  isWorkingDay(ymd: string): boolean;
  /** Approved leave for this person on this day. */
  onLeave(userId: string, ymd: string): boolean;
}

const LEFT: Partial<Record<TaskStatus, number>> = { TODO: 1, IN_PROGRESS: 0.6, IN_REVIEW: 0.2 };
const PRIORITY_RANK: Record<TaskPriority, number> = { URGENT: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
const EPS = 1e-9;
/** Planning never looks further ahead than this many calendar days. */
const HORIZON = 400;
export const LOAD_WINDOW_WORKING_DAYS = 10;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Working days of effort still needed. Tasks that are done, cancelled or parked for later need none. */
export function remainingDays(t: Pick<PlanTask, 'size' | 'status'>): number {
  return round1(TASK_SIZE_DAYS[t.size] * (LEFT[t.status] ?? 0));
}

/** Queue order: earliest due date first (no date last), then higher priority, then older. */
export function queueOrder(a: PlanTask, b: PlanTask): number {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  if (a.priority !== b.priority) return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function nextWorkable(userId: string, from: string, cal: PlanCalendar): string {
  let d = from;
  for (let i = 0; i < HORIZON; i++) {
    if (cal.isWorkingDay(d) && !cal.onLeave(userId, d)) return d;
    d = addDays(d, 1);
  }
  return d;
}

export interface Slot {
  taskId: string;
  start: string;
  /** The day the work is expected to finish. */
  end: string;
  late: boolean;
}

export interface Schedule {
  slots: Map<string, Slot>;
  /** First day with time to spare once everything queued is finished. */
  freeFrom: string;
}

/** Lays one person's open tasks end to end from today. */
export function schedule(userId: string, tasks: PlanTask[], cal: PlanCalendar): Schedule {
  const slots = new Map<string, Slot>();
  let day = nextWorkable(userId, cal.today, cal);
  let left = 1;
  for (const t of [...tasks].sort(queueOrder)) {
    let need = remainingDays(t);
    if (need <= EPS) continue;
    if (t.startDate && t.startDate > day) {
      day = nextWorkable(userId, t.startDate, cal);
      left = 1;
    }
    const start = day;
    while (need > EPS) {
      const use = Math.min(left, need);
      need -= use;
      left -= use;
      if (need > EPS) {
        day = nextWorkable(userId, addDays(day, 1), cal);
        left = 1;
      }
    }
    slots.set(t.id, { taskId: t.id, start, end: day, late: !!t.dueDate && day > t.dueDate });
    if (left <= EPS) {
      day = nextWorkable(userId, addDays(day, 1), cal);
      left = 1;
    }
  }
  return { slots, freeFrom: day };
}

/** Last day of the planning window: the Nth company working day counting from today. */
export function windowEnd(cal: PlanCalendar, workingDays = LOAD_WINDOW_WORKING_DAYS): string {
  let d = cal.today;
  let n = 0;
  for (let i = 0; i < HORIZON; i++) {
    if (cal.isWorkingDay(d)) n++;
    if (n >= workingDays) return d;
    d = addDays(d, 1);
  }
  return d;
}

export type LoadLevel = 'free' | 'light' | 'steady' | 'over';
export interface Load {
  /** Working days this person has in the window (leave removed). */
  availableDays: number;
  /** Days of work due inside the window, plus work with no date. */
  demandDays: number;
  /** All remaining work, whenever it is due. */
  openDays: number;
  /** demand ÷ available, as a percentage. Over 100 means more work than time. */
  pct: number;
  level: LoadLevel;
  openTasks: number;
  /** Tasks the plan cannot finish by their due date. */
  lateTasks: number;
  freeFrom: string;
}

export function loadOf(userId: string, tasks: PlanTask[], cal: PlanCalendar): Load {
  const end = windowEnd(cal);
  let availableDays = 0;
  for (let d = cal.today; d <= end; d = addDays(d, 1)) if (cal.isWorkingDay(d) && !cal.onLeave(userId, d)) availableDays++;
  let demandDays = 0;
  let openDays = 0;
  let openTasks = 0;
  for (const t of tasks) {
    const r = remainingDays(t);
    if (r <= EPS) continue;
    openTasks++;
    openDays += r;
    if (!t.dueDate || t.dueDate <= end) demandDays += r;
  }
  const s = schedule(userId, tasks, cal);
  const lateTasks = [...s.slots.values()].filter((x) => x.late).length;
  const pct = availableDays > 0 ? Math.round((demandDays / availableDays) * 100) : demandDays > 0 ? 999 : 0;
  const level: LoadLevel = pct > 100 ? 'over' : pct >= 60 ? 'steady' : pct > 0 ? 'light' : 'free';
  return { availableDays, demandDays: round1(demandDays), openDays: round1(openDays), pct, level, openTasks, lateTasks, freeFrom: s.freeFrom };
}

export interface Candidate {
  userId: string;
  /** Their load today, before taking the task. */
  pct: number;
  /** Their load if they take it. */
  pctAfter: number;
  /** When they would be expected to finish it. */
  finishBy: string;
  late: boolean;
}

/** How each possible new owner would cope with `task`. Best first: on time, then soonest, then least loaded. */
export function candidatesFor(task: PlanTask, candidateIds: string[], byUser: Map<string, PlanTask[]>, cal: PlanCalendar): Candidate[] {
  // Parked work is planned as if it were ready to start.
  const asOpen: PlanTask = remainingDays(task) > EPS ? task : { ...task, status: 'TODO' };
  const out: Candidate[] = [];
  for (const userId of candidateIds) {
    if (userId === task.assigneeId) continue;
    const own = byUser.get(userId) ?? [];
    const withTask = [...own, { ...asOpen, assigneeId: userId }];
    const slot = schedule(userId, withTask, cal).slots.get(task.id);
    if (!slot) continue;
    out.push({ userId, pct: loadOf(userId, own, cal).pct, pctAfter: loadOf(userId, withTask, cal).pct, finishBy: slot.end, late: slot.late });
  }
  return out.sort((a, b) => Number(a.late) - Number(b.late) || (a.finishBy < b.finishBy ? -1 : a.finishBy > b.finishBy ? 1 : 0) || a.pctAfter - b.pctAfter);
}

export interface Suggestion {
  taskId: string;
  kind: 'REASSIGN' | 'MOVE_DATE';
  fromUserId: string;
  /** REASSIGN */
  toUserId?: string;
  /** MOVE_DATE: the earliest date the plan can meet. REASSIGN: when the new owner would finish. */
  date: string;
  fromPct: number;
  toPct?: number;
  toPctAfter?: number;
}

/** A new owner must stay at or under this load after taking a task. */
const RECEIVER_MAX_PCT = 90;
const MAX_SUGGESTIONS = 20;

/**
 * Proposals that even the work out. For each person with more work than time (or work that will
 * finish late): hand work that has not been started to someone who has room and can finish it on
 * time; when nobody can, propose the earliest date the plan can meet.
 * `eligible(task)` lists who may take a task (project members, or the manager's team).
 */
export function suggest(userIds: string[], tasks: PlanTask[], cal: PlanCalendar, eligible: (t: PlanTask) => string[]): Suggestion[] {
  const byUser = new Map<string, PlanTask[]>(userIds.map((id) => [id, []]));
  for (const t of tasks) if (t.assigneeId && byUser.has(t.assigneeId) && remainingDays(t) > EPS) byUser.get(t.assigneeId)!.push({ ...t });
  const end = windowEnd(cal);
  const out: Suggestion[] = [];
  const touched = new Set<string>();
  const order = [...userIds].sort((a, b) => loadOf(b, byUser.get(b)!, cal).pct - loadOf(a, byUser.get(a)!, cal).pct);

  for (const userId of order) {
    for (let guard = 0; guard < 8 && out.length < MAX_SUGGESTIONS; guard++) {
      const mine = byUser.get(userId)!;
      const load = loadOf(userId, mine, cal);
      if (load.pct <= 100 && load.lateTasks === 0) break;
      const plan = schedule(userId, mine, cal);
      const isLate = (t: PlanTask) => plan.slots.get(t.id)?.late ?? false;
      // Only work nobody has started is handed over; late work first, then the least important, then the biggest.
      const movable = mine
        .filter((t) => t.status === 'TODO' && !touched.has(t.id) && (isLate(t) || !t.dueDate || t.dueDate <= end))
        .sort((a, b) => Number(isLate(b)) - Number(isLate(a)) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || remainingDays(b) - remainingDays(a));
      let moved = false;
      for (const t of movable) {
        const pool = eligible(t).filter((id) => id !== userId && byUser.has(id));
        const best = candidatesFor(t, pool, byUser, cal).find((c) => !c.late && c.pctAfter <= RECEIVER_MAX_PCT);
        if (!best) continue;
        out.push({ taskId: t.id, kind: 'REASSIGN', fromUserId: userId, toUserId: best.userId, date: best.finishBy, fromPct: load.pct, toPct: best.pct, toPctAfter: best.pctAfter });
        touched.add(t.id);
        byUser.set(userId, mine.filter((x) => x.id !== t.id));
        byUser.get(best.userId)!.push({ ...t, assigneeId: best.userId });
        moved = true;
        break;
      }
      if (moved) continue;
      // Nobody has room: say honestly when the late work can be finished.
      for (const t of mine) {
        const slot = plan.slots.get(t.id);
        if (!slot?.late || touched.has(t.id) || out.length >= MAX_SUGGESTIONS) continue;
        out.push({ taskId: t.id, kind: 'MOVE_DATE', fromUserId: userId, date: slot.end, fromPct: load.pct });
        touched.add(t.id);
      }
      break;
    }
  }
  return out;
}
