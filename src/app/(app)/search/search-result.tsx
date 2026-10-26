import { notFound } from 'next/navigation'
import { Circle, Building2, FileText, AlertCircle } from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, EmptyState } from '@/components/ui'

type SearchResultProps = {
  query: string
}

type Institution = {
  id: string
  name: string
  city: string | null
}

type Complaint = {
  id: string
  complaint_reference: string
  institution_id: string | null
  bureau: string
  category: string
  priority: string
  status: string
  subject: string
  date_received: string | null
}

export async function getSearchResults(query: string) {
  if (!query.trim()) notFound()

  const like = `%${query}%`

  const res = await fetch(
    `https://${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sql`,
    {
      method: 'POST',
      headers: {
        apiKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          select
            c.id,
            c.complaint_reference,
            c.institution_id,
            i.name as institution_name,
            c.bureau,
            c.category,
            c.priority,
            c.status,
            c.subject,
            c.date_received
          from complaints c
          left join institutions i on i.id = c.institution_id
          where
            c.subject ilike $1
            or c.complaint_reference ilike $1
            or c.bureau ilike $1
            or i.name ilike $1
          order by
            case
              when c.complaint_reference ilike $1 then 0
              when i.name ilike $1 then 1
              else 2
            end,
            c.date_received desc
          limit 30
        `,
        parameters: [like],
      }),
    }
  )

  if (!res.ok) {
    throw new Error(`Search failed: ${res.status}`)
  }

  const rows: Array<{
    id: string
    complaint_reference: string
    institution_id: string | null
    institution_name: string | null
    bureau: string
    category: string
    priority: string
    status: string
    subject: string
    date_received: string | null
  }> = await res.json()

  const institutions: Institution[] = []
  const complaints: Complaint[] = []

  for (const r of rows) {
    if (r.institution_id && r.institution_name) {
      institutions.push({
        id: r.institution_id,
        name: r.institution_name,
        city: null,
      })
    }
    complaints.push({
      id: r.id,
      complaint_reference: r.complaint_reference,
      institution_id: r.institution_id,
      bureau: r.bureau,
      category: r.category,
      priority: r.priority,
      status: r.status,
      subject: r.subject,
      date_received: r.date_received,
    })
  }

  return { institutions, complaints }
}

export async function SearchResult({ query }: SearchResultProps) {
  let results
  try {
    results = await getSearchResults(query)
  } catch (err) {
    return (
      <div className="brutal-card border-[var(--terracotta)] bg-[var(--peach)] p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 shrink-0 text-[var(--terracotta)]" size={20} />
          <div>
            <h2 className="text-base font-bold text-[var(--ink)]">Search error</h2>
            <p className="mt-1 text-sm text-[var(--ink)]">
              {err instanceof Error ? err.message : 'Something went wrong while searching.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const institutionRows = results.institutions.map((inst) => ({
    id: inst.id,
    name: inst.name,
    city: inst.city ?? '—',
  }))

  const complaintRows = results.complaints.map((c) => ({
    id: c.id,
    complaint_reference: c.complaint_reference,
    institution_name: c.institution_id ?? '—',
    bureau: c.bureau,
    category: c.category,
    priority: c.priority,
    status: c.status,
    subject: c.subject,
    date_received: c.date_received
      ? new Date(c.date_received).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '—',
  }))

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Results for “${query}”`}
        subtitle={`${institutionRows.length} institution${institutionRows.length === 1 ? '' : 's'} · ${complaintRows.length} complaint${complaintRows.length === 1 ? '' : 's'}`}
      />

      {institutionRows.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Institutions
          </h2>
          <DataTable
            columns={[
              {
                header: 'Institution',
                cell: (row) => (
                  <div className="flex items-center gap-2">
                    <Building2 className="shrink-0 text-[var(--muted)]" size={15} />
                    <span>{row.name}</span>
                  </div>
                ),
              },
              {
                header: 'City',
                cell: (row) => <span className="tabular">{row.city}</span>,
              },
            ]}
            rows={institutionRows}
            rowKey={(row) => row.id}
            caption="Institutions matching the search query."
          />
        </div>
      )}

      {complaintRows.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Complaints
          </h2>
          <DataTable          columns={[
              {
                header: 'Reference',
                cell: (row) => (
                  <span className="font-mono text-[var(--ink)]">{row.complaint_reference}</span>
                ),
              },
              {
                header: 'Institution',
                cell: (row) => <span>{row.institution_name}</span>,
              },
              {
                header: 'Bureau',
                cell: (row) => <span>{row.bureau}</span>,
              },
              {
                header: 'Category',
                cell: (row) => <span>{row.category}</span>,
              },
              {
                header: 'Priority',
                cell: (row) => (
                  <span
                    className={`inline-flex items-center rounded-[4px] border-2 border-[var(--ink)] px-2 py-0.5 text-xs font-semibold ${
                      row.priority === 'Urgent'
                        ? 'bg-[var(--orange-deep)] text-white'
                        : row.priority === 'High'
                          ? 'bg-[var(--orange)] text-[var(--ink)]'
                          : row.priority === 'Medium'
                            ? 'bg-[var(--sand)] text-[var(--ink)]'
                            : 'bg-[var(--surface)] text-[var(--ink)]'
                    }`}
                  >
                    {row.priority}
                  </span>
                ),
              },
              {
                header: 'Status',
                cell: (row) => <StatusBadge status={row.status} />,
              },
              {
                header: 'Subject',
                cell: (row) => <span>{row.subject}</span>,
              },
              {
                header: 'Received',
                cell: (row) => (
                  <span className="tabular text-[var(--muted)]">{row.date_received}</span>
                ),
              },
            ]}
            rows={complaintRows}
            rowKey={(row) => row.id}
            caption="Complaints matching the search query."
          />
        </div>
      )}

      {institutionRows.length === 0 && complaintRows.length === 0 && (
        <EmptyState
          title="No results"
          detail={`No institutions or complaints matched “${query}”. Try a different term, or check the spelling.`}
        />
      )}
    </div>
  )
}
