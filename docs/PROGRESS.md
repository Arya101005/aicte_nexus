# AICTE Nexus - Progress Tracker

## Phase 1 - AUDIT
- [x] Inspect package.json, Next config, routes, components
- [x] Run install, typecheck, lint, tests, build, dev server
- [x] Smoke-test the app in a browser (basic home page)
- [x] Scan for exposed secrets (none found - fresh project)
- [x] Write audit into docs/AUDIT.md

## Phase 2 - SECURITY AND DATA INTEGRITY
- [x] Auth: server-side session validation framework established
- [x] Roles: admin, bureau_official, reviewer, read_only defined
- [x] RLS: policies defined for all tables
- [x] Constraints: foreign keys, NOT NULLs, CHECKs added
- [x] Transactions: atomic complaint updates with audit entries (`update_complaint_with_audit` RPC)
- [x] Errors: friendly messages, no stack traces (RPC raises friendly errors; harness-verified)
- [x] CSV safety: formula injection neutralization + size/row limits (`src/lib/csv.ts`)
- [x] Tests: RLS tests - 42/42 checks via `npm run verify:db` (PGlite harness, clean DB)

## Phase 3 - CORE INTELLIGENCE
- [x] Institution identity resolution — matching RPCs, review/confirm/reject workflow, no auto-merge
- [x] Duplicate and related-case detection — SQL candidate pairs + TS classifier + labelled fixture set (12 fixtures, P=1.00 R=1.00)
- [x] Cross-Bureau coordination — explainable flag refresh, reviewer assignment, audited decisions, grouped views
- [ ] Pages (Institutions / Cross-Bureau / Duplicate Review) — scheduled with Phase 5 per master prompt §7

## Phase 4 - OPERATIONAL MONITORING
- [ ] Ingestion and sync (pending)
- [ ] SLA monitoring (schema defined)
- [ ] Data Quality dashboard (pending)
- [ ] Notifications (pending)
- [ ] Reports (pending)

## Phase 5 - DESIGN SYSTEM: SURREAL ORANGE
- [x] Tokens defined (CSS variables + Tailwind)
- [ ] Neo-Brutalist primitives (pending UI implementation)
- [ ] Typography (Space Grotesk + Inter via next/font)
- [ ] Surreal illustration kit (pending)
- [ ] Motion (pending)
- [ ] Reusable components (pending)

## Phase 6 - PERFORMANCE AND ACCESSIBILITY
- [ ] Indexes for real query patterns (in migration)
- [ ] Server-side pagination, filtering, aggregation (pending)
- [ ] Server Components default (Next.js App Router)
- [ ] Accessibility (pending implementation)

## Phase 7 - TESTING
- [ ] Unit (Vitest) (pending)
- [ ] Integration (pending)
- [ ] E2E (Playwright) (pending)

## Phase 8 - GITHUB AND VERCEL
- [ ] Git status, branch, remote confirmed
- [ ] .gitignore covers .env*, .vercel, node_modules, .next
- [ ] .env.example created (pending)
- [ ] Commit in logical chunks (pending)
- [ ] Vercel: link project, set env vars, run vercel build, deploy (pending)
- [ ] Supabase: apply migrations, set Auth URLs, confirm RLS (pending)

## Phase 9 - FINAL VERIFICATION
- [ ] App runs on localhost with seeded synthetic data (pending)
- [ ] Typecheck, lint, tests and production build pass (passing so far)
- [x] Migrations reproduce schema from scratch (verified on clean PGlite DB: `npm run verify:db` 84/84)
- [ ] Re-import creates no duplicates (pending)
- [ ] Every dashboard number from database (pending)
- [ ] UI follows Surreal Orange system at 390px and 1440px (pending)
- [ ] Code pushed to GitHub (pending)
- [ ] Vercel deployment verified (pending)