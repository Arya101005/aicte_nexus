# AICTE Nexus - Decisions Log

## Initial Setup Decisions

### Stack
- **Next.js 16.4.3 with App Router** - chosen for full-stack capabilities, server components, and middleware
- **TypeScript strict** - for type safety across the full stack
- **Tailwind CSS v4** - for utility-first styling with custom Surreal Orange tokens
- **shadcn/ui** - for accessible, pre-built components that can be customized
- **Lucide** - for icon set
- **react-hook-form + Zod** - for form handling with validation
- **Recharts** - for charts
- **@tanstack/react-table** - for data tables with server-side support
- **Supabase** - for Postgres, Auth, RLS (chosen over direct Postgres for easier setup)

### Design System
- **Neo-Brutalist + Surrealist + Warm Orange palette** - as specified
- **Tokens defined in tailwind.config.ts** with CSS variables: ink, paper, sand, orange, orange-deep, apricot, peach, terracotta, teal, indigo, muted, line
- **Space Grotesk + Inter fonts** via next/font
- **JetBrains Mono** for complaint references (optional, added later)

### Supabase Choices
- **Row Level Security (RLS)** on all tables
- **Profiles table** storing user role (admin, bureau_official, reviewer, read_only)
- **JWT claims** for role assignment
- **No separate backend service** - all logic via Supabase + Next.js Route Handlers + Server Actions

### Key Design Decisions

1. **Auth**: Server-side session validation on every protected route. Client guards are cosmetic only. Roles stored in `profiles` table; users cannot self-escalate.

2. **RLS**: Enable on every table. Policies per role and Bureau scope. Audit tables are insert-only for normal roles (no update/delete).

3. **Constraints**:
   - Foreign keys on complaint-institution, complaint-bureau relationships
   - NOT NULLs where appropriate
   - CHECKs for status/priority/date logic
   - Unique constraint on `(source_system, source_reference)` for complaints
   - Unique constraint on institution identifiers

4. **CSV Safety**: Neutralize formula injection (prefix cells starting with `=`, `+`, `-`, `@`, tab, CR) on export; validate and size-limit on import.

5. **Transactions**: Complaint updates requiring audit entry must write both atomically (Postgres function/RPC).

6. **No auto-merging** of institution matches. Show matching factors, conflicting fields, match category (Strong / Possible / Weak), and recommended action.

7. **No model training** on unreviewed data. Small labelled fixture set only.

8. **SLA**: No invented official deadlines. With no rule, show case age and never label it overdue.

9. **Attention state** computed in SQL (view or function), not in browser.

10. **Reports**: Server-side filtering and aggregation. Permission-aware CSV export. Label any metric from synthetic/incomplete data.

11. **Design system**: Orange is accent, not flood. Max two accent colors per component. Status always icon + text + color, never color alone.

12. **Motion**: All wrapped in `@media (prefers-reduced-motion: no-preference)`. Nothing flashes; nothing continuous over data regions.

13. **Accessibility**: Semantic landmarks, skip link, keyboard navigation, visible focus ring (3px orange-deep outline with offset), focus-trapped dialogs, labelled inputs with aria-describedby errors.

14. **Responsive**: Sidebar collapses to drawer under lg; cards stack; tables become labelled card rows on mobile; no horizontal overflow; touch targets ≥ 44px.

## Phase 2 Decisions (security & data integrity)

15. **Migration verification harness**: Docker is not available in this environment, so `supabase start` cannot run, and native Postgres cluster backends crash with DLL-init errors here. Migrations and RLS are therefore verified against **PGlite** (real Postgres compiled to WASM) via `scripts/verify-migrations.mjs` (`npm run verify:db`), which bootstraps the Supabase runtime pieces the migrations depend on (roles `anon`/`authenticated`/`service_role`, the `auth` schema, `auth.uid()`), applies migrations + seed on a clean database, and runs 42 assertions covering idempotent seeding, RLS role/bureau isolation, audit immutability, RPC atomicity (forced audit failure rolls back the complaint update) and constraint enforcement. Applying migrations to the real Supabase project remains a manual step until credentials are available (listed under "Not verified").

16. **Function creation order**: `current_user_role()`/`current_user_bureau()` are created *after* `public.profiles`. SQL-language function bodies have their relations resolved at creation time (`check_function_bodies`), so creating them earlier fails with `relation "public.profiles" does not exist`.

17. **`anon` can execute the role helpers and `update_complaint_with_audit`**: without it a signed-out caller gets a raw `permission denied for function ...` instead of the designed friendly "You are signed out" message. The helpers only return the caller's own role/bureau derived from their own JWT subject, and the RPC raises before touching any row; RLS still applies to everything after that.

18. **Seed file**: `supabase/seed.sql` is fully synthetic (labelled in its header, every row prefixed `SYN-`/"Synthetic") and idempotent — re-running it changes no row counts (asserted by the harness). Demo logins use `@nexus.local` addresses with `Demo123!` and are documented as local-development-only.

19. **CSV safety** lives in `src/lib/csv.ts`: export path neutralizes cells starting with `=`, `+`, `-`, `@`, tab, CR (prefix `'`) and RFC 4180-quotes them; import path (`parseCsv`) enforces a 5 MiB byte limit, 50 000-row limit and 64-column limit, strips BOM, and throws `CsvParseError` with row/column context so callers can show a friendly message and log details server-side.

