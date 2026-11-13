import { candidatesFor, loadOf, remainingDays, schedule, suggest, windowEnd, type PlanCalendar, type PlanTask } from './planner';

// 2026-11-09 is a Monday.
const cal = (leave: Record<string, string[]> = {}, holidays: string[] = []): PlanCalendar => ({
  today: '2026-11-09',
  isWorkingDay: (d) => {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    return wd >= 1 && wd <= 5 && !holidays.includes(d);
  },
  onLeave: (u, d) => (leave[u] ?? []).includes(d),
});
let seq = 0;
const task = (p: Partial<PlanTask> & { assigneeId: string }): PlanTask => ({
  id: `t${++seq}`,
  size: 'M',
  status: 'TODO',
  priority: 'MEDIUM',
  startDate: null,
  dueDate: null,
  createdAt: new Date(2026, 0, seq),
  ...p,
});

describe('work planner', () => {
  it('counts less remaining effort once work has started and none when parked or finished', () => {
    expect(remainingDays({ size: 'L', status: 'TODO' })).toBe(5);
    expect(remainingDays({ size: 'L', status: 'IN_PROGRESS' })).toBe(3);
    expect(remainingDays({ size: 'L', status: 'IN_REVIEW' })).toBe(1);
    expect(remainingDays({ size: 'L', status: 'BACKLOG' })).toBe(0);
    expect(remainingDays({ size: 'L', status: 'DONE' })).toBe(0);
  });

  it('lays tasks end to end by due date and skips weekends, holidays and leave', () => {
    const a = task({ assigneeId: 'u', size: 'M', dueDate: '2026-11-20' }); // 2 days
    const b = task({ assigneeId: 'u', size: 'L', dueDate: '2026-11-12' }); // 5 days, due first
    const s = schedule('u', [a, b], cal({ u: ['2026-11-10'] }, ['2026-11-13']));
    // b: Mon 9, (Tue leave), Wed 11, Thu 12, (Fri holiday), Mon 16, Tue 17 → late (due 12th)
    expect(s.slots.get(b.id)).toMatchObject({ start: '2026-11-09', end: '2026-11-17', late: true });
    // a: Wed 18, Thu 19 → on time
    expect(s.slots.get(a.id)).toMatchObject({ start: '2026-11-18', end: '2026-11-19', late: false });
    expect(s.freeFrom).toBe('2026-11-20');
  });

  it('shares a day between two half-day tasks', () => {
    const a = task({ assigneeId: 'u', size: 'XS' });
    const b = task({ assigneeId: 'u', size: 'XS' });
    const s = schedule('u', [a, b], cal());
    expect(s.slots.get(a.id)!.end).toBe('2026-11-09');
    expect(s.slots.get(b.id)!.end).toBe('2026-11-09');
    expect(s.freeFrom).toBe('2026-11-10');
  });

  it('does not start a task before its start date', () => {
    const a = task({ assigneeId: 'u', size: 'S', startDate: '2026-11-18' });
    expect(schedule('u', [a], cal()).slots.get(a.id)).toMatchObject({ start: '2026-11-18', end: '2026-11-18' });
  });

  it('measures load as work due in the next ten working days against the days available', () => {
    expect(windowEnd(cal())).toBe('2026-11-20');
    const tasks = [
      task({ assigneeId: 'u', size: 'L', dueDate: '2026-11-13' }), // 5
      task({ assigneeId: 'u', size: 'L' }), // 5, no date counts
      task({ assigneeId: 'u', size: 'XL', dueDate: '2026-12-20' }), // outside the window
    ];
    const l = loadOf('u', tasks, cal());
    expect(l).toMatchObject({ availableDays: 10, demandDays: 10, openDays: 20, pct: 100, level: 'steady', openTasks: 3 });
    // Two days of leave: the same work no longer fits.
    expect(loadOf('u', tasks, cal({ u: ['2026-11-11', '2026-11-12'] }))).toMatchObject({ availableDays: 8, pct: 125, level: 'over' });
    expect(loadOf('idle', [], cal())).toMatchObject({ pct: 0, level: 'free', openTasks: 0 });
  });

  it('ranks possible new owners: on time first, then soonest', () => {
    const t = task({ assigneeId: 'busy', size: 'M', dueDate: '2026-11-11' });
    const byUser = new Map<string, PlanTask[]>([
      ['free', []],
      ['half', [task({ assigneeId: 'half', size: 'L', dueDate: '2026-11-10' })]],
    ]);
    const c = candidatesFor(t, ['busy', 'half', 'free'], byUser, cal());
    expect(c.map((x) => x.userId)).toEqual(['free', 'half']);
    expect(c[0]).toMatchObject({ pct: 0, pctAfter: 20, finishBy: '2026-11-10', late: false });
    expect(c[1]!.late).toBe(true);
  });

  it('hands unstarted work from an overloaded person to someone with room', () => {
    const big = [1, 2, 3].map(() => task({ assigneeId: 'asha', size: 'L', dueDate: '2026-11-20' })); // 15 days in a 10-day window
    const small = [1, 2, 3].map(() => task({ assigneeId: 'ravi', size: 'XS', dueDate: '2026-11-20' })); // 1.5 days
    const s = suggest(['asha', 'ravi'], [...big, ...small], cal(), () => ['asha', 'ravi']);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: 'REASSIGN', fromUserId: 'asha', toUserId: 'ravi', fromPct: 150, toPct: 15, toPctAfter: 65 });
    expect(big.map((t) => t.id)).toContain(s[0]!.taskId);
  });

  it('never hands over work that has been started, and proposes a realistic date when nobody has room', () => {
    const started = task({ assigneeId: 'asha', size: 'XL', status: 'IN_PROGRESS', dueDate: '2026-11-11' }); // 6 days left, due in 3
    const s = suggest(['asha', 'ravi'], [started], cal(), () => ['asha', 'ravi']);
    expect(s).toEqual([{ taskId: started.id, kind: 'MOVE_DATE', fromUserId: 'asha', date: '2026-11-16', fromPct: 60 }]);
  });

  it('only offers people who are eligible for the task', () => {
    const big = [1, 2, 3].map(() => task({ assigneeId: 'asha', size: 'L', dueDate: '2026-11-20' }));
    const s = suggest(['asha', 'ravi'], big, cal(), () => ['asha']);
    expect(s.every((x) => x.kind === 'MOVE_DATE')).toBe(true);
  });

  it('suggests nothing when everyone can finish on time', () => {
    const t = task({ assigneeId: 'asha', size: 'S', dueDate: '2026-11-20' });
    expect(suggest(['asha', 'ravi'], [t], cal(), () => ['asha', 'ravi'])).toEqual([]);
  });
});
