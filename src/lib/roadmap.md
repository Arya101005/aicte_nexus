# AICTE Nexus — Push checklist

Already pushed:
- Commit `ec79b49` is on `origin/main`.
- `git rev-list --left-right --count origin/main...HEAD` is `0 0`.

What is still uncommitted in the working tree:
- Modified: `src/app/globals.css`, `src/app/layout.tsx`, `src/components/ui/index.tsx`, `src/lib/supabase.ts`, `supabase/seed.sql`
- Untracked: `src/lib/getSupabaseData/headless/index.ts`

What was committed and pushed:
- `scripts/check-ui-guardrail.sh`
- `src/app/(app)/layout.tsx`
- `src/app/(app)/search/page.tsx`
- `src/app/(app)/search/search-result.tsx`
- `src/components/app-shell.tsx`
- `src/components/surreal/index.tsx`
- `src/lib/roadmap.md`
- `src/lib/session.ts`

Build status:
- `npm run build` passes cleanly.
- Search is a page route at `/(app)/search`; the placeholder `/search/route.ts` was removed before shipping.
- The search page now awaits `searchParams` before reading `.q`, which fixes the dev/log warning about synchronous `searchParams` access.

Deploy status:
- A new `vercel deploy --prod` run will build from the existing committed snapshot on `origin/main` and give a live production URL.
- Live smoke check script lives at `scripts/smoke-prod.mjs`.
- The freebuff preview can be captured after that deployment is live.

Decisions still open:
- Should `src/lib/getSupabaseData/headless/index.ts` ship, be removed, or be moved into the existing data-layer convention?
- Do the unstaged edits in `globals.css`, `app/layout.tsx`, `components/ui/index.tsx`, `lib/supabase.ts`, and `supabase/seed.sql` belong in the next commit, or should some of them be separated out?

Next action if you want to keep going:
1. Run `vercel deploy --prod --yes` from this project root and grab the production URL it prints.
2. Smoke-test that URL with `TARGET_URL=<url> node scripts/smoke-prod.mjs`.
3. Decide whether `getSupabaseData/headless/index.ts` should ship or be cleaned up.
4. Stage only what should ship next and push again.
