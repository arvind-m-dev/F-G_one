# Account provisioning

How people get into FG One: who creates accounts, how passwords are set and changed, and the two operator commands for the first Super Admin and for lockouts.

## The rules in one paragraph

Only administrators create accounts. Each account gets an email on a company domain and a password the administrator chooses. There are **no invitation links** and no public sign-up. By default only administrators set or change passwords (`settings.auth.selfServicePassword` is off). Super Admin is a separate authority on top of a role. It needs two-step verification (an authenticator app), and it stays switched off while the account still has to choose a new password.

## Creating an account

**Administration → Employees → Add an employee.** Fill in the name, work email, role, department and manager, and a password (10+ characters with upper and lower case and a number). FG One shows a short sign-in message to send the person (email address and password). The account is active straight away, joins the default channels and is recorded in the audit log (`employee.created`).

* The email must use one of the company domains under **Administration → Settings → Allowed email domains**.
* Who can create whom follows the role ranks: you cannot create an account with a role above your own.
* An account without a password (for example one imported or created before this policy) shows as **waiting for a password** on the admin overview. Use **Set password** on it to activate it.

## Passwords

| `selfServicePassword` | Admin creates or resets a password | Can people change their own? |
|---|---|---|
| **Off** (default) | The password is final. The person signs in with it. | No. Profile says passwords are managed by the administrator. |
| On | The password is temporary. The person must choose their own at the next sign-in (`mustChangePassword`). | Yes, in their profile. |

The switch is in **Administration → Settings → People choose their own passwords**.

* **Forgotten password:** an administrator opens **Employees**, the person's menu, **Set password**. This signs the person out everywhere and is audited (`employee.password_set`).
* A temporary-password session (`mustChangePassword`) can only read its own profile, sign out and change the password. Every other request is refused until a new password is chosen.
* Passwords are hashed with Argon2id. Nobody, including administrators, can read them back.
* Five wrong passwords in a row lock the account for 15 minutes. Setting a new password clears the lock.

> Known gap: the **Forgot password** email link still works when `selfServicePassword` is off, so anyone with access to their mailbox can set their own password. Until that is closed, leave `SMTP_URL` empty if passwords must stay admin-only.

## Super Admins

A Super Admin manages other Super Admins and the system settings that no role can grant. The authority is the `isSuperAdmin` flag, separate from the Administrator role.

* It is only active when the account has two-step verification turned on **and** has no pending password change. Until then the person works with their role's permissions only, and the app asks them to turn on two-step verification.
* Existing Super Admins nominate others through the `/api/super-admins` endpoints (there is no admin page for it yet); the nominee accepts with their own password.
* Sensitive Super Admin actions ask for the current password again.

### First Super Admin: `superadmin:bootstrap`

Run once per organization, from a machine that can reach the database. It never runs over HTTP.

```bash
DATABASE_URL='postgresql://…' \
ORG_SLUG=futurist-global ORG_NAME="Futurist Global" ORG_DOMAIN=futuristglobal.com \
ADMIN_EMAIL=it@futuristglobal.com ADMIN_FIRST=IT ADMIN_LAST=Admin \
CONFIRM_BOOTSTRAP=yes pnpm --filter @fg/api superadmin:bootstrap
```

| Variable | Needed | Meaning |
|---|---|---|
| `ORG_SLUG` | yes (falls back to `DEFAULT_ORG_SLUG`) | Organization to create or use. Must match `DEFAULT_ORG_SLUG` on the API. |
| `ORG_NAME`, `ORG_DOMAIN` | only when the organization does not exist yet | Name and the allowed email domain. |
| `ADMIN_EMAIL` (or `--email`) | yes | The first Super Admin's work email, on a company domain. |
| `ADMIN_FIRST`, `ADMIN_LAST` | no (default "Super Admin") | Their name. |
| `ADMIN_PASSWORD` | no | Use this password instead of a generated one. Must pass the password rules. |
| `CONFIRM_BOOTSTRAP=yes` | yes | Without it, the command only shows what it would do. |

What it does:

