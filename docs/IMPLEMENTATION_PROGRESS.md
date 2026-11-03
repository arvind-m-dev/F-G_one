# Implementation Progress

## Done
| Date | Work | Verified by |
|---|---|---|
| 2 Nov 2026 | Milestone 1: auth, RBAC, tenant isolation, employees, departments, settings, home, chat, directory, admin analytics, audit | 23 API e2e, 7 unit, 7 Playwright |
| 3 Nov 2026 | Render + Neon deployment blueprint (team) | — |
| 3 Nov 2026 | **UI redesign, PRD Phases 0–1:** audit docs, design system, Geist, Lucide-only presence and reactions, `/app` and `/admin` portals, new shell (rail, ⌘K, status, theme), two-step login with recent accounts, Home recomposition with customize drawer, three-area chat with conversation list, message action toolbar, directory list/grid, personal Settings page, Admin overview recomposition | 24 API e2e, 7 unit, 10 Playwright (desktop + mobile), `next build` |
| 3 Nov 2026 | **Features and UX round:** attendance (employee, team, admin and CSV), announcements (feed, confirmations, admin publishing), notification inbox and preferences, getting-started checklist, help hints, URL-kept state, cache restore on refresh, breadcrumbs and titles, 404/error pages, tablet and mobile layouts | 32 API e2e, 7 unit, 14 Playwright (desktop + mobile), `next build`, load timings in `UX_AND_PERFORMANCE.md` |
| 4 Nov 2026 | **Attendance modes:** night shifts across midnight, split shifts, reminder/automatic check-in, automatic check-out (after workday, longest shift, idle) with admin settings; day-off work; top bar with account menu and role; live greeting; chat channel colours; leave: record on someone's behalf, day breakdown and sandwich rule, line calendar with details, past/upcoming split; `db:seed-fill` | 96 API e2e, 7 unit, typecheck. Playwright not run |
| 3 Nov 2026 | **HR round:** leave (balances, requests, approvals, calendar, types), holidays (categories, admin), attendance corrections, approvals inbox, production reset script | 39 API e2e, 7 unit, 17 Playwright |
| 3 Nov 2026 | **Super Admin PRD, Phase 1:** security and architecture audit, target design and phased plan (docs only) | Reviewed against the code (`auth.service.ts`, `session.guard.ts`, `permissions.ts`, schema) |
| 3 Nov 2026 | **Super Admin Phase 2a, permission engine:** scoped grants, extra roles, ALLOW/DENY overrides, per-request resolution, legacy compatibility, migration with backfill | 45 API e2e + 7 API unit, 7 web unit, 17 Playwright. Backfill verified (8 of 8 roles identical). |
| 3 Nov 2026 | **Super Admin Phase 2b, authority:** `isSuperAdmin` flag, limit, nominate/accept/revoke/remove, last-admin protection, Administrator role, client default-deny, SUSPENDED and ARCHIVED, invite re-issue escalation fix | 55 API e2e + 9 API unit, 7 web unit, 17 Playwright |
| 3 Nov 2026 | **Super Admin Phase 2c, MFA, re-auth and devices:** TOTP with recovery codes, half-signed-in sessions, `@RequireRecentAuth`, device list and sign-out (self and admin), socket disconnect on revoke, dormant Super Admin authority without MFA, Settings → Security and the sign-in code step | 65 API e2e + 17 API unit, 7 web unit, 18 Playwright |

## Next
1. Run `db:reset-org` on Neon before go-live (K-3). The script is ready.
2. Super Admin Phase 2d: bootstrap and recovery CLIs (`SUPER_ADMIN_IMPLEMENTATION_PLAN.md`)
3. Set `MFA_ENCRYPTION_KEY` on Render before anyone turns on two-step verification in production (see `DEPLOY_RENDER_NEON.md`)
4. Decision D-7 (storage) is still open and blocks pictures, attachments and documents
