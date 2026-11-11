'use client';
import { ChevronLeft, ChevronRight, CircleCheck, CircleDot, ClipboardCopy, FileText, TriangleAlert, Clock3 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SectionTitle } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { errorMessage } from '@/lib/api';
import { addDaysYmd, fmtDay, LOAD_LABEL, useWorkReport, type WorkReport } from '@/lib/work';
import { cn } from '@/lib/utils';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The report as plain text, for pasting into chat or an email. */
function asText(r: WorkReport, name: (id: string | null) => string) {
  const list = (title: string, rows: WorkReport['done']) => (rows.length ? [`${title}:`, ...rows.map((t) => `  - ${t.ref ? `${t.ref} ` : ''}${t.title}${t.assigneeId ? ` (${name(t.assigneeId)})` : ''}`), ''] : []);
  return [
    `Work report for ${fmtDay(r.date, { weekday: true })}`,
    `${plural(r.totals.done, 'task', 'tasks')} finished, ${r.totals.started} started, ${r.totals.created} added.`,
    `${r.totals.overdue} overdue, ${r.totals.atRisk} at risk, ${r.totals.unassigned} without an owner.`,
    '',
    ...list('Finished', r.done),
    ...list('Started', r.started),
    ...list('Overdue', r.overdue),
    ...list('At risk', r.atRisk),
    ...(r.people.length ? ['People:', ...r.people.map((p) => `  - ${p.person.name}: ${p.done} finished, ${p.open} open, ${p.overdue} overdue, ${p.pct}% of their time (${LOAD_LABEL[p.level].toLowerCase()})`)] : []),
  ]
    .join('\n')
    .trim();
}

function Lines({ icon, title, tone, rows, empty, name, onOpen }: { icon: React.ReactNode; title: string; tone?: string; rows: WorkReport['done']; empty: string; name: (id: string | null) => string; onOpen: (id: string) => void }) {
  return (
    <section>
      <SectionTitle icon={icon}>
        <span className={tone}>
          {title} · {rows.length}
        </span>
      </SectionTitle>
      {rows.length ? (
        <ul className="divide-y rounded-xl border">
          {rows.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => onOpen(t.id)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[13px] outline-none hover:bg-surface-2/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                {t.ref && <span className="font-mono text-[11px] text-subtle">{t.ref}</span>}
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="shrink-0 text-xs text-muted">{name(t.assigneeId)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-5 text-center text-xs text-muted">{empty}</p>
      )}
    </section>
  );
}

/** What moved on a day and where things stand now. Managers see their people; everyone else sees their own. */
export function ReportView({ date, onDate, onOpen }: { date: string; onDate: (d: string | null) => void; onOpen: (id: string) => void }) {
  const q = useWorkReport(date || undefined);
  if (q.isPending) return <Skeleton className="h-72" />;
  if (q.isError) return <EmptyState icon={<FileText />} title="The report couldn't be loaded" description={errorMessage(q.error)} action={<Button variant="outline" onClick={() => void q.refetch()}>Try again</Button>} />;
  const r = q.data;
  const isToday = r.date === r.today;
  const names = new Map(r.people.map((p) => [p.person.id, p.person.name]));
  const name = (id: string | null) => (id ? (names.get(id) ?? '') : 'No owner');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText(r, name));
      toast.success('Report copied. Paste it anywhere.');
    } catch {
      toast.error('Copying is blocked in this browser. Select the text on the page instead.');
    }
  };
  const quiet = !r.totals.done && !r.totals.started && !r.totals.created;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg border bg-surface p-0.5">
          <Button variant="ghost" size="icon-sm" onClick={() => onDate(addDaysYmd(r.date, -1))} aria-label="Previous day">
            <ChevronLeft />
          </Button>
          <span className="min-w-36 px-1 text-center text-[13px] font-medium tabular-nums" aria-live="polite">
            {isToday ? 'Today' : fmtDay(r.date, { weekday: true })}
          </span>
          <Button variant="ghost" size="icon-sm" disabled={isToday} onClick={() => onDate(addDaysYmd(r.date, 1) >= r.today ? null : addDaysYmd(r.date, 1))} aria-label="Next day">
            <ChevronRight />
          </Button>
        </div>
        <Button variant="outline" onClick={() => void copy()}>
          <ClipboardCopy /> Copy as text
        </Button>
      </div>

      <p className="max-w-3xl text-[15px] leading-relaxed">
        {quiet ? (
          <span className="font-semibold">{isToday ? 'Nothing has moved yet today.' : `Nothing moved on ${fmtDay(r.date, { weekday: true })}.`}</span>
        ) : (
          <>
            <span className="font-semibold">
              {isToday ? 'So far today' : `On ${fmtDay(r.date, { weekday: true })}`}: {plural(r.totals.done, 'task', 'tasks')} finished
            </span>
            , {r.totals.started} started and {r.totals.created} added.
          </>
        )}{' '}
        Right now{' '}
        <span className={cn(r.totals.overdue > 0 && 'font-semibold text-danger')}>{plural(r.totals.overdue, 'task is', 'tasks are')} overdue</span>,{' '}
        <span className={cn(r.totals.atRisk > 0 && 'font-semibold text-warning')}>{r.totals.atRisk} likely to finish late</span>
        {r.totals.unassigned > 0 ? `, ${plural(r.totals.unassigned, 'has', 'have')} no owner` : ''}
        {r.totals.waitingForDecision > 0 ? `, and ${plural(r.totals.waitingForDecision, 'request is', 'requests are')} waiting for your decision` : ''}.
      </p>

      <div className="grid gap-8 lg:grid-cols-2">
        <Lines icon={<CircleCheck />} title="Finished" rows={r.done} empty={isToday ? 'Nothing finished yet today.' : 'Nothing was finished that day.'} name={name} onOpen={onOpen} />
        <Lines icon={<CircleDot />} title="Started" rows={r.started} empty={isToday ? 'Nothing started yet today.' : 'Nothing was started that day.'} name={name} onOpen={onOpen} />
        <Lines icon={<Clock3 />} title="Overdue now" tone={r.overdue.length ? 'text-danger' : undefined} rows={r.overdue} empty="Nothing is overdue." name={name} onOpen={onOpen} />
        <Lines icon={<TriangleAlert />} title="Likely to finish late" tone={r.atRisk.length ? 'text-warning' : undefined} rows={r.atRisk} empty="Everything with a date is on track." name={name} onOpen={onOpen} />
      </div>

      {r.people.length > 1 && (
        <section>
          <SectionTitle icon={<FileText />}>By person</SectionTitle>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-xs text-muted">
                  <th className="px-3.5 py-2 font-medium">Person</th>
                  <th className="px-3 py-2 text-right font-medium">Finished</th>
                  <th className="px-3 py-2 text-right font-medium">Started</th>
                  <th className="px-3 py-2 text-right font-medium">Open</th>
                  <th className="px-3 py-2 text-right font-medium">Overdue</th>
                  <th className="px-3.5 py-2 text-right font-medium">Next two weeks</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {r.people.map((p) => (
                  <tr key={p.person.id}>
                    <td className="px-3.5 py-2">
                      <span className="flex items-center gap-2">
                        <UserAvatar person={p.person} size="xs" showPresence={false} />
                        <span className="truncate font-medium">{p.person.name}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.done}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.started}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.open}</td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', p.overdue > 0 && 'font-semibold text-danger')}>{p.overdue}</td>
                    <td className={cn('px-3.5 py-2 text-right whitespace-nowrap', p.level === 'over' ? 'font-semibold text-danger' : 'text-muted')}>
                      {p.pct}% · {LOAD_LABEL[p.level]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