1. Prints the database host, so you can check you are pointed at the right database.
2. If the organization already has a Super Admin who can sign in (status active or waiting for a password), it says **already initialized** and changes nothing. This makes it safe to re-run and closes it after the first success.
3. Otherwise it creates the organization if needed, adds any missing system roles, `#general`, `#announcements` and the default leave types (existing ones are left as they are), and creates the account with the Administrator role and `isSuperAdmin`. If the email already belongs to an active person in the same organization, that account is promoted instead: new password, two-step verification cleared, signed out everywhere.
4. Prints a **temporary password once** (20 characters from the system's secure random generator; not stored anywhere) unless you supplied `ADMIN_PASSWORD`. The account must choose a new password at first sign-in, then turn on two-step verification before Super Admin powers switch on.
5. Writes an audit entry `superadmin.bootstrapped` (no actor; the metadata records `via: cli`, the operator's user name and whether the password was generated). The password itself is never logged.

It refuses, changing nothing, when the email is outside the company domains, belongs to another organization, is deactivated or archived, or is a client account.

Suspended, deactivated and archived Super Admins do not count as "initialized", so if every Super Admin has been switched off, bootstrap can create a new one.

### Locked-out Super Admin: `superadmin:recover`

For an existing Super Admin who lost their phone (authenticator) or password.

```bash
DATABASE_URL='postgresql://…' CONFIRM_RECOVER=yes \
pnpm --filter @fg/api superadmin:recover --email it@futuristglobal.com
```

| Variable | Needed | Meaning |
|---|---|---|
| `--email` (or `RECOVER_EMAIL`) | yes | The locked-out Super Admin. |
| `NEW_PASSWORD` | no | Use this password instead of a generated one. |
| `CONFIRM_RECOVER=yes` | yes | Without it, the command only shows what it would do. |
| `OPERATOR` | no | Name recorded in the audit entry (defaults to the shell user). |

What it does, in one transaction:

* sets a new temporary password (printed once) and marks it for change at next sign-in
* turns off two-step verification and deletes the recovery codes, so they set it up again
* clears the wrong-password lock and unused reset links
* signs them out on every device
* writes an audit entry `superadmin.recovered` (who, whether two-step verification was cleared, sessions revoked, who was notified, operator)
* creates an in-app notification for **every other active Super Admin** of the organization ("Super Admin access for … was recovered"), linking to the audit log. These security notices ignore notification preferences.

It refuses for accounts that are not Super Admins (an administrator sets their password in the portal instead) and for suspended, deactivated or archived accounts (another Super Admin reactivates them first). Give the temporary password to the person in person or by phone, not over chat.

The command runs outside the API, so it cannot close live chat connections. The deleted sessions cannot make any further requests; an already-open chat connection stays open until it reconnects or the API restarts.

### Removing demo data: `db:reset-org`

Deletes one organization with everything in it and runs the bootstrap again. Dry run unless `CONFIRM_RESET` repeats the slug. It checks the bootstrap values before deleting anything. See [DEPLOY_RENDER_NEON.md](DEPLOY_RENDER_NEON.md) §4.

## Demo data (development only)

`pnpm db:seed` creates Futurist Global with about 45 people. All seeded accounts use `SEED_PASSWORD` from `apps/api/.env` and are not marked for a password change. `admin@futuristglobal.com` is a Super Admin without two-step verification, so its Super Admin authority is dormant until you turn it on in Settings → Security. The seed refuses to run when `NODE_ENV=production`.

## Code map

| What | Where |
|---|---|
| Bootstrap | `apps/api/prisma/bootstrap.ts` (`bootstrapSuperAdmin`) |
| Recovery | `apps/api/prisma/recover.ts` (`recoverSuperAdmin`) |
| Shared helpers (password generator, flags) | `apps/api/prisma/operator.ts` |
| Reset | `apps/api/prisma/reset-org.ts` |
| Tests | `apps/api/test/superadmin-cli.e2e-spec.ts` |
| Admin account creation and Set password | `apps/api/src/employees/employees.service.ts` |
| Password change rules | `apps/api/src/auth/auth.service.ts` (`changePassword`) |