20. **Attention-state precedence** (implemented in `public.complaint_attention_state`): Resolved/Closed → Normal; no matching SLA rule → Normal (age is shown, never "Overdue"); age beyond escalation threshold → Escalation Review Required; past effective due date → Overdue; no activity beyond `stale_days` → Stale; within warning window → Approaching Deadline; else Normal. Escalation is checked before overdue so old, ignored cases surface first.

## Phase 3 Decisions (core intelligence)

21. **Identity matching order** (implemented in `public.find_institution_matches`): source mapping (verified or pending) → exact normalized-name match → `pg_trgm` similarity with a 0.4 floor, `>= 0.65` labelled **Possible**, below that **Weak** (real similarity values, no fake probabilities). Matching only ever *proposes*: `propose_institution_matches` records pending candidates (idempotent per input+institution), `decide_identity_review` records confirm/reject **with a required reason**; confirming links the source identifier in the same transaction and refuses to re-point a mapping that belongs to a different institution. Nothing is deleted.

22. **Duplicate classification split**: SQL (`get_duplicate_candidate_pairs`) only *narrows* candidates with deterministic filters (same institution + same category, or subject similarity ≥ 0.45) and supplies `pg_trgm` similarity; the label + human-readable reason come from the pure function `classifyDuplicatePair` in `src/lib/duplicates.ts` so it is testable against the labelled fixture set (`src/lib/duplicate-fixtures.ts`, 12 fixtures, precision/recall reported in Phase 7). The engine never emits "Confirmed duplicate" — confirmation is a reviewer decision. Same institution alone never yields a suggestion.

23. **Duplicate pair identity is direction-insensitive**: unique on `(least(complaint_id, candidate_id), greatest(...))`, so scanning A→B and B→A is one review. `upsert_duplicate_review` never overwrites an existing pair (a reviewed/dismissed decision is final), and reviewed pairs are excluded from future candidate scans.

24. **Coordination flags**: generated by `refresh_coordination_flags` (SECURITY DEFINER — flags must see all bureaus; callable only by admin/reviewers/service role). Dedupe rule: a **pending or accepted** flag of the same type blocks re-raising (no nagging loop); a **dismissed** flag may re-raise when data changes. `approaching_deadline` carries both approaching and overdue states (the enum is fixed; evidence records which). Workflow adds `assigned_to`; assign and decide both write a `complaint_audit` row so every step lands on the case timeline. Two 0001 policies widened for this: reviewers may insert `complaint_audit` rows and confirm `institution_identifiers` links.

25. **Attention-state inputs are exposed** on `v_complaint_sla` (`sla_warning_threshold` … `sla_stale_days`) so the UI and flag explanations can show *why* something counts as due or stale without recomputing in the browser.

26. **Pages belong to Phase 5** (master prompt section 7 lists all pages there); Phase 3 ships the verified backend intelligence — RPCs, views, classifier — which the Phase 5 pages call.

27. **`normalized_subject`** is a SQL generated column (immutable-unaccent, lowercase); `normalizeSubject()` in TypeScript mirrors it with NFD combining-mark stripping. ASCII subjects match exactly; exotic transliterations are decided by SQL similarity, never by the TS mirror.

## Phase 4 Decisions (operational monitoring)

28. **Migration `20250101000004_operations.sql`**: notifications, `import_jobs`/`import_errors`, the `import_complaints` batch upsert RPC, and the health/quality/SLA/report views. `import_complaints` takes a `jsonb` array of already-validated drafts, upserts on `(source_system, source_reference)` (`excluded`-style: created/updated/unchanged counted per row), and returns counts — so re-importing the same file creates zero duplicates (harness asserts row counts unchanged after a second import).

29. **Idempotency is decided in SQL, not the app**: `import_complaints` compares every column against the existing row and reports `unchanged` without writing, so a repeated upload costs no audit noise and produces honest counts. Rejected rows never touch `complaints`; they land in `import_errors` with row/field/reason.

30. **Attention states and health states are SQL views** (`v_complaint_sla`, `v_data_health`, `v_import_health`): the browser never recomputes due/stale logic. `Not configured` is distinct from `Healthy` — configured ≠ healthy; a source with no recent successful job reports `Delayed`/`Failed` from job history.

31. **TS adapter layer** (`src/lib/import/adapters.ts`): `parseComplaintCsv`/`parseComplaintJson` → `validateComplaintRows` → normalized drafts. CSV headers are strict (unknown column → `CsvParseError`); JSON records tolerate extra keys (common in JSON exports). Validation errors carry row + field + friendly reason for `import_errors`. Formula neutralization stays **export-side only** — imports store cells raw (harness/test asserts `=SUM(A1)` survives import untouched); escaping on import would corrupt source data.

32. **Institution name normalization** (`src/lib/institutions.ts`) mirrors the SQL generated column: trim, collapse whitespace, NFD-strip combining marks, lowercase, punctuation removed. `namesExactMatch` is the TS twin of the SQL normalized-name exact match used by identity resolution.

33. **`last_activity_at` trigger precedence**: assignment updates legitimately bump activity, but an *explicitly supplied* value (seed/backfill) wins over the trigger's default bump — implemented as `COALESCE(new.last_activity_at, now())` logic in `t_complaints_activity`.

34. **Harness verified**: `npm run verify:db` now runs 126 checks on a clean PGlite database — including double-import idempotency, notification dedupe, data-health states, quality metrics, SLA aggregates and permission-aware report views.

## Ongoing Decisions
- To be documented as project progresses