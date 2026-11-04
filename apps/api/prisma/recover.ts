/**
 * superadmin:recover — restores access for a Super Admin who is locked out (lost password or authenticator).
 *
 *   CONFIRM_RECOVER=yes pnpm --filter @fg/api superadmin:recover --email it@futuristglobal.com
 *
 * It sets a new temporary password (generated and printed once, or NEW_PASSWORD), clears two-step
 * verification so they enrol again at next sign-in, signs them out everywhere, writes an audit entry
 * and notifies every other Super Admin of the organization in the app.
 * For anyone who is not a Super Admin, an administrator sets a new password from the admin portal instead.
 */
import { PrismaClient } from '@prisma/client';
import { emailSchema } from '@fg/shared';
import { argValue, choosePassword, dbHost, type Env, hashPassword, type Log, operatorName, RefusedError } from './operator';

export type RecoverResult = { userId: string; organizationId: string; email: string; password: string; passwordGenerated: boolean; sessionsRevoked: number; notified: string[] };

export async function recoverSuperAdmin(prisma: PrismaClient, env: Env, argv: string[] = [], log: Log = console.log): Promise<RecoverResult> {
  const parsed = emailSchema.safeParse(argValue(argv, 'email') ?? env.RECOVER_EMAIL ?? '');
  if (!parsed.success) throw new RefusedError('Pass --email (or set RECOVER_EMAIL) to the Super Admin who is locked out.');
  const email = parsed.data;
  log(`Database host: ${dbHost(env.DATABASE_URL)}`);

  const user = await prisma.user.findUnique({ where: { email }, include: { organization: { select: { name: true } } } });
  if (!user) throw new RefusedError(`No account for ${email}.`);
  if (!user.isSuperAdmin) throw new RefusedError(`${email} is not a Super Admin. An administrator can set a new password for them in the admin portal (Employees → the person's menu → Set password).`);
  if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED' || user.status === 'ARCHIVED') {
    throw new RefusedError(`${email} is ${user.status.toLowerCase()}. Recovery does not undo that; another Super Admin can reactivate the account first.`);
  }
  const { password, generated } = choosePassword(env.NEW_PASSWORD);

  log(`Will recover ${user.firstName} ${user.lastName} <${email}> in "${user.organization.name}":`);
  log('  - set a new temporary password they must change at next sign-in');
  log(`  - ${user.mfaEnabledAt ? 'turn off two-step verification so they set it up again' : 'two-step verification is not on; nothing to clear'}`);
  log('  - sign them out on every device');
  log('  - record it in the audit log and notify the other Super Admins');
  if (env.CONFIRM_RECOVER !== 'yes') throw new RefusedError('Nothing changed. Set CONFIRM_RECOVER=yes to go ahead.');

  const passwordHash = await hashPassword(password);
  const others = await prisma.user.findMany({
    where: { organizationId: user.organizationId, isSuperAdmin: true, status: 'ACTIVE', id: { not: user.id } },
    select: { id: true, email: true },
  });
  const name = `${user.firstName} ${user.lastName}`;

  const sessionsRevoked = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: true,
        status: 'ACTIVE',
        failedLogins: 0,
        lockedUntil: null,
        mfaSecretEnc: null,
        mfaPendingSecretEnc: null,
        mfaEnabledAt: null,
        mfaRecoveryCodes: [],
        mfaLastStep: null,
      },
    });
    const { count } = await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        organizationId: user.organizationId,
        actorId: null,
        action: 'superadmin.recovered',
        entityType: 'user',
        entityId: user.id,
        metadata: { email, mfaCleared: !!user.mfaEnabledAt, sessionsRevoked: count, passwordGenerated: generated, notified: others.map((o) => o.email), via: 'cli', operator: operatorName(env) },
      },
    });
    if (others.length) {
      // Security notices always arrive: they are not subject to the person's notification preferences.
      await tx.notification.createMany({
        data: others.map((o) => ({
          organizationId: user.organizationId,
          userId: o.id,
          type: 'security',
          title: `Super Admin access for ${name} was recovered`,
          body: 'An operator reset their password and two-step verification from the server. If you did not expect this, check the audit log and contact your IT team.',
          link: '/admin/audit',
        })),
      });
    }
    return count;
  });

  log('');
  log(`Recovered ${email}. Signed out of ${sessionsRevoked} session${sessionsRevoked === 1 ? '' : 's'}.`);
  if (generated) log(`Temporary password (shown only now, not stored anywhere): ${password}`);
  else log('Password: the one you supplied in NEW_PASSWORD.');
  log('Give it to them in person or by phone. They choose a new password and set up two-step verification again at next sign-in.');
  log(others.length ? `Notified ${others.length} other Super Admin${others.length === 1 ? '' : 's'}: ${others.map((o) => o.email).join(', ')}.` : 'There are no other active Super Admins to notify.');
  return { userId: user.id, organizationId: user.organizationId, email, password, passwordGenerated: generated, sessionsRevoked, notified: others.map((o) => o.email) };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  recoverSuperAdmin(prisma, process.env, process.argv.slice(2))
    .catch((e: Error) => {
      console.error(e instanceof RefusedError ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
