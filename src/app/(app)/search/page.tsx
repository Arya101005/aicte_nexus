import { Suspense } from 'react'
import { AlertTriangle, Building2, FileText, Search } from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, EmptyState, LoadingSkeleton, ErrorState } from '@/components/ui'
import { getSupabaseData } from '@/lib/getSupabaseData/headless'
import { SearchResult } from './search-result'

export const metadata = {
  title: 'Search',
  description: 'Search institutions, complaints, and source references.',
}

type SearchPageProps = {
  params: { q?: string }
  searchParams: { q?: string }
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const q = searchParams.q?.trim() ?? ''

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        label="Workspace search"
        title="Search"
        subtitle="Search across institutions, complaints, and source references."
      />

      {q ? (
        <SearchResult query={q} />
      ) : (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="w-28 opacity-80">
            <Search className="h-12 w-12 text-[var(--orange-deep)]" aria-hidden="true" />
          </div>
          <p className="max-w-sm text-sm text-[var(--muted)]">
            Enter a search term above to look up institutions, complaint references, and subjects.
          </p>
        </div>
      )}
    </div>
  )
}

export function SearchPageSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        label="Workspace search"
        title="Search"
        subtitle="Search across institutions, complaints, and source references."
      />
      <LoadingSkeleton rows={6} />
    </div>
  )
}
