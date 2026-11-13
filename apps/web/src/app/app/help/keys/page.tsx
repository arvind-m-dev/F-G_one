'use client';
import { PageHeader } from '@/components/shell/page';
import { Kbd } from '@/components/ui/misc';
import { useModKey } from '@/lib/platform';
import { useSession } from '@/lib/session';

/** Keyboard shortcuts cheat sheet. Everything listed is wired up today. */
export default function ShortcutsPage() {
  const mod = useModKey();
  const me = useSession();
  const enterToSend = me.preferences.enterToSend !== false;
  const groups: { title: string; rows: { keys: string[]; label: string }[] }[] = [
    {
      title: 'Everywhere',
      rows: [
        { keys: [mod, 'K'], label: 'Open the command palette (search people, pages and messages)' },
        { keys: ['?'], label: 'Open this keyboard shortcuts page' },
      ],
    },
    {
      title: 'Chat',
      rows: enterToSend
        ? [
            { keys: ['Enter'], label: 'Send message' },
            { keys: ['Shift', 'Enter'], label: 'New line without sending' },
          ]
        : [
            { keys: [mod, 'Enter'], label: 'Send message' },
            { keys: ['Enter'], label: 'New line' },
          ],
    },
    {
      title: 'Go somewhere (press g, then…)',
      rows: [
        { keys: ['G', 'H'], label: 'Home' },
        { keys: ['G', 'C'], label: 'Chat' },
        { keys: ['G', 'W'], label: 'Work' },
        { keys: ['G', 'A'], label: 'Attendance' },
        { keys: ['G', 'L'], label: 'Leave' },
        { keys: ['G', 'P'], label: 'Directory' },
      ],
    },
    {
      title: 'Dialogs',
      rows: [{ keys: ['Esc'], label: 'Close the open dialog or menu' }],
    },
  ];
  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <PageHeader title="Keyboard shortcuts" description="Get around FG One without touching the mouse." className="px-0" />
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="mb-2 text-[13px] font-semibold text-muted">{g.title}</h2>
            <ul className="divide-y border-y">
              {g.rows.map((r) => (
                <li key={r.label} className="flex items-center justify-between gap-6 py-2.5">
                  <span className="text-[13px]">{r.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {r.keys.map((k, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="text-[11px] text-subtle">+</span>}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="text-xs text-muted">Shortcuts marked with just a letter only trigger when nothing else owns the keyboard (not inside an input, dialog or menu). You can change whether Enter sends in Settings.</p>
      </div>
    </div>
  );
}
