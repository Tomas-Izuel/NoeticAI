# Nav + shell improvements — design

Date: 2026-05-14
Status: approved

## Problem

Today's `apps/web/src/routes/_auth.tsx` has the 4-slot grid (`topbar` / `nav` / `main` / `tray`) wired but its contents are placeholders + three dev-only links. There is no product nav, no subject switcher, no breadcrumbs, no status tray. Testing Phase 5 is painful — the user has to hand-type `/concept/<id>` URLs.

## Decisions (user-confirmed)

1. **Scope**: full design shell, 1:1 with `design/shell.jsx` — breadcrumbs, subject switcher, NavRail with all groups, real status tray.
2. **"Concept detail" nav row**: links to the top-1 open-gap concept for the active subject (red first, then amber). Disabled tooltip if no audit has been run.
3. **Active subject persistence**: URL `subjectId` param wins; fallback to localStorage `noeticai.activeSubjectId`; fallback to `subjects[0]`. Switching writes localStorage + navigates to `/audit/<id>`.
4. **Brand**: "NoeticAI" everywhere (topbar mark + tray version line + page titles).

## Architecture

### Server addition

Extend `GET /api/subjects` to return `glyph`, `term`, and `totals: { concepts, covered, partial, missing }`. Totals come from the latest succeeded audit run per subject; zeroed when none exists.

Shape:
```ts
GET /api/subjects → {
  subjects: Array<{
    id: string;
    name: string;
    course: string | null;
    term: string | null;
    glyph: string | null;
    totals: { concepts: number; covered: number; partial: number; missing: number };
  }>
}
```

### Web — query layer

- `apps/web/src/api/subjects.ts` — new file (or extend if it exists), exports `getSubjects()` + `Subject` type matching the BE shape above.

### Web — hooks (`apps/web/src/lib/`)

- `useActiveSubject()` — URL → localStorage → `subjects[0]` → null. Returns `{ activeSubjectId, activeSubject, setActiveSubjectId, subjects, isLoading }`. `setActiveSubjectId(id)` writes localStorage + navigates to `/audit/<id>`.
- `useTopGapConcept(subjectId | null)` — reuses existing `getAuditLatest`; derives `units.flatMap(u => u.concepts).find(c => c.state === 'red') ?? amber ?? null`. Returns `conceptId | null`.
- `routeToBreadcrumbs(pathname, subject) → string[]` — pure function, table-driven, no hook.

### Web — shell components (`apps/web/src/components/shell/`)

**`Topbar.tsx`** (translates `design/shell.jsx` lines 3–75)
- Left: `NoeticAI` mark + `v0.0 · phase 5` tag.
- Center: breadcrumbs from `routeToBreadcrumbs(pathname, activeSubject)`.
- Right: `<SubjectSwitcher />` pill (glyph + name + chevron + dropdown listing all subjects with coverage strip + counts) + stub search icon (no-op) + avatar showing user initials from `/api/me`.

**`NavRail.tsx`** (translates lines 77–143 to `<Link>`s)

| Group | Row | Target | Count | Disabled when |
|---|---|---|---|---|
| Audit | Coverage spine | `/audit/$subjectId` | `partial + missing` (alert) | no active subject |
| | Constellation | `/map/$subjectId` | — | no active subject |
| | Concept detail | `/concept/$topGapConceptId` | — | no top gap |
| Notes | Note augmentation | `/note/$noteRef` (most-recent) | open-gap count if available | no notes |
| Sources | Bibliography | `/bibliography?subjectId=...` | sources count | no active subject |
| | Syllabus | `/onboarding?subjectId=...` (syllabus step) | — | — |
| Account | Plan & usage | `/plan` | — | — |
| | Settings | `/settings` | — | — |
| System | Setup | `/onboarding` | — | — |

Active row via `useMatch`. Disabled rows render gray with tooltip. Nav-foot status block ("Notion · synced 2m / N chunks · M sources") data-driven; gracefully omitted when data absent.

**`SystemTray.tsx`** (translates lines 145–157)
- Left: `NoeticAI · v0.0-phase5` + `subject.course`.
- Right items:
  - "Vector index ready" — green dot, shown if subjects loaded.
  - Conflicts pill — hidden until Phase 7b.
  - Gaps pill — `totals.missing` (red dot).
  - "N/M concepts engaged" — `(covered + partial)/total`.

### Rendering flow in `_auth.tsx`

1. `/api/me` guard (unchanged).
2. Load `useSubjects()` + `useActiveSubject()`. If `subjects.length === 0` AND route ≠ `/onboarding` → redirect to `/onboarding`.
3. Render shell skeleton immediately; dynamic parts show "…" until queries resolve.
4. Pass `{ subjects, activeSubject, topGapConceptId }` to `<Topbar />`, `<NavRail />`, `<SystemTray />`.
5. `<Outlet />` for the route content.

### CSS

Zero new styles. All className tokens (`topbar`, `topbar-brand`, `topbar-mark`, `topbar-tag`, `topbar-bread`, `sep`, `here`, `topbar-right`, `subject-pill`, `glyph`, `nav`, `nav-section`, `nav-cap`, `nav-row`, `nav-row.active`, `nav-icon`, `nav-count`, `nav-count.alert`, `nav-foot`, `nav-status`, `tray`, `tray-item`, `dot`, `dot.amber`, `dot.red`, `spacer`) are defined in `design/styles.css` already imported globally.

## Out of scope (v1.1)

- Multi-device active-subject sync (no `users.last_active_subject_id` column).
- Search affordance (icon shown, click is a no-op).
- Conflict count in tray (lands with Phase 7b).
- Notion-sync timestamp (lands with Phase 6 real connector).

## Testing

- `pnpm typecheck` green across workspaces.
- Manual: from `/`, NavRail visible with all 9 rows + counts; subject switcher dropdown lists subjects; breadcrumbs reflect each route; concept-detail row clicks through to a real concept page.
- Empty state: with zero subjects, lands on `/onboarding`.
