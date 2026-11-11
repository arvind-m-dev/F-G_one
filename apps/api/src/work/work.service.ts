import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  OPEN_TASK_STATUSES, parseOrganizationSettings, PERMISSIONS, RT, TASK_STATUS_LABELS,
  type ProjectInput, type TaskInput, type TaskListQuery, type TaskStatus, type UpdateProjectInput, type UpdateTaskInput, type WorkRequestInput,
} from '@fg/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import { scopeOf, usersWithLegacyPermission } from '../common/authz';
import { addDays, localDate, localToUtc, toDbDate } from '../common/tz';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { candidatesFor, loadOf, queueOrder, remainingDays, schedule, suggest, windowEnd, type PlanCalendar, type PlanTask } from './planner';

const mini = { id: true, firstName: true, lastName: true, displayName: true, designation: true, avatarUrl: true, avatarColor: true } satisfies Prisma.UserSelect;
type MiniRow = Prisma.UserGetPayload<{ select: typeof mini }>;
const toMini = (u: MiniRow | null) => (u ? { id: u.id, name: u.displayName || `${u.firstName} ${u.lastName}`, designation: u.designation, avatarUrl: u.avatarUrl, avatarColor: u.avatarColor } : null);

const taskInclude = {
  project: { select: { id: true, key: true, name: true, color: true, leadId: true, status: true } },
  assignee: { select: { ...mini, managerId: true } },
  createdBy: { select: mini },
  _count: { select: { comments: true } },
  requests: { where: { status: 'PENDING' }, select: { id: true }, take: 1 },
} satisfies Prisma.TaskInclude;
type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

