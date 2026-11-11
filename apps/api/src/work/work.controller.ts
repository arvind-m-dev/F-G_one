import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  isCalendarDate, projectSchema, taskCommentSchema, taskListSchema, taskSchema, updateProjectSchema, updateTaskSchema, workDecisionSchema, workRequestListSchema, workRequestSchema,
  type ProjectInput, type TaskInput, type TaskListQuery, type UpdateProjectInput, type UpdateTaskInput, type WorkRequestInput,
} from '@fg/shared';
import { z } from 'zod';
import { Auth, AuthContext } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { WorkService } from './work.service';

const projectsQuery = z.object({ include: z.enum(['active', 'all']).default('active') });
const workloadQuery = z.object({ projectId: z.string().max(40).optional() });
const reportQuery = z.object({ date: z.string().refine(isCalendarDate, 'Use YYYY-MM-DD').optional() });

/**
 * Work: projects, tasks, timeline requests, workload and the daily report.
 * Everyone signed in may use it; what each person sees and may change is decided in WorkService
 * (own tasks, project membership, direct reports, or the "Plan and assign work" permission).
 */
@Controller('work')
export class WorkController {
  constructor(private readonly work: WorkService) {}

  @Get('summary')
  summary(@Auth() auth: AuthContext) {
    return this.work.summary(auth);
  }

  // ───── projects ─────
  @Get('projects')
  projects(@Auth() auth: AuthContext, @Query(new ZodPipe(projectsQuery)) q: z.infer<typeof projectsQuery>) {
    return this.work.listProjects(auth, q.include);
  }

  @Post('projects')
  createProject(@Auth() auth: AuthContext, @Body(new ZodPipe(projectSchema)) body: ProjectInput) {
    return this.work.createProject(auth, body);
  }

  @Get('projects/:id')
  project(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.work.getProject(auth, id);
  }

  @Patch('projects/:id')
  updateProject(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(updateProjectSchema)) body: UpdateProjectInput) {
    return this.work.updateProject(auth, id, body);
  }

  @Delete('projects/:id')
  deleteProject(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.work.deleteProject(auth, id);
  }

  // ───── tasks ─────
  @Get('tasks')
  tasks(@Auth() auth: AuthContext, @Query(new ZodPipe(taskListSchema)) q: TaskListQuery) {
    return this.work.listTasks(auth, q);
  }

  @Post('tasks')
  createTask(@Auth() auth: AuthContext, @Body(new ZodPipe(taskSchema)) body: TaskInput) {
    return this.work.createTask(auth, body);
  }

  @Get('tasks/:id')
  task(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.work.getTask(auth, id);
  }

  @Patch('tasks/:id')
  updateTask(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(updateTaskSchema)) body: UpdateTaskInput) {
    return this.work.updateTask(auth, id, body);
  }

  @Delete('tasks/:id')
  deleteTask(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.work.deleteTask(auth, id);
  }

  @Post('tasks/:id/comments')
  comment(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(taskCommentSchema)) body: z.infer<typeof taskCommentSchema>) {
    return this.work.addComment(auth, id, body.body);
  }

  // ───── "I need more time" ─────
  /** What the planner can offer for this task: a realistic date and colleagues with room. */
  @Get('tasks/:id/relief')
  relief(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.work.relief(auth, id);
  }

  @Post('tasks/:id/requests')
  createRequest(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(workRequestSchema)) body: WorkRequestInput) {
    return this.work.createRequest(auth, id, body);
  }

  @Get('requests')
  requests(@Auth() auth: AuthContext, @Query(new ZodPipe(workRequestListSchema)) q: z.infer<typeof workRequestListSchema>) {
    return this.work.listRequests(auth, q.scope, q.status);
  }

  @Post('requests/:id/decision')
  @HttpCode(200)
  decide(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(workDecisionSchema)) body: z.infer<typeof workDecisionSchema>) {
    return this.work.decideRequest(auth, id, body.decision, body.note, body.assigneeId);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancelRequest(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.work.cancelRequest(auth, id);
  }

  // ───── planning ─────
  /** Each person's load for the next two weeks, with proposals to even it out. Managers and project leads. */
  @Get('workload')
  workload(@Auth() auth: AuthContext, @Query(new ZodPipe(workloadQuery)) q: z.infer<typeof workloadQuery>) {
    return this.work.workload(auth, q.projectId);
  }

  /** What was finished and started on a day, and what is overdue or at risk now. */
  @Get('report')
  report(@Auth() auth: AuthContext, @Query(new ZodPipe(reportQuery)) q: z.infer<typeof reportQuery>) {
    return this.work.report(auth, q.date);
  }
}
