'use client';
import { ACCENT_PALETTE, PROJECT_STATUS_LABELS, PROJECT_STATUSES, projectSchema, updateProjectSchema, type ProjectStatus } from '@fg/shared';
import { useMutation } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { UserAvatar } from '@/components/user-avatar';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useRefreshWork, type MiniPerson, type Project } from '@/lib/work';
import { cn } from '@/lib/utils';
import { PersonPicker } from './task-bits';

/** A short code from the name: "Website relaunch" → "WR", "Payments" → "PAY". */
function suggestKey(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const raw = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 3);
  const key = raw.replace(/^[0-9]+/, '').slice(0, 6);
  return key.length >= 2 ? key : '';
}

/** Create a project, or edit one when `project` is given. */
export function ProjectDialog({ open, onOpenChange, project, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; project?: Project; onSaved?: (p: Project) => void }) {
  const me = useSession();
  const self: MiniPerson = { id: me.user.id, name: me.user.name, designation: me.user.designation, avatarUrl: me.user.avatarUrl, avatarColor: me.user.avatarColor };
  const refresh = useRefreshWork();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<string>(ACCENT_PALETTE[0].value);
  const [status, setStatus] = useState<ProjectStatus>('ACTIVE');
  const [lead, setLead] = useState<MiniPerson | null>(self);
  const [members, setMembers] = useState<MiniPerson[]>([]);
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? '');
    setKey(project?.key ?? '');
    setKeyTouched(!!project);
    setDescription(project?.description ?? '');
    setColor(project?.color ?? ACCENT_PALETTE[0].value);
    setStatus(project?.status ?? 'ACTIVE');
    setLead(project ? project.lead : self);
    setMembers(project ? project.members.filter((m) => m.id !== project.lead?.id) : []);
    setStartDate(project?.startDate ?? '');
    setTargetDate(project?.targetDate ?? '');
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id]);

  const save = useMutation({
    mutationFn: (body: unknown) => (project ? api<Project>(`/work/projects/${project.id}`, { method: 'PATCH', body }) : api<Project>('/work/projects', { body })),
    onSuccess: (p) => {
      toast.success(project ? 'Project saved' : `${p.name} created`);
      refresh();
      onOpenChange(false);
      onSaved?.(p);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.issues?.length) setErrors(Object.fromEntries(e.issues.map((i) => [i.path, i.message])));
      else if (e instanceof ApiError && e.status === 409 && /short code/.test(e.message)) setErrors({ key: e.message });
      else toast.error(errorMessage(e));
    },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const common = { name, description: description || null, color, leadId: lead?.id ?? null, memberIds: members.map((m) => m.id), startDate: startDate || null, targetDate: targetDate || null };
    const parsed = project ? updateProjectSchema.safeParse({ ...common, status }) : projectSchema.safeParse({ ...common, key });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? 'name'), i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };
  const taken = new Set([lead?.id, ...members.map((m) => m.id)]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={project ? 'Edit project' : 'New project'} description={project ? undefined : 'A project groups tasks, the people working on them and a target date.'} className="max-w-xl" guard={!project && name.trim().length > 0}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_128px]">
          <Field label="Name" htmlFor="p-name" error={errors.name}>
            <Input
              id="p-name"
              value={name}
              maxLength={80}
              autoFocus
              placeholder="e.g. Website relaunch"
              aria-invalid={!!errors.name}
              onChange={(e) => {
                setName(e.target.value);
                if (!keyTouched) setKey(suggestKey(e.target.value));
              }}
            />
          </Field>
          <Field label="Short code" htmlFor="p-key" error={errors.key} hint={project ? 'Cannot be changed.' : `Tasks are numbered ${key || 'WEB'}-1, ${key || 'WEB'}-2…`}>
            <Input
              id="p-key"
              value={key}
              disabled={!!project}
              maxLength={6}
              placeholder="WEB"
              className="font-mono uppercase"
              aria-invalid={!!errors.key}
              onChange={(e) => {
                setKeyTouched(true);
                setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
              }}
            />
          </Field>
        </div>
        <Field label="What is it for? (optional)" htmlFor="p-desc" error={errors.description}>
          <Textarea id="p-desc" rows={2} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} placeholder="The outcome this project should deliver" />
        </Field>
        <div>
          <p className="text-[13px] font-medium">Colour</p>
          <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Project colour">
            {ACCENT_PALETTE.map((c) => (
              <button key={c.key} type="button" role="radio" aria-checked={color.toLowerCase() === c.value.toLowerCase()} aria-label={c.label} title={c.label} onClick={() => setColor(c.value)} className="grid size-7 place-items-center rounded-lg outline-none ring-offset-2 ring-offset-elevated transition focus-visible:ring-2 focus-visible:ring-ring aria-checked:ring-2 aria-checked:ring-foreground/60" style={{ background: c.value }}>
                {color.toLowerCase() === c.value.toLowerCase() && <Check className="size-3.5 text-white" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lead" error={errors.leadId} hint="Plans the work and decides on timeline requests.">
            <PersonPicker value={lead} onChange={(p) => p && (setLead(p), setMembers((m) => m.filter((x) => x.id !== p.id)))} label="Lead" />
          </Field>
          {project && (
            <Field label="Status" htmlFor="p-status">
              <Select id="p-status" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <div>
          <p className="text-[13px] font-medium">People on the project</p>
          <ul className={cn('mt-1.5 flex flex-wrap gap-1.5', !members.length && 'hidden')}>
            {members.map((m) => (
              <li key={m.id} className="inline-flex items-center gap-1.5 rounded-full border bg-surface py-0.5 pr-1 pl-0.5 text-[13px]">
                <UserAvatar person={m} size="xs" showPresence={false} />
                {m.name}
                <button type="button" onClick={() => setMembers((x) => x.filter((p) => p.id !== m.id))} aria-label={`Remove ${m.name}`} className="grid size-5 place-items-center rounded-full text-subtle transition hover:bg-surface-2 hover:text-foreground">
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
          <PickerAdd key={members.length} taken={taken} onAdd={(p) => setMembers((m) => [...m, p])} />
          {errors.memberIds && <p className="mt-1 text-xs text-danger" role="alert">{errors.memberIds}</p>}
          <p className="mt-1 text-xs text-muted">They can see the project, add tasks and take work. The lead is always included.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start (optional)" htmlFor="p-start" error={errors.startDate}>
            <Input id="p-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Target date (optional)" htmlFor="p-target" error={errors.targetDate}>
            <Input id="p-target" type="date" value={targetDate} min={startDate || undefined} onChange={(e) => setTargetDate(e.target.value)} aria-invalid={!!errors.targetDate} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {project ? 'Save changes' : 'Create project'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** "Add a person" control: a picker that never holds a value. People already on the project are skipped. */
function PickerAdd({ taken, onAdd }: { taken: Set<string | undefined>; onAdd: (p: MiniPerson) => void }) {
  return (
    <PersonPicker
      value={null}
      noneLabel="Add a person"
      label="Add a person to the project"
      className="mt-2 sm:max-w-64"
      onChange={(p) => {
        if (!p) return;
        if (taken.has(p.id)) toast.info(`${p.name} is already on the project`);
        else onAdd(p);
      }}
    />
  );
}
