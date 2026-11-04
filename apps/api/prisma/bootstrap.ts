/**
 * superadmin:bootstrap — creates the organization (if missing) and its first Super Admin.
 *
 * There are no invitation links: the account gets a password, printed once (generated) or taken from
 * ADMIN_PASSWORD, and must choose a new one at first sign-in. Super Admin authority stays dormant
 * until they have changed it and turned on two-step verification.
 *
 *   CONFIRM_BOOTSTRAP=yes ORG_SLUG=futurist-global ORG_NAME="Futurist Global" ORG_DOMAIN=futuristglobal.com \
 *   ADMIN_EMAIL=it@futuristglobal.com ADMIN_FIRST=IT ADMIN_LAST=Admin \
 *   pnpm --filter @fg/api superadmin:bootstrap
 *
 * Closed after first success: when the organization already has a Super Admin who can sign in
 * (status ACTIVE or INVITED), it changes nothing and says so. Locked out? Use superadmin:recover.
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLE_DEFINITIONS, DEFAULT_ROLE_GRANTS, emailSchema, organizationSettingsSchema, parseOrganizationSettings } from '@fg/shared';
import { argValue, choosePassword, dbHost, type Env, hashPassword, type Log, operatorName, RefusedError } from './operator';

export type BootstrapResult =
  | { status: 'already-initialized'; organizationId: string; superAdmins: string[] }
  | { status: 'created'; organizationId: string; organizationCreated: boolean; userId: string; email: string; password: string; passwordGenerated: boolean; promotedExisting: boolean };

/** Super Admins who can still sign in. Suspended, deactivated and archived ones do not keep the bootstrap closed. */
const usableSuperAdmin = { isSuperAdmin: true, status: { in: ['ACTIVE', 'INVITED'] as ('ACTIVE' | 'INVITED')[] } };

const DEFAULT_LEAVE_TYPES = [
  { code: 'CL', name: 'Casual leave', annualAllowance: 12, color: '#0ea5e9' },
  { code: 'SL', name: 'Sick leave', annualAllowance: 8, color: '#f43f5e' },
  { code: 'EL', name: 'Earned leave', annualAllowance: 15, color: '#10b981' },
  { code: 'UL', name: 'Unpaid leave', annualAllowance: 0, color: '#94a3b8', paid: false },
];

/** Missing system roles, default channels and leave types are added; existing ones are left exactly as they are. */
async function ensureOrgBasics(prisma: PrismaClient, organizationId: string) {
  for (const r of DEFAULT_ROLE_DEFINITIONS) {
    await prisma.role.upsert({
      where: { organizationId_key: { organizationId, key: r.key } },
      update: {},
      create: { organizationId, key: r.key, name: r.name, description: r.description, rank: r.rank, isSystem: true, grants: { create: DEFAULT_ROLE_GRANTS[r.key] } },
    });
  }
  for (const name of ['general', 'announcements']) {
    await prisma.channel.upsert({
      where: { organizationId_name: { organizationId, name } },
      update: {},
      create: { organizationId, type: 'PUBLIC', name, isDefault: true, description: name === 'general' ? 'Company-wide chatter and news' : 'Official company announcements' },
    });
  }
  for (const t of DEFAULT_LEAVE_TYPES) {
    await prisma.leaveType.upsert({ where: { organizationId_code: { organizationId, code: t.code } }, update: {}, create: { ...t, organizationId } });
  }
}

/**
 * Creates the organization if it does not exist, then the first Super Admin. Pure function of `env` so it can be tested.
 * Throws RefusedError when the request is incomplete or unsafe; nothing is changed in that case.
 */
