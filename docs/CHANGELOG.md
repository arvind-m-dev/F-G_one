# Changelog

## Unreleased: UI redesign (branch `ui-redesign`)
### Added
- Employee portal at `/app` and Admin portal at `/admin`, with a workspace switcher between them. Old routes redirect.
- Two-step sign-in with device-local recent accounts (choose, use another, remove).
- Personal Settings page: theme, accent palette, text size, sidebar, message density, Enter-to-send, 12/24-hour time.
- Chat conversation list with search, previews, timestamps and unread counts. Mobile single-view chat with back navigation.
- Message toolbar: copy text, copy link, reaction picker.
- Home "Customize" drawer (reorder within sections, hide, restore default).
- Seed channels from the PRD (development, qa-testing, project-updates, ideas, help-support, team-discussion).
- Docs: UI audit, design system, UI components, implementation plan, feature inventory, decisions, known issues, progress.

### Changed
- New design tokens (PRD palette), Geist typeface, chrome/canvas layering, redesigned dark theme.
- Home recomposed: greeting with personal summary, day timeline, attention list, editorial announcements, team pulse grouped by availability.
- Admin overview recomposed around team composition, pending invitations and recent activity.
- Directory is list-first, with department filter chips.
- Presence and reactions use Lucide icons. The API only accepts the approved reaction keys.

### Removed
- Emojis from UI chrome, presence, seeded statuses and messages.
- The top bar. Its functions moved into the rail.

## 0.1.0: Milestone 1 (2 Nov 2026)
- Foundation and hybrid workspace (see README).
