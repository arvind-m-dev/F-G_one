# FG One Design System

The source of truth is `apps/web/src/app/globals.css` (tokens) and `packages/shared/src/presence.ts` (presence, reactions, accent palette).

## Principles
1. **Each page is composed for its job.** Home reads like a briefing, chat is a three-area workspace, admin pages are operational. There's no shared "stats row + table" template.
2. **Quiet chrome, rich content.** Navigation sits on a tinted *chrome* layer. Content lives on a single raised *canvas* sheet. Colour is reserved for state and action.
3. **Lucide icons only.** No emojis anywhere in the UI chrome. Presence and reactions use a fixed icon set.
4. **Designed dark mode.** Dark surfaces step up in lightness (chrome → canvas → surface → elevated) instead of inverting the light theme.

## Layering
| Layer | Light | Dark | Used for |
|---|---|---|---|
| `chrome` | `#ECEEF6` | `#0B0D11` | Window background, navigation rail |
| `background` | `#F7F8FC` | `#111318` | Legacy page background |
| `canvas` | `#FFFFFF` | `#15181F` | Main content sheet (rounded, inset 8px on desktop) |
| `surface` | `#FFFFFF` | `#191D25` | Cards, list containers, inputs |
| `surface-2` | `#F1F3F9` | `#222733` | Hover, segmented controls, subtle fills |
| `elevated` | `#FFFFFF` | `#292F3B` | Menus, popovers, dialogs |
| `border` / `border-strong` | `#E6E8EF` / `#D5D9E3` | `#272D3A` / `#303746` | Dividers / inputs |
| `foreground` | `#171A2B` | `#F1F3F9` | Primary text |
| `muted` / `subtle` | `#667085` / `#98A2B3` | `#A0A8B8` / `#6B7385` | Secondary text / metadata |

## Colour
| Token | Value | Use |
|---|---|---|
| `--brand` (primary) | `#6366F1` | Primary actions, focus, selection. Overridable by company branding or the user's accent. |
| `--brand-2` (secondary) | `#8B5CF6` | Gradient partner (greeting name, logo mark) |
| `cyan` | `#06B6D4` | Information accents |
| `success` | `#10B981` | Positive state, available presence |
| `warning` | `#F59E0B` | Attention, away presence |
| `danger` | `#F43F5E` | Destructive actions, busy presence, "now" marker |
| `info` | `#0EA5E9` | Informational |

`success-ink`, `warning-ink`, `danger-ink` and `info-ink` are the readable text colours on a soft state fill (badges, notices). `scrim` is the dimmed backdrop behind dialogs and drawers; `tooltip` / `tooltip-foreground` are the tooltip surface. Use these instead of Tailwind palette classes (`emerald-500`, `amber-400`, …) or hex values.

`primary-soft` (brand at 9% / 18% in dark) is the selection and active fill. `primary-ink` is a darker or lighter brand for text on soft fills.

**Accent palette** (user-selectable): Indigo, Violet, Sky, Cyan, Emerald, Amber, Rose. Admins may set any brand colour in System settings.

## Typography
* **Geist** (UI) and **Geist Mono** (codes, links), loaded via `next/font`.
* Page title: 1.6rem/600, tracking −0.015em. Home greeting: 2–2.35rem/600.
* Section title: 13px/600 with a muted Lucide icon.
* Body: 14px (messages 14.5px, 1.55 line-height). Metadata: 11–12px `muted`/`subtle`.
* User text size: `html[data-font-size=sm|md|lg]` sets 15 / 16 / 17.5px root.

## Spacing and shape
* Spacing scale: 4, 8, 12, 16, 24, 32, 40–48px. Page gutters are 24px on mobile and 40px on desktop, with 40px between major columns.
* Radius: 6px (badges), 8px (buttons, inputs, nav items), 12px (cards, canvas, dialogs), full (avatars, chips).
* Elevation: `shadow-sm` for controls, `shadow-md` for hover cards and toolbars, `shadow-lg` for dialogs and popovers.

## Motion
* 150–250ms with ease-out or spring (stiffness ~400, damping ~38) for the rail, drawers and dialogs.
* Page transition: 160ms fade with a 4px rise. Lists stagger 20–50ms.
* `prefers-reduced-motion` disables animations globally: CSS via the media query in `globals.css`, Motion via `<MotionConfig reducedMotion="user">` in `components/providers.tsx`.
* Auth pages use CSS (`tw-animate-css`) instead of JS animation, so they render even before hydration.

## Presence
13 presets (shared `PRESENCE_PRESETS`). Each maps to a Lucide icon (`components/presence.tsx`), a tone (dot colour) and a group (team pulse):

| Group | Presets |
|---|---|
| Available (green) | Available, Working, Working from home, In the office |
| Busy (red) | Busy, In a meeting, Focus time, Do not disturb |
| Away (amber) | Away, Short break, Lunch break, Stepped out |
| Offline (grey) | Appear offline, or disconnected |

A custom status is free text with suggestions ("Working on QA", "In a client call", …) and optional expiry.

## Reactions
A fixed icon set, stored by key and validated by the API: `thumbs-up` (Agree), `heart` (Love), `laugh` (Funny), `party` (Celebrate), `check` (Done), `eyes` (Looking), `flame` (Great), `rocket` (Ship it).