export async function bootstrapSuperAdmin(prisma: PrismaClient, env: Env, argv: string[] = [], log: Log = console.log): Promise<BootstrapResult> {
  const slug = (env.ORG_SLUG || env.DEFAULT_ORG_SLUG || '').trim();
  if (!slug) throw new RefusedError('Set ORG_SLUG to the organization slug (it must match DEFAULT_ORG_SLUG on the API).');
  log(`Database host: ${dbHost(env.DATABASE_URL)}`);

  let org = await prisma.organization.findUnique({ where: { slug } });
  if (org) {
    const existing = await prisma.user.findMany({ where: { organizationId: org.id, ...usableSuperAdmin }, select: { email: true }, orderBy: { createdAt: 'asc' } });
    if (existing.length) {
      log(`"${org.name}" is already initialized: it has ${existing.length} Super Admin${existing.length === 1 ? '' : 's'} (${existing.map((u) => u.email).join(', ')}). Nothing changed.`);
      log('A Super Admin who lost their password or authenticator can be restored with superadmin:recover.');
      return { status: 'already-initialized', organizationId: org.id, superAdmins: existing.map((u) => u.email) };
    }
  }

  const rawEmail = argValue(argv, 'email') ?? env.ADMIN_EMAIL;
  const parsedEmail = emailSchema.safeParse(rawEmail ?? '');
  if (!parsedEmail.success) throw new RefusedError('Set ADMIN_EMAIL (or pass --email) to the first Super Admin’s work email.');
  const email = parsedEmail.data;
  const domain = email.split('@')[1]!;

  if (!org && !(env.ORG_NAME && env.ORG_DOMAIN)) throw new RefusedError(`No organization "${slug}" yet. Set ORG_NAME and ORG_DOMAIN so it can be created.`);
  const allowed = org ? parseOrganizationSettings(org.settings).auth.allowedEmailDomains.map((d) => d.toLowerCase()) : [env.ORG_DOMAIN!.trim().toLowerCase()];
  if (allowed.length && !allowed.includes(domain)) throw new RefusedError(`${email} is not on a company domain (${allowed.join(', ')}).`);

  const taken = await prisma.user.findUnique({ where: { email }, select: { id: true, organizationId: true, status: true, accountType: true } });
  if (taken && (!org || taken.organizationId !== org.id)) throw new RefusedError(`${email} already belongs to another organization.`);
  if (taken && (taken.status === 'DEACTIVATED' || taken.status === 'ARCHIVED')) throw new RefusedError(`${email} is ${taken.status.toLowerCase()}. Use a different email.`);
  if (taken && taken.accountType !== 'INTERNAL') throw new RefusedError(`${email} is a client account and cannot be a Super Admin.`);

  const { password, generated } = choosePassword(env.ADMIN_PASSWORD);

  log(org ? `Organization "${org.name}" (${slug}) exists but has no Super Admin who can sign in.` : `Organization "${env.ORG_NAME}" (${slug}) will be created for ${allowed.join(', ')}.`);
  log(taken ? `The existing account ${email} will become the Super Admin (new password, two-step verification cleared, signed out everywhere).` : `A Super Admin account will be created for ${email}.`);
  if (env.CONFIRM_BOOTSTRAP !== 'yes') throw new RefusedError('Nothing changed. Set CONFIRM_BOOTSTRAP=yes to go ahead.');

  const organizationCreated = !org;
  if (!org) {
    org = await prisma.organization.create({ data: { name: env.ORG_NAME!, slug, settings: organizationSettingsSchema.parse({ auth: { allowedEmailDomains: allowed } }) } });
  }
  const organizationId = org.id;
  await ensureOrgBasics(prisma, organizationId);
  const role = await prisma.role.findUniqueOrThrow({ where: { organizationId_key: { organizationId, key: 'administrator' } } });
  const passwordHash = await hashPassword(password);
  const credentials = {
    passwordHash,
    mustChangePassword: true,
    status: 'ACTIVE' as const,
    isSuperAdmin: true,
    roleId: role.id,
    failedLogins: 0,
    lockedUntil: null,
    mfaSecretEnc: null,
    mfaPendingSecretEnc: null,
    mfaEnabledAt: null,
    mfaRecoveryCodes: [],
    mfaLastStep: null,
  };

  const user = await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction so two operators running it at once cannot both succeed.
    if (await tx.user.count({ where: { organizationId, ...usableSuperAdmin } })) throw new RefusedError('Another Super Admin was created meanwhile. Nothing changed.');
    const u = taken
      ? await tx.user.update({ where: { id: taken.id }, data: credentials })
      : await tx.user.create({ data: { organizationId, email, firstName: env.ADMIN_FIRST?.trim() || 'Super', lastName: env.ADMIN_LAST?.trim() || 'Admin', ...credentials } });
    if (taken) await tx.session.deleteMany({ where: { userId: u.id } });
    const defaults = await tx.channel.findMany({ where: { organizationId, isDefault: true }, select: { id: true } });
    await tx.channelMember.createMany({ data: defaults.map((c) => ({ channelId: c.id, userId: u.id })), skipDuplicates: true });
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: null,
        action: 'superadmin.bootstrapped',
        entityType: 'user',
        entityId: u.id,
        metadata: { email, organizationCreated, promotedExisting: !!taken, passwordGenerated: generated, via: 'cli', operator: operatorName(env) },
      },
    });
    return u;
  });

  log('');
  log(`Super Admin ready: ${email}${organizationCreated ? ` in the new organization "${org.name}"` : ''}.`);
  if (generated) {
    log(`Temporary password (shown only now, not stored anywhere): ${password}`);
  } else {
    log('Password: the one you supplied in ADMIN_PASSWORD.');
  }
  log('At first sign-in they must choose a new password, then turn on two-step verification in Settings → Security.');
  log('Super Admin powers stay switched off until both are done.');
  return { status: 'created', organizationId, organizationCreated, userId: user.id, email, password, passwordGenerated: generated, promotedExisting: !!taken };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  bootstrapSuperAdmin(prisma, process.env, process.argv.slice(2))
    .catch((e: Error) => {
      console.error(e instanceof RefusedError ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