const projectInclude = {
  lead: { select: mini },
  members: { select: { user: { select: mini } }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ProjectInclude;
type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

const requestInclude = {
  task: { include: { project: { select: { id: true, key: true, name: true, color: true, leadId: true } } } },
  requester: { select: { ...mini, managerId: true } },
  proposedAssignee: { select: mini },
  decider: { select: mini },
} satisfies Prisma.WorkRequestInclude;
type RequestRow = Prisma.WorkRequestGetPayload<{ include: typeof requestInclude }>;

type Db = Prisma.TransactionClient;
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dbDate = (s: string | null | undefined) => (s ? toDbDate(s) : s === null ? null : undefined);
/** "20 Nov" for sentences stored with a request. */
const dayLabel = (s: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(toDbDate(s));
const isOpen = (s: string) => (OPEN_TASK_STATUSES as string[]).includes(s);
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const ACTIVE_INTERNAL = { status: 'ACTIVE', accountType: 'INTERNAL' } as const;

@Injectable()
export class WorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ───────────────────────────── access ─────────────────────────────

  /** How far the caller's "Plan and assign work" permission reaches. Everyone manages their own tasks without it. */
  private reach(auth: AuthContext): 'ORG' | 'TEAM' | null {
    const s = scopeOf(auth, 'work.manage');
    return s === 'ORG' ? 'ORG' : s === 'TEAM' ? 'TEAM' : null;
  }

  private projectWhere(auth: AuthContext): Prisma.ProjectWhereInput {
    const base = { organizationId: auth.organizationId };
    if (this.reach(auth) === 'ORG') return base;
    const me = auth.userId;
    return { ...base, OR: [{ leadId: me }, { createdById: me }, { members: { some: { userId: me } } }] };
  }

  /** Tasks the caller may see: their own, their projects', their direct reports' (managers), or everything (ORG). */
  private taskWhere(auth: AuthContext): Prisma.TaskWhereInput {
    const base = { organizationId: auth.organizationId };
    const reach = this.reach(auth);
    if (reach === 'ORG') return base;
    const me = auth.userId;
    return {
      ...base,
      OR: [
        { assigneeId: me },
        { createdById: me },
        { project: { OR: [{ leadId: me }, { members: { some: { userId: me } } }] } },
        ...(reach === 'TEAM' ? [{ assignee: { managerId: me } }] : []),
      ],
    };
  }

  private canManageProject(auth: AuthContext, p: { leadId: string | null; createdById: string | null }) {
    return this.reach(auth) === 'ORG' || p.leadId === auth.userId || p.createdById === auth.userId;
  }

  /** Full control of a task: company-wide planners, the project lead, whoever created it, and the assignee's manager. */
  private canManageTask(auth: AuthContext, t: { createdById: string | null; project: { leadId: string | null } | null; assignee: { managerId: string | null } | null }) {
    const reach = this.reach(auth);
    if (reach === 'ORG') return true;
    if (t.project?.leadId === auth.userId || t.createdById === auth.userId) return true;
    return reach === 'TEAM' && t.assignee?.managerId === auth.userId;
  }

  private async findTask(auth: AuthContext, id: string, db: Db = this.prisma) {
    const t = await db.task.findFirst({ where: { AND: [{ id }, this.taskWhere(auth)] }, include: taskInclude });
    if (!t) throw new NotFoundException('Task not found');
    return t;
  }

  private async findProject(auth: AuthContext, id: string, db: Db = this.prisma) {
    const p = await db.project.findFirst({ where: { AND: [{ id }, this.projectWhere(auth)] }, include: projectInclude });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  /** Active colleagues in this organization among `ids`. Throws when any id is someone else. */
  private async assertPeople(db: Db, organizationId: string, ids: string[], message: string) {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const n = await db.user.count({ where: { id: { in: unique }, organizationId, ...ACTIVE_INTERNAL } });
    if (n !== unique.length) throw new BadRequestException(message);
  }

  /** Who the caller may give a task to. */
  private async assertAssignable(db: Db, auth: AuthContext, project: { id: string; leadId: string | null; createdById?: string | null } | null, assigneeId: string | null) {
    if (!assigneeId) {
      if (!project) throw new BadRequestException('A personal task needs an owner');
      return;
    }
    const person = await db.user.findFirst({ where: { id: assigneeId, organizationId: auth.organizationId, ...ACTIVE_INTERNAL }, select: { id: true, managerId: true } });
    if (!person) throw new BadRequestException('Choose an active colleague');
    const reach = this.reach(auth);
    const isSelf = assigneeId === auth.userId;
    const isReport = reach === 'TEAM' && person.managerId === auth.userId;
    if (project) {
      const member = await db.projectMember.count({ where: { projectId: project.id, userId: assigneeId } });
      if (!member && project.leadId !== assigneeId) throw new BadRequestException('Add them to the project first');
      if (reach === 'ORG' || project.leadId === auth.userId || isSelf || isReport) return;
      throw new ForbiddenException('Only the project lead can give this task to someone else');
    }
    if (reach === 'ORG' || isSelf || isReport) return;
    throw new ForbiddenException('You can give tasks to yourself and to people who report to you');
  }

  private broadcast(organizationId: string) {
    // Empty payload: clients simply refetch what they are allowed to see.
    this.realtime.server?.to(`org:${organizationId}`).emit(RT.WORK_CHANGED, {});
  }

  private log(db: Db, auth: AuthContext, taskId: string, kind: string, data: Prisma.InputJsonObject = {}) {
    return db.taskActivity.create({ data: { organizationId: auth.organizationId, taskId, actorId: auth.userId, kind, data } });
  }

  private async settings(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    return parseOrganizationSettings(org.settings);
  }

  // ───────────────────────────── planning context ─────────────────────────────

  /** Calendar (working days, holidays, approved leave) and every open task of the given people. */
  private async planContext(organizationId: string, userIds: string[]) {
    const s = await this.settings(organizationId);
    const today = localDate(s.attendance.timezone);
    const horizon = addDays(today, 400);
    const ids = [...new Set(userIds)];
    const [holidays, leave, tasks] = await Promise.all([
      this.prisma.holiday.findMany({ where: { organizationId, date: { gte: toDbDate(today), lte: toDbDate(horizon) } }, select: { date: true, type: true } }),
      ids.length
        ? this.prisma.leaveRequest.findMany({
            where: { organizationId, userId: { in: ids }, status: 'APPROVED', halfDay: 'NONE', endDate: { gte: toDbDate(today) }, startDate: { lte: toDbDate(horizon) } },
            select: { userId: true, startDate: true, endDate: true },
          })
        : [],
      ids.length
        ? this.prisma.task.findMany({
            where: { organizationId, assigneeId: { in: ids }, status: { in: OPEN_TASK_STATUSES } },
            select: { id: true, assigneeId: true, size: true, status: true, priority: true, startDate: true, dueDate: true, createdAt: true },
          })
        : [],
    ]);
    const off = new Set<string>();
    const special = new Set<string>();
    for (const h of holidays) {
      if (h.type === 'MANDATORY' || h.type === 'COMPANY') off.add(ymd(h.date)!);
      if (h.type === 'SPECIAL_WORKING_DAY') special.add(ymd(h.date)!);
    }
    const away = new Map<string, Set<string>>();
    for (const l of leave) {
      const set = away.get(l.userId) ?? new Set<string>();
      for (let d = ymd(l.startDate)! < today ? today : ymd(l.startDate)!; d <= ymd(l.endDate)! && d <= horizon; d = addDays(d, 1)) set.add(d);
      away.set(l.userId, set);
    }
    const workingDays = s.attendance.workingDays;
    const cal: PlanCalendar = {
      today,
      isWorkingDay: (d) => special.has(d) || (workingDays.includes(toDbDate(d).getUTCDay()) && !off.has(d)),
      onLeave: (u, d) => away.get(u)?.has(d) ?? false,
    };
    const byUser = new Map<string, PlanTask[]>(ids.map((id) => [id, []]));
    for (const t of tasks) byUser.get(t.assigneeId!)?.push({ ...t, startDate: ymd(t.startDate), dueDate: ymd(t.dueDate) } as PlanTask);
    return { cal, byUser, today, timezone: s.attendance.timezone };
  }

  // ───────────────────────────── serializers ─────────────────────────────

  private taskRef(t: { number: number | null; project: { key: string } | null }) {
    return t.project && t.number ? `${t.project.key}-${t.number}` : null;
  }

  private serializeTask(auth: AuthContext, t: TaskRow, today: string, plan?: { start: string; end: string; late: boolean } | null) {
    const manage = this.canManageTask(auth, t);
    const mine = t.assigneeId === auth.userId;
    const due = ymd(t.dueDate);
    return {
      id: t.id,
      ref: this.taskRef(t),
      title: t.title,
      description: t.description,
      kind: t.kind,
      status: t.status,
      priority: t.priority,
      size: t.size,
      remainingDays: remainingDays(t),
      project: t.project ? { id: t.project.id, key: t.project.key, name: t.project.name, color: t.project.color } : null,
      assignee: toMini(t.assignee),
      createdBy: toMini(t.createdBy),
      startDate: ymd(t.startDate),
      dueDate: due,
      completedAt: t.completedAt,
      position: t.position,
      links: t.links as { label: string; url: string }[],
      commentCount: t._count.comments,
      pendingRequest: t.requests.length > 0,
      overdue: !!due && due < today && isOpen(t.status),
      /** Where the planner expects this to land in its owner's queue (open tasks only). */
      plan: plan ? { start: plan.start, end: plan.end, late: plan.late } : null,
      can: { manage, update: manage || mine, request: mine && isOpen(t.status) && t.requests.length === 0 },
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  private async serializeTasks(auth: AuthContext, rows: TaskRow[]) {
    const owners = rows.filter((t) => t.assigneeId && isOpen(t.status)).map((t) => t.assigneeId!);
    const { cal, byUser, today } = await this.planContext(auth.organizationId, owners);
    const plans = new Map<string, ReturnType<typeof schedule>>();
    for (const [u, list] of byUser) plans.set(u, schedule(u, list, cal));
    return rows.map((t) => this.serializeTask(auth, t, today, t.assigneeId ? plans.get(t.assigneeId)?.slots.get(t.id) : null));
  }

  private serializeProject(auth: AuthContext, p: ProjectRow, counts?: { total: number; done: number; open: number; overdue: number }) {
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      color: p.color,
      status: p.status,
      lead: toMini(p.lead),
      members: p.members.map((m) => toMini(m.user)!),
      startDate: ymd(p.startDate),
      targetDate: ymd(p.targetDate),
      counts: counts ?? { total: 0, done: 0, open: 0, overdue: 0 },
      can: { manage: this.canManageProject(auth, p) },
      createdAt: p.createdAt,
    };
  }

  private serializeRequest(auth: AuthContext, r: RequestRow) {
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      reason: r.reason,
      rationale: r.rationale,
      previousDueDate: ymd(r.previousDueDate),
      proposedDueDate: ymd(r.proposedDueDate),
      proposedAssignee: toMini(r.proposedAssignee),
      requester: toMini(r.requester)!,
      decider: toMini(r.decider),
      decisionNote: r.decisionNote,
      decidedAt: r.decidedAt,
      createdAt: r.createdAt,
      task: {
        id: r.task.id,
        ref: this.taskRef(r.task),
        title: r.task.title,
        size: r.task.size,
        status: r.task.status,
        dueDate: ymd(r.task.dueDate),
        project: r.task.project ? { id: r.task.project.id, key: r.task.project.key, name: r.task.project.name, color: r.task.project.color } : null,
      },
      can: { decide: r.status === 'PENDING' && this.canDecide(auth, r), cancel: r.status === 'PENDING' && r.requesterId === auth.userId },
    };
  }

  // ───────────────────────────── projects ─────────────────────────────

  private async projectCounts(organizationId: string, projectIds: string[], today: string) {
    const out = new Map<string, { total: number; done: number; open: number; overdue: number }>(projectIds.map((id) => [id, { total: 0, done: 0, open: 0, overdue: 0 }]));
    if (!projectIds.length) return out;
    const [byStatus, overdue] = await Promise.all([
      this.prisma.task.groupBy({ by: ['projectId', 'status'], where: { organizationId, projectId: { in: projectIds } }, _count: { _all: true } }),
      this.prisma.task.groupBy({ by: ['projectId'], where: { organizationId, projectId: { in: projectIds }, status: { in: OPEN_TASK_STATUSES }, dueDate: { lt: toDbDate(today) } }, _count: { _all: true } }),
    ]);
    for (const g of byStatus) {
      const c = out.get(g.projectId!)!;
      if (g.status === 'CANCELLED') continue;
      c.total += g._count._all;
      if (g.status === 'DONE') c.done += g._count._all;
      else c.open += g._count._all;
    }
    for (const g of overdue) out.get(g.projectId!)!.overdue = g._count._all;
    return out;
  }

  async listProjects(auth: AuthContext, include: 'active' | 'all') {
    const rows = await this.prisma.project.findMany({
      where: { AND: [this.projectWhere(auth), include === 'active' ? { status: { in: ['ACTIVE', 'ON_HOLD'] } } : {}] },
      include: projectInclude,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      take: 200,
    });
    const s = await this.settings(auth.organizationId);
    const counts = await this.projectCounts(auth.organizationId, rows.map((p) => p.id), localDate(s.attendance.timezone));
    return rows.map((p) => this.serializeProject(auth, p, counts.get(p.id)));
  }

  async getProject(auth: AuthContext, id: string) {
    const p = await this.findProject(auth, id);
    const s = await this.settings(auth.organizationId);
    const counts = await this.projectCounts(auth.organizationId, [p.id], localDate(s.attendance.timezone));
    return this.serializeProject(auth, p, counts.get(p.id));
  }

  async createProject(auth: AuthContext, body: ProjectInput) {
    if (!this.reach(auth)) throw new ForbiddenException('Ask a manager to create the project');
    const leadId = body.leadId ?? auth.userId;
    const memberIds = [...new Set([...body.memberIds, leadId])];
    await this.assertPeople(this.prisma, auth.organizationId, memberIds, 'Choose active colleagues for the project');
    try {
      const p = await this.prisma.project.create({
        data: {
          organizationId: auth.organizationId,
          key: body.key,
          name: body.name,
          description: body.description ?? null,
          color: body.color,
          status: body.status,
          leadId,
          startDate: dbDate(body.startDate) ?? null,
          targetDate: dbDate(body.targetDate) ?? null,
          createdById: auth.userId,
          members: { create: memberIds.map((userId) => ({ userId })) },
        },
        include: projectInclude,
      });
      await this.audit.log(auth, 'project.created', 'project', p.id, { name: p.name, key: p.key });
      await this.notifications.notify({
        organizationId: auth.organizationId,
        userIds: memberIds,
        actorId: auth.userId,
        type: 'work',
        title: `You were added to the project ${p.name}`,
        link: `/app/work/projects/${p.id}`,
      });
      this.broadcast(auth.organizationId);
      return this.serializeProject(auth, p);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Another project already uses that short code');
      throw e;
    }
  }

  async updateProject(auth: AuthContext, id: string, body: UpdateProjectInput) {
    const p = await this.findProject(auth, id);
    if (!this.canManageProject(auth, p)) throw new ForbiddenException('Only the project lead can change the project');
    const start = body.startDate !== undefined ? body.startDate : ymd(p.startDate);
    const target = body.targetDate !== undefined ? body.targetDate : ymd(p.targetDate);
    if (start && target && start > target) throw new BadRequestException('The target date must be on or after the start date');
    const leadId = body.leadId !== undefined ? body.leadId : p.leadId;
    const current = p.members.map((m) => m.user.id);
    let nextMembers: string[] | null = null;
    if (body.memberIds || body.leadId !== undefined) {
      nextMembers = [...new Set([...(body.memberIds ?? current), ...(leadId ? [leadId] : [])])];
      const added = nextMembers.filter((x) => !current.includes(x));
      await this.assertPeople(this.prisma, auth.organizationId, added, 'Choose active colleagues for the project');
      const removed = current.filter((x) => !nextMembers!.includes(x));
      if (removed.length) {
        const busy = await this.prisma.task.findFirst({
          where: { projectId: id, assigneeId: { in: removed }, status: { in: [...OPEN_TASK_STATUSES, 'BACKLOG'] } },
          select: { assignee: { select: mini } },
        });
        if (busy) throw new ConflictException(`${toMini(busy.assignee)!.name} still has open tasks in this project. Give them to someone else first.`);
      }
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (nextMembers) {
        await tx.projectMember.deleteMany({ where: { projectId: id, userId: { notIn: nextMembers } } });
        await tx.projectMember.createMany({ data: nextMembers.map((userId) => ({ projectId: id, userId })), skipDuplicates: true });
      }
      return tx.project.update({
        where: { id },
        data: {
          name: body.name,
          description: body.description,
          color: body.color,
          status: body.status,
          leadId: body.leadId,
          startDate: dbDate(body.startDate),
          targetDate: dbDate(body.targetDate),
        },
        include: projectInclude,
      });
    });
    await this.audit.log(auth, 'project.updated', 'project', id, { fields: Object.keys(body) });
    if (nextMembers) {
      await this.notifications.notify({
        organizationId: auth.organizationId,
        userIds: nextMembers.filter((x) => !current.includes(x)),
        actorId: auth.userId,
        type: 'work',
        title: `You were added to the project ${updated.name}`,
        link: `/app/work/projects/${id}`,
      });
    }
    this.broadcast(auth.organizationId);
    return this.getProject(auth, id);
  }

  /** Only an empty project can be deleted; a project with tasks is archived instead so history is kept. */
  async deleteProject(auth: AuthContext, id: string) {
    const p = await this.findProject(auth, id);
    if (!this.canManageProject(auth, p)) throw new ForbiddenException('Only the project lead can delete the project');
    const tasks = await this.prisma.task.count({ where: { projectId: id } });
    if (tasks) throw new ConflictException('This project has tasks. Archive it instead to keep its history.');
    await this.prisma.project.delete({ where: { id } });
    await this.audit.log(auth, 'project.deleted', 'project', id, { name: p.name, key: p.key });
    this.broadcast(auth.organizationId);
    return { ok: true };
  }

  // ───────────────────────────── tasks ─────────────────────────────

  async listTasks(auth: AuthContext, q: TaskListQuery) {
    const and: Prisma.TaskWhereInput[] = [this.taskWhere(auth)];
    if (q.scope === 'mine') and.push({ assigneeId: auth.userId });
    if (q.scope === 'team') and.push({ assignee: { managerId: auth.userId } });
    if (q.projectId) and.push({ projectId: q.projectId });
    if (q.assigneeId) and.push({ assigneeId: q.assigneeId === 'none' ? null : q.assigneeId });
    if (q.status === 'OPEN') and.push({ status: { in: [...OPEN_TASK_STATUSES, 'BACKLOG'] } });
    else if (q.status !== 'ALL') and.push({ status: q.status });
    if (q.q) and.push({ title: { contains: q.q, mode: 'insensitive' } });
    const rows = await this.prisma.task.findMany({ where: { AND: and }, include: taskInclude, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], take: 500 });
    return this.serializeTasks(auth, rows);
  }

  async getTask(auth: AuthContext, id: string) {
    const t = await this.findTask(auth, id);
    const [serialized] = await this.serializeTasks(auth, [t]);
    const [comments, activity, requests] = await Promise.all([
      this.prisma.taskComment.findMany({ where: { taskId: id }, include: { author: { select: mini } }, orderBy: { createdAt: 'asc' }, take: 200 }),
      this.prisma.taskActivity.findMany({ where: { taskId: id }, include: { actor: { select: mini } }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.workRequest.findMany({ where: { taskId: id }, include: requestInclude, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    return {
      ...serialized!,
      comments: comments.map((c) => ({ id: c.id, body: c.body, author: toMini(c.author), createdAt: c.createdAt })),
      activity: activity.map((a) => ({ id: a.id, kind: a.kind, data: a.data as Record<string, unknown>, actor: toMini(a.actor), createdAt: a.createdAt })),
      requests: requests.map((r) => this.serializeRequest(auth, r)),
    };
  }

  async createTask(auth: AuthContext, body: TaskInput) {
    let project: { id: string; leadId: string | null; status: string; name: string } | null = null;
    if (body.projectId) {
      const p = await this.findProject(auth, body.projectId);
      if (p.status === 'ARCHIVED' || p.status === 'COMPLETED') throw new ConflictException('This project is closed. Reopen it to add tasks.');
      project = p;
    }
    // A personal task belongs to whoever writes it down unless they name someone else.
    const assigneeId = body.assigneeId === undefined ? (project ? null : auth.userId) : body.assigneeId;
    await this.assertAssignable(this.prisma, auth, project, assigneeId);
    const created = await this.prisma.$transaction(async (tx) => {
      const number = project ? (await tx.project.update({ where: { id: project.id }, data: { taskSeq: { increment: 1 } }, select: { taskSeq: true } })).taskSeq : null;
      const t = await tx.task.create({
        data: {
          organizationId: auth.organizationId,
          projectId: project?.id ?? null,
          number,
          title: body.title,
          description: body.description ?? null,
          kind: body.kind,
          status: body.status,
          priority: body.priority,
          size: body.size,
          assigneeId,
          createdById: auth.userId,
          startDate: dbDate(body.startDate) ?? null,
          dueDate: dbDate(body.dueDate) ?? null,
          completedAt: body.status === 'DONE' ? new Date() : null,
          position: Date.now() / 1000,
          links: body.links,
        },
        include: taskInclude,
      });
      await this.log(tx, auth, t.id, 'created', { status: t.status, ...(assigneeId ? { assigneeId } : {}) });
      return t;
    });
    if (assigneeId) await this.notifyAssigned(auth, created);
    this.broadcast(auth.organizationId);
    const [out] = await this.serializeTasks(auth, [created]);
    return out!;
  }

  private notifyAssigned(auth: AuthContext, t: TaskRow) {
    const ref = this.taskRef(t);
    return this.notifications.notify({
      organizationId: auth.organizationId,
      userIds: [t.assigneeId!],
      actorId: auth.userId,
      type: 'work',
      title: `New task for you: ${t.title}`,
      body: [ref, t.dueDate ? `Due ${dayLabel(ymd(t.dueDate)!)}` : null].filter(Boolean).join(' · ') || null,
      link: `/app/work?task=${t.id}`,
    });
  }

  async updateTask(auth: AuthContext, id: string, body: UpdateTaskInput) {
    const t = await this.findTask(auth, id);
    const manage = this.canManageTask(auth, t);
    if (!manage) {
      if (t.assigneeId !== auth.userId) throw new ForbiddenException('Only the owner of this task or its lead can change it');
      // The owner keeps their work up to date; scope, dates and ownership stay with whoever planned it.
      const own = new Set(['status', 'description', 'links', 'position', 'startDate']);
      const blocked = Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] !== undefined && !own.has(k));
      if (blocked.includes('dueDate')) throw new ForbiddenException('Your lead set this date. Use "Ask for more time" to request a new one.');
      if (blocked.includes('assigneeId')) throw new ForbiddenException('Use "Ask for more time" to ask for someone else to take this task.');
      if (blocked.length) throw new ForbiddenException('Only the lead for this task can change that');
    }
    const start = body.startDate !== undefined ? body.startDate : ymd(t.startDate);
    const due = body.dueDate !== undefined ? body.dueDate : ymd(t.dueDate);
    if (start && due && start > due) throw new BadRequestException('The due date must be on or after the start date');
    const assigneeChanged = body.assigneeId !== undefined && body.assigneeId !== t.assigneeId;
    if (assigneeChanged) await this.assertAssignable(this.prisma, auth, t.project ? { id: t.project.id, leadId: t.project.leadId } : null, body.assigneeId ?? null);

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.task.update({
        where: { id },
        data: {
          title: body.title,
          description: body.description,
          kind: body.kind,
          status: body.status,
          priority: body.priority,
          size: body.size,
          assigneeId: body.assigneeId,
          startDate: dbDate(body.startDate),
          dueDate: dbDate(body.dueDate),
          links: body.links,
          position: body.position,
          ...(body.status && body.status !== t.status ? { completedAt: body.status === 'DONE' ? new Date() : null } : {}),
        },
        include: taskInclude,
      });
      if (body.status && body.status !== t.status) await this.log(tx, auth, id, 'status', { from: t.status, to: body.status });
      if (assigneeChanged) await this.log(tx, auth, id, 'assignee', { from: t.assigneeId, to: body.assigneeId ?? null });
      if (body.dueDate !== undefined && body.dueDate !== ymd(t.dueDate)) await this.log(tx, auth, id, 'due', { from: ymd(t.dueDate), to: body.dueDate });
      if (body.size && body.size !== t.size) await this.log(tx, auth, id, 'size', { from: t.size, to: body.size });
      if (body.priority && body.priority !== t.priority) await this.log(tx, auth, id, 'priority', { from: t.priority, to: body.priority });
      // A pending request no longer applies once the task is closed or already changed the way it asked.
      if ((body.status && !isOpen(body.status)) || assigneeChanged) {
        await tx.workRequest.updateMany({ where: { taskId: id, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date() } });
      }
      return u;
    });

    if (assigneeChanged && updated.assigneeId) await this.notifyAssigned(auth, updated);
    if (assigneeChanged && t.assigneeId) {
      await this.notifications.notify({ organizationId: auth.organizationId, userIds: [t.assigneeId], actorId: auth.userId, type: 'work', title: `No longer yours: ${t.title}`, body: updated.assignee ? `Now with ${toMini(updated.assignee)!.name}` : 'Now unassigned', link: `/app/work?task=${id}` });
    }
    if (!assigneeChanged && updated.assigneeId && body.dueDate !== undefined && body.dueDate !== ymd(t.dueDate)) {
      await this.notifications.notify({ organizationId: auth.organizationId, userIds: [updated.assigneeId], actorId: auth.userId, type: 'work', title: `Due date changed: ${t.title}`, body: body.dueDate ? `Now due ${dayLabel(body.dueDate)}` : 'No due date now', link: `/app/work?task=${id}` });
    }
    if (body.status && body.status !== t.status && (body.status === 'DONE' || body.status === 'IN_REVIEW')) {
      await this.notifications.notify({
        organizationId: auth.organizationId,
        userIds: [t.createdById, t.project?.leadId].filter((x): x is string => !!x),
        actorId: auth.userId,
        type: 'work',
        title: `${TASK_STATUS_LABELS[body.status as TaskStatus]}: ${t.title}`,
        link: `/app/work?task=${id}`,
        groupKey: `task:${id}:status`,
      });
    }
    this.broadcast(auth.organizationId);
    const [out] = await this.serializeTasks(auth, [updated]);
    return out!;
  }

  async deleteTask(auth: AuthContext, id: string) {
    const t = await this.findTask(auth, id);
    if (!this.canManageTask(auth, t)) throw new ForbiddenException('Only the lead for this task can delete it');
    await this.prisma.task.delete({ where: { id } });
    await this.audit.log(auth, 'task.deleted', 'task', id, { title: t.title, ref: this.taskRef(t) });
    this.broadcast(auth.organizationId);
    return { ok: true };
  }

  async addComment(auth: AuthContext, id: string, body: string) {
    const t = await this.findTask(auth, id);
    const c = await this.prisma.taskComment.create({ data: { organizationId: auth.organizationId, taskId: id, authorId: auth.userId, body }, include: { author: { select: mini } } });
    await this.notifications.notify({
      organizationId: auth.organizationId,
      userIds: [t.assigneeId, t.createdById].filter((x): x is string => !!x),
      actorId: auth.userId,
      type: 'work',
      title: `New comment on ${t.title}`,
      body,
      link: `/app/work?task=${id}`,
      groupKey: `task:${id}:comments`,
    });
    this.broadcast(auth.organizationId);
    return { id: c.id, body: c.body, author: toMini(c.author), createdAt: c.createdAt };
  }

  // ───────────────────────────── "I need more time" ─────────────────────────────

  /** People who could take a task: the project's people, or the owner's teammates for a personal task. */
  private async reliefPool(organizationId: string, t: { projectId: string | null; assigneeId: string | null; assignee: { managerId: string | null } | null }) {
    const where: Prisma.UserWhereInput = t.projectId
      ? { OR: [{ projectMemberships: { some: { projectId: t.projectId } } }, { projectsLed: { some: { id: t.projectId } } }] }
      : t.assignee?.managerId
        ? { managerId: t.assignee.managerId }
        : { id: '-' };
    return this.prisma.user.findMany({ where: { AND: [where, { organizationId, ...ACTIVE_INTERNAL, id: { not: t.assigneeId ?? '-' } }] }, select: mini, take: 60 });
  }

  /** Who decides on a request: the project lead, else the requester's manager, else company-wide planners. */
  private async approversFor(organizationId: string, t: { project: { leadId: string | null } | null }, requesterId: string) {
    const requester = await this.prisma.user.findUniqueOrThrow({ where: { id: requesterId }, select: { managerId: true } });
    const ids = [t.project?.leadId, requester.managerId].filter((x): x is string => !!x && x !== requesterId);
    const active = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids }, organizationId, status: 'ACTIVE' }, select: mini }) : [];
    const ordered = ids.map((id) => active.find((u) => u.id === id)).filter((u): u is MiniRow => !!u);
    if (ordered.length) return [ordered[0]!];
    const planners = await usersWithLegacyPermission(this.prisma, organizationId, PERMISSIONS.WORK_MANAGE_ALL, requesterId);
    return planners.length ? this.prisma.user.findMany({ where: { id: { in: planners } }, select: mini, take: 10 }) : [];
  }

  /** What the planner can offer for one task: a realistic date, and colleagues who could take it. */
  async relief(auth: AuthContext, id: string) {
    const t = await this.findTask(auth, id);
    if (t.assigneeId !== auth.userId && !this.canManageTask(auth, t)) throw new ForbiddenException('Only the owner of this task can ask for help with it');
    const pool = await this.reliefPool(auth.organizationId, t);
    const { cal, byUser } = await this.planContext(auth.organizationId, [...pool.map((p) => p.id), ...(t.assigneeId ? [t.assigneeId] : [])]);
    const mine = t.assigneeId ? (byUser.get(t.assigneeId) ?? []) : [];
    const slot = t.assigneeId ? schedule(t.assigneeId, mine, cal).slots.get(t.id) : undefined;
    const planTask: PlanTask = { id: t.id, assigneeId: t.assigneeId, size: t.size, status: t.status, priority: t.priority, startDate: ymd(t.startDate), dueDate: ymd(t.dueDate), createdAt: t.createdAt };
    const candidates = candidatesFor(planTask, pool.map((p) => p.id), byUser, cal).slice(0, 5);
    const approvers = await this.approversFor(auth.organizationId, t, t.assigneeId ?? auth.userId);
    return {
      dueDate: ymd(t.dueDate),
      remainingDays: remainingDays(t),
      load: t.assigneeId ? loadOf(t.assigneeId, mine, cal) : null,
      windowEnd: windowEnd(cal),
      /** When the owner's queue reaches the end of this task. Later than the due date means it cannot be met as things stand. */
      expectedEnd: slot?.end ?? null,
      late: slot?.late ?? false,
      candidates: candidates.map((c) => ({ ...c, person: toMini(pool.find((p) => p.id === c.userId)!)! })),
      approvers: approvers.map((a) => toMini(a)!),
    };
  }

  async createRequest(auth: AuthContext, id: string, body: WorkRequestInput) {
    const t = await this.findTask(auth, id);
    if (t.assigneeId !== auth.userId) throw new ForbiddenException('Only the owner of this task can ask for more time');
    if (!isOpen(t.status)) throw new ConflictException('This task is not in progress any more');
    const s = await this.settings(auth.organizationId);
    const today = localDate(s.attendance.timezone);
    const due = ymd(t.dueDate);
    let proposedAssigneeId: string | null = null;
    if (body.kind === 'MOVE_DATE') {
      if (body.proposedDueDate! < today) throw new BadRequestException('Choose a date from today onwards');
      if (due && body.proposedDueDate! <= due) throw new BadRequestException('Choose a date after the current due date');
    } else if (body.proposedAssigneeId) {
      const pool = await this.reliefPool(auth.organizationId, t);
      if (!pool.some((p) => p.id === body.proposedAssigneeId)) throw new BadRequestException(t.projectId ? 'Choose someone on this project' : 'Choose someone on your team');
      proposedAssigneeId = body.proposedAssigneeId;
    }
    const approvers = await this.approversFor(auth.organizationId, t, auth.userId);
    if (!approvers.length) throw new ConflictException('There is nobody who can decide on this yet. Ask an admin to set your manager or a project lead.');

    // What the plan says, written down for whoever decides.
    const { cal, byUser } = await this.planContext(auth.organizationId, [auth.userId, ...(proposedAssigneeId ? [proposedAssigneeId] : [])]);
    const mine = byUser.get(auth.userId) ?? [];
    const load = loadOf(auth.userId, mine, cal);
    const slot = schedule(auth.userId, mine, cal).slots.get(t.id);
    const parts = [`${days(load.demandDays)} of work due in the next two weeks, ${days(load.availableDays)} available.`];
    if (slot) parts.push(slot.late && due ? `At the current pace this task finishes around ${dayLabel(slot.end)}, after its due date of ${dayLabel(due)}.` : `At the current pace this task finishes around ${dayLabel(slot.end)}.`);
    if (proposedAssigneeId) {
      const c = candidatesFor({ id: t.id, assigneeId: t.assigneeId, size: t.size, status: t.status, priority: t.priority, startDate: ymd(t.startDate), dueDate: due, createdAt: t.createdAt }, [proposedAssigneeId], byUser, cal)[0];
      if (c) parts.push(`The suggested new owner is at ${c.pct}% now and could finish it by ${dayLabel(c.finishBy)}.`);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // One open request per task: serialise on the task so two clicks can't create two.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-request:${id}`}))`;
      if (await tx.workRequest.count({ where: { taskId: id, status: 'PENDING' } })) throw new ConflictException('A request for this task is already waiting for a decision');
      const r = await tx.workRequest.create({
        data: {
          organizationId: auth.organizationId,
          taskId: id,
          requesterId: auth.userId,
          kind: body.kind,
          reason: body.reason,
          previousDueDate: t.dueDate,
          proposedDueDate: body.kind === 'MOVE_DATE' ? toDbDate(body.proposedDueDate!) : null,
          proposedAssigneeId,
          rationale: parts.join(' '),
        },
        include: requestInclude,
      });
      await this.log(tx, auth, id, 'request', { kind: body.kind, ...(body.kind === 'MOVE_DATE' ? { to: body.proposedDueDate! } : {}) });
      return r;
    });
    await this.notifications.notify({
      organizationId: auth.organizationId,
      userIds: approvers.map((a) => a.id),
      actorId: auth.userId,
      type: 'work',
      title: body.kind === 'MOVE_DATE' ? `${toMini(created.requester)!.name} asks for more time` : `${toMini(created.requester)!.name} asks to hand over a task`,
      body: `${t.title}: ${body.reason}`,
      link: '/app/approvals?tab=work',
    });
    this.broadcast(auth.organizationId);
    return this.serializeRequest(auth, created);
  }

  private canDecide(auth: AuthContext, r: { requesterId: string; requester: { managerId: string | null }; task: { project: { leadId: string | null } | null } }) {
    if (r.requesterId === auth.userId) return false;
    const reach = this.reach(auth);
    if (reach === 'ORG' || r.task.project?.leadId === auth.userId) return true;
    return reach === 'TEAM' && r.requester.managerId === auth.userId;
  }

  /** Requests the caller may decide on. Never their own. */
  deciderWhere(auth: AuthContext): Prisma.WorkRequestWhereInput {
    const base = { organizationId: auth.organizationId, NOT: { requesterId: auth.userId } };
    const reach = this.reach(auth);
    if (reach === 'ORG') return base;
    return { ...base, OR: [{ task: { project: { leadId: auth.userId } } }, ...(reach === 'TEAM' ? [{ requester: { managerId: auth.userId } }] : [])] };
  }

  async listRequests(auth: AuthContext, scope: 'mine' | 'approvals', status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'ALL') {
    const where: Prisma.WorkRequestWhereInput = scope === 'mine' ? { organizationId: auth.organizationId, requesterId: auth.userId } : this.deciderWhere(auth);
    const rows = await this.prisma.workRequest.findMany({ where: { AND: [where, status === 'ALL' ? {} : { status }] }, include: requestInclude, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((r) => this.serializeRequest(auth, r));
  }

  async decideRequest(auth: AuthContext, id: string, decision: 'APPROVED' | 'REJECTED', note?: string | null, assigneeId?: string | null) {
    const r = await this.prisma.workRequest.findFirst({ where: { id, organizationId: auth.organizationId }, include: requestInclude });
    // 404 unless the caller could see it: their own request, or one they may decide on.
    if (!r || (r.requesterId !== auth.userId && !this.canDecide(auth, r))) throw new NotFoundException('Request not found');
    if (r.requesterId === auth.userId) throw new ForbiddenException('You cannot decide on your own request');
    if (r.status !== 'PENDING') throw new ConflictException('This request was already decided');
    const approve = decision === 'APPROVED';
    const newOwner = r.kind === 'REASSIGN' && approve ? (assigneeId ?? r.proposedAssigneeId) : null;
    if (approve) {
      if (!isOpen(r.task.status)) throw new ConflictException('This task is not in progress any more');
      if (r.kind === 'REASSIGN') {
        if (!newOwner) throw new BadRequestException('Choose who takes this task');
        if (newOwner === r.requesterId) throw new BadRequestException('Choose someone other than the person asking');
        const pool = await this.reliefPool(auth.organizationId, { projectId: r.task.projectId, assigneeId: r.requesterId, assignee: { managerId: r.requester.managerId } });
        // A company-wide planner may hand a personal task to anyone active; otherwise the usual pool applies.
        const ok = pool.some((p) => p.id === newOwner) || (!r.task.projectId && this.reach(auth) === 'ORG' && (await this.prisma.user.count({ where: { id: newOwner, organizationId: auth.organizationId, ...ACTIVE_INTERNAL } })) > 0);
        if (!ok) throw new BadRequestException(r.task.projectId ? 'Choose someone on this project' : 'Choose someone on their team');
      }
    }
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.workRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: approve ? 'APPROVED' : 'DECLINED', deciderId: auth.userId, decisionNote: note ?? null, decidedAt: new Date(), ...(newOwner ? { proposedAssigneeId: newOwner } : {}) },
      });
      if (!claimed.count) throw new ConflictException('This request was already decided');
      if (approve && r.kind === 'MOVE_DATE') {
        await tx.task.update({ where: { id: r.taskId }, data: { dueDate: r.proposedDueDate } });
        await this.log(tx, auth, r.taskId, 'due', { from: ymd(r.task.dueDate), to: ymd(r.proposedDueDate), requested: true });
      }
      if (approve && r.kind === 'REASSIGN') {
        await tx.task.update({ where: { id: r.taskId }, data: { assigneeId: newOwner } });
        await this.log(tx, auth, r.taskId, 'assignee', { from: r.requesterId, to: newOwner, requested: true });
      }
      await this.log(tx, auth, r.taskId, 'request_decided', { decision: approve ? 'APPROVED' : 'DECLINED' });
    });
    await this.audit.log(auth, approve ? 'work_request.approved' : 'work_request.declined', 'work_request', id, { taskId: r.taskId, kind: r.kind });
    await this.notifications.notify({
      organizationId: auth.organizationId,
      userIds: [r.requesterId],
      actorId: auth.userId,
      type: 'work',
      title: approve ? (r.kind === 'MOVE_DATE' ? `More time approved: ${r.task.title}` : `Handover approved: ${r.task.title}`) : `Request declined: ${r.task.title}`,
      body: note || (approve && r.kind === 'MOVE_DATE' ? `Now due ${dayLabel(ymd(r.proposedDueDate)!)}` : null),
      link: `/app/work?task=${r.taskId}`,
    });
    if (newOwner) {
      await this.notifications.notify({ organizationId: auth.organizationId, userIds: [newOwner], actorId: auth.userId, type: 'work', title: `New task for you: ${r.task.title}`, body: `Handed over from ${toMini(r.requester)!.name}`, link: `/app/work?task=${r.taskId}` });
    }
    this.broadcast(auth.organizationId);
    const fresh = await this.prisma.workRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
    return this.serializeRequest(auth, fresh);
  }

  async cancelRequest(auth: AuthContext, id: string) {
    const r = await this.prisma.workRequest.findFirst({ where: { id, organizationId: auth.organizationId, requesterId: auth.userId } });
    if (!r) throw new NotFoundException('Request not found');
    const done = await this.prisma.workRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date() } });
    if (!done.count) throw new ConflictException('This request was already decided');
    this.broadcast(auth.organizationId);
    return { ok: true };
  }

  // ───────────────────────────── workload, suggestions, report ─────────────────────────────

  /** People whose work the caller plans: everyone (ORG), direct reports (TEAM), and the people on projects they lead. Always includes the caller. */
  private async plannedPeople(auth: AuthContext, projectId?: string) {
    const reach = this.reach(auth);
    const me = auth.userId;
    const onProject = (id: string): Prisma.UserWhereInput => ({ OR: [{ projectMemberships: { some: { projectId: id } } }, { projectsLed: { some: { id } } }] });
    const or: Prisma.UserWhereInput[] = [{ id: me }, { projectMemberships: { some: { project: { leadId: me } } } }];
    if (reach === 'TEAM') or.push({ managerId: me });
    const mineWhere: Prisma.UserWhereInput = reach === 'ORG' ? {} : { OR: or };
    if (projectId) await this.findProject(auth, projectId);
    const people = await this.prisma.user.findMany({
      where: { AND: [{ organizationId: auth.organizationId, ...ACTIVE_INTERNAL }, mineWhere, projectId ? onProject(projectId) : {}] },
      select: { ...mini, managerId: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 300,
    });
    const leads = reach ? true : (await this.prisma.project.count({ where: { organizationId: auth.organizationId, leadId: me } })) > 0;
    return { people, canPlan: leads };
  }

  /** The caller's own numbers, and whether they plan other people's work (drives which tabs the app shows). */
  async summary(auth: AuthContext) {
    const { cal, byUser, today } = await this.planContext(auth.organizationId, [auth.userId]);
    const mine = byUser.get(auth.userId) ?? [];
    const weekEnd = addDays(today, 6);
    const [leads, pendingMine, toDecide] = await Promise.all([
      this.prisma.project.count({ where: { organizationId: auth.organizationId, leadId: auth.userId } }),
      this.prisma.workRequest.count({ where: { organizationId: auth.organizationId, requesterId: auth.userId, status: 'PENDING' } }),
      this.prisma.workRequest.count({ where: { AND: [this.deciderWhere(auth), { status: 'PENDING' }] } }),
    ]);
    const reach = this.reach(auth);
    return {
      today,
      windowEnd: windowEnd(cal),
      load: loadOf(auth.userId, mine, cal),
      counts: {
        open: mine.length,
        overdue: mine.filter((t) => t.dueDate && t.dueDate < today).length,
        dueToday: mine.filter((t) => t.dueDate === today).length,
        dueThisWeek: mine.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd).length,
        pendingRequests: pendingMine,
        toDecide,
      },
      can: { createProject: !!reach, plan: !!reach || leads > 0, reach },
    };
  }

  async workload(auth: AuthContext, projectId?: string) {
    const { people, canPlan } = await this.plannedPeople(auth, projectId);
    if (!canPlan) throw new ForbiddenException('Team workload is for managers and project leads');
    const ids = people.map((p) => p.id);
    const { cal, byUser, today } = await this.planContext(auth.organizationId, ids);
    // Full rows for the open tasks, to show them and to know which ones the caller may move.
    const rows = await this.prisma.task.findMany({ where: { organizationId: auth.organizationId, assigneeId: { in: ids }, status: { in: OPEN_TASK_STATUSES } }, include: taskInclude });
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const members = await this.prisma.projectMember.findMany({ where: { project: { organizationId: auth.organizationId }, userId: { in: ids } }, select: { projectId: true, userId: true } });
    const projectPeople = new Map<string, string[]>();
    for (const m of members) projectPeople.set(m.projectId, [...(projectPeople.get(m.projectId) ?? []), m.userId]);
    const byManager = new Map<string, string[]>();
    for (const p of people) if (p.managerId) byManager.set(p.managerId, [...(byManager.get(p.managerId) ?? []), p.id]);
    const managerOf = new Map(people.map((p) => [p.id, p.managerId]));

    const all = [...byUser.values()].flat();
    const raw = suggest(ids, all, cal, (t) => {
      const row = rowById.get(t.id);
      if (!row || !this.canManageTask(auth, row)) return [];
      if (row.projectId) return projectPeople.get(row.projectId) ?? [];
      const mgr = t.assigneeId ? managerOf.get(t.assigneeId) : null;
      return mgr ? (byManager.get(mgr) ?? []) : [];
    }).filter((s) => {
      const row = rowById.get(s.taskId);
      return !!row && this.canManageTask(auth, row);
    });
    const person = (id: string) => toMini(people.find((p) => p.id === id)!)!;
    const visible = new Set((await this.prisma.task.findMany({ where: { AND: [this.taskWhere(auth), { id: { in: rows.map((r) => r.id) } }] }, select: { id: true } })).map((t) => t.id));

    return {
      today,
      windowEnd: windowEnd(cal),
      people: people.map((p) => {
        const list = byUser.get(p.id) ?? [];
        const plan = schedule(p.id, list, cal);
        return {
          person: toMini(p)!,
          load: loadOf(p.id, list, cal),
          tasks: [...list].sort(queueOrder).map((t) => {
            const row = rowById.get(t.id)!;
            const slot = plan.slots.get(t.id) ?? null;
            // Work from projects the caller cannot see still takes this person's time, so it is shown without its details.
            return visible.has(t.id)
              ? { id: t.id, hidden: false as const, ref: this.taskRef(row), title: row.title, size: t.size, status: t.status, priority: t.priority, dueDate: t.dueDate, remainingDays: remainingDays(t), project: row.project ? { id: row.project.id, key: row.project.key, name: row.project.name, color: row.project.color } : null, plan: slot }
              : { id: t.id, hidden: true as const, ref: null, title: 'Other work', size: t.size, status: t.status, priority: t.priority, dueDate: t.dueDate, remainingDays: remainingDays(t), project: null, plan: slot };
          }),
        };
      }),
      suggestions: raw.map((s) => {
        const row = rowById.get(s.taskId)!;
        return { ...s, task: { id: row.id, ref: this.taskRef(row), title: row.title, size: row.size, dueDate: ymd(row.dueDate) }, from: person(s.fromUserId), to: s.toUserId ? person(s.toUserId) : null };
      }),
    };
  }

  /** What happened on one day and where things stand now, for the people the caller plans (or just the caller). */
  async report(auth: AuthContext, date?: string) {
    const { people } = await this.plannedPeople(auth);
    const ids = people.map((p) => p.id);
    const { cal, byUser, today, timezone } = await this.planContext(auth.organizationId, ids);
    const day = date ?? today;
    if (day > today) throw new BadRequestException('Choose today or an earlier day');
    const from = localToUtc(day, '00:00', timezone);
    const to = localToUtc(addDays(day, 1), '00:00', timezone);
    const visible = this.taskWhere(auth);
    const [activity, created, pending] = await Promise.all([
      this.prisma.taskActivity.findMany({
        where: { organizationId: auth.organizationId, kind: 'status', createdAt: { gte: from, lt: to }, task: { AND: [visible, { assigneeId: { in: ids } }] } },
        include: { task: { include: { project: { select: { key: true } } } } },
        orderBy: { createdAt: 'asc' },
        take: 500,
      }),
      this.prisma.task.count({ where: { AND: [visible, { createdAt: { gte: from, lt: to } }] } }),
      this.prisma.workRequest.count({ where: { AND: [this.deciderWhere(auth), { status: 'PENDING' }] } }),
    ]);
    const line = (t: { id: string; title: string; number: number | null; project: { key: string } | null; assigneeId: string | null }) => ({ id: t.id, ref: this.taskRef(t), title: t.title, assigneeId: t.assigneeId });
    // The last status change of the day decides where a task is counted.
    const last = new Map<string, (typeof activity)[number]>();
    for (const a of activity) last.set(a.taskId, a);
    const done = [...last.values()].filter((a) => (a.data as { to?: string }).to === 'DONE').map((a) => line(a.task));
    const started = [...last.values()].filter((a) => (a.data as { to?: string }).to === 'IN_PROGRESS').map((a) => line(a.task));

    const openRows = await this.prisma.task.findMany({ where: { AND: [visible, { assigneeId: { in: ids }, status: { in: OPEN_TASK_STATUSES } }] }, include: { project: { select: { key: true } } } });
    const plans = new Map(ids.map((id) => [id, schedule(id, byUser.get(id) ?? [], cal)]));
    const overdue = openRows.filter((t) => t.dueDate && ymd(t.dueDate)! < today).map(line);
    const atRisk = openRows.filter((t) => t.dueDate && ymd(t.dueDate)! >= today && plans.get(t.assigneeId!)?.slots.get(t.id)?.late).map(line);
    const unassigned = await this.prisma.task.count({ where: { AND: [visible, { assigneeId: null, status: { in: OPEN_TASK_STATUSES } }] } });

    return {
      date: day,
      today,
      totals: { done: done.length, started: started.length, created, overdue: overdue.length, atRisk: atRisk.length, unassigned, waitingForDecision: pending },
      done,
      started,
      overdue,
      atRisk,
      people: people
        .map((p) => {
          const load = loadOf(p.id, byUser.get(p.id) ?? [], cal);
          return {
            person: toMini(p)!,
            done: done.filter((t) => t.assigneeId === p.id).length,
            started: started.filter((t) => t.assigneeId === p.id).length,
            open: load.openTasks,
            overdue: overdue.filter((t) => t.assigneeId === p.id).length,
            pct: load.pct,
            level: load.level,
          };
        })
        .filter((p) => p.open || p.done || p.started),
    };
  }
}
