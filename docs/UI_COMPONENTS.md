# UI Components

All live in `apps/web/src/components`. Primitives are shadcn-style wrappers over Radix, styled with the tokens in `DESIGN_SYSTEM.md`.

## Primitives (`components/ui`)
| Component | Notes |
|---|---|
| `Button` | Variants `primary`, `outline`, `secondary`, `ghost`, `danger`, `link`. Sizes `sm`, `md`, `lg`, `icon`, `icon-sm`. `loading` shows a spinner and disables the button. |
| `Input`, `Textarea`, `Select`, `Label`, `Field` | `Field` adds the label, hint and error with `role="alert"`. |
| `Card`, `SectionTitle`, `CardHeader` | `SectionTitle` is the quiet in-page heading (icon + 13px title + optional action). |
| `Dialog`, `ConfirmDialog` | Centred modal, or a right-side sheet with `side="right"`. Motion spring. |
| `Dialog guard` | `guard` keeps a dialog open on an outside click or Escape while closing would lose something (unsaved input, a one-time password). The close button and the dialog's own buttons still close it. |
| `Tabs`, `TabPanel` (`ui/tabs`) | Keyboard-accessible tabs. `variant="segmented"` (default) or `"side"` (list beside the content on desktop). Keep `value` in the URL. |
| `FilterChips` (`ui/filter-chips`) | One-of-many filter as chips with optional counts; radio-group keyboard behaviour. Keep `value` in the URL. |
| `ColorSwatches` (`ui/color-swatches`) | Named label colours for departments and leave types. |
| `DropdownMenu*`, `Popover*` | Elevated surface, keyboard accessible. |
| `Badge` | Tones `default`, `brand`, `success`, `warning`, `danger`, `muted`. |
| `Switch`, `Tooltip`, `Kbd`, `Skeleton`, `EmptyState` | |

## Shell (`components/shell`)
| Component | Notes |
|---|---|
| `PortalGate` | Loads `/auth/me` once and provides session and realtime. Shows a skeleton while loading. |
| `WorkspaceShell portal="app" or "admin"` | Collapsible rail (232 ↔ 64px, remembered per user) with workspace switcher, ⌘K search, nav groups, portal switch, settings, status picker, theme, connection state. Inset canvas. Mobile top bar plus bottom tabs (employee) or drawer. |
| `PageHeader`, `PageBody` | Canvas page header with eyebrow, title, description and actions. |

## Domain components
| Component | Notes |
|---|---|
| `UserAvatar`, `StatusLine` | Tinted initials or photo with a live presence dot. The status line shows the presence icon and text. |
| `PresenceIcon`, `ReactionIcon` | Icon mappings for presence and reactions. |
| `StatusPicker` | Custom message, suggestions, 13 presets, expiry. |
| `CommandPalette` | ⌘K: permission-aware search (people, channels, messages) and navigation. |
| `dashboard/widgets` | Home widget registry: `welcome`, `quickActions`, `clock` (day timeline), `recentChats`, `announcements`, `team` (pulse), `holidays`, `celebrations`, `orgStats`. Each widget declares its column. |
| `chat/ConversationList` | Middle pane: search, collapsible Channels and DMs sections, previews, time, unread. |
| `chat/Conversation` | Header (mobile back button), message stream (infinite scroll, day separators), thread and details panels. |
| `chat/MessageItem` | Hover toolbar: quick reactions, reaction picker, thread reply, copy text, copy link, edit, delete. |
| `chat/Composer` | Auto-grow, mention trigger, Enter or ⌘Enter per user preference, typing events. |
| `admin/*` | Admin page header (`PageHeader`, `Forbidden`, `LoadError`), audit list, `PersonPicker` (search for one active employee), `useUnsavedGuard`, `timeZoneLabel`. |

## Adding a page
1. Create `app/app/<route>/page.tsx` (employee) or `app/admin/<route>/page.tsx` (admin).
2. Start with `<PageHeader>` and compose sections with `SectionTitle`. Avoid wrapping every section in a card.
3. Add the nav item in `useNav()` (`workspace-shell.tsx`) with its `perm` if it's admin-only.
