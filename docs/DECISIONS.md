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

## Ongoing Decisions
- To be documented as project progresses