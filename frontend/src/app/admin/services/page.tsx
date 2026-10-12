'use client'

import { useQuery } from '@tanstack/react-query'
import { Badge, PageHeader, Table, TableEmpty, TBody, TD, TH, THead, TR } from '@/components/ui'
import type { IntegrationService } from '@/lib/api/types'
import { queries } from '@/lib/api/queries'

const SERVICE_LABEL: Record<IntegrationService, string> = {
  documents: 'Document reading',
  storage: 'File storage',
  mail: 'Email',
  billing: 'Subscription billing',
  errors: 'Error monitoring',
}

const PROVIDER_LABEL: Record<string, string> = {
  stub: 'Stand-in',
  none: 'Not connected',
  local: 'Server disk',
  gemini: 'Gemini',
  claude: 'Claude',
  s3: 'S3',
  resend: 'Resend',
  stripe: 'Stripe',
  bugsnag: 'BugSnag',
}

export default function AdminServicesPage() {
  const { data, isLoading } = useQuery(queries.adminIntegrations())

  return (
    <>
      <PageHeader
        title="Services"
        subtitle={
          data
            ? `What each outside service runs on in this ${data.environment} environment. A stand-in costs nothing and reaches nobody; keys are never shown here.`
            : 'What each outside service runs on in this environment.'
        }
      />

      <Table>
        <THead>
          <TR>
            <TH>Service</TH>
            <TH>Provider</TH>
            <TH>Mode</TH>
            <TH>What it means</TH>
          </TR>
        </THead>
        <TBody>
          {isLoading && <TableEmpty colSpan={4}>Loading services…</TableEmpty>}
          {data?.services.map((s) => (
            <TR key={s.service}>
              <TD className="font-medium">{SERVICE_LABEL[s.service]}</TD>
              <TD>{PROVIDER_LABEL[s.provider] ?? s.provider}</TD>
              <TD>
                <Badge tone={s.live ? 'success' : 'slate'}>{s.live ? 'Live key' : 'No key'}</Badge>
              </TD>
              <TD className="text-sm text-text-muted">{s.note}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  )
}
