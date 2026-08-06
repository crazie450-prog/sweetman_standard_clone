'use client'

import { Button, Card, EmptyState, PageHeader, SelectField, useToast } from '@/components/ui'
import { useQuery } from '@tanstack/react-query'
import { locationsService } from '@/lib/api/services'

export default function PullSheetsPage() {
  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: locationsService.list,
  })
  const toast = useToast()

  return (
    <>
      <PageHeader
        title="Pull Sheets"
        subtitle="Prepare stock pull lists for service"
        actions={
          <Button
            variant="primary"
            onClick={() => toast('info', 'Pull sheet creation is not available yet')}
          >
            New Pull Sheet
          </Button>
        }
      />

      <Card className="mb-6 flex flex-wrap items-end gap-3">
        <SelectField
          label="Property"
          className="w-64"
          options={locations.map((l) => ({ value: l.id, label: l.name }))}
        />
        <SelectField
          label="Service date"
          className="w-48"
          options={[
            { value: 'today', label: 'Today' },
            { value: 'tomorrow', label: 'Tomorrow' },
          ]}
        />
      </Card>

      <Card>
        <EmptyState
          title="No pull sheets for this property yet"
          hint="Create a pull sheet to plan what to pull from storage for service."
          action={
            <Button
              variant="primary"
              onClick={() => toast('info', 'Pull sheet creation is not available yet')}
            >
              New Pull Sheet
            </Button>
          }
        />
      </Card>
    </>
  )
}
