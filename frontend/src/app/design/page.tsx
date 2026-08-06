'use client'

import { useState } from 'react'
import { RequireRole } from '@/components/layout/RequireRole'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  FilterBar,
  IconButton,
  KpiCard,
  Modal,
  PageHeader,
  SearchInput,
  SelectField,
  StatusBadge,
  Stepper,
  Table,
  TBody,
  TD,
  TextField,
  TH,
  THead,
  ToastProvider,
  TR,
  UploadZone,
  useToast,
  type DocumentStatus,
  type PeriodPreset,
} from '@/components/ui'

const statuses: DocumentStatus[] = [
  'queued',
  'processing',
  'completed',
  'failed',
  'requires_review',
  'partially_processed',
]

function Gallery() {
  const [modalOpen, setModalOpen] = useState(false)
  const [preset, setPreset] = useState<PeriodPreset>('Last 30 days')
  const toast = useToast()

  return (
    <main className="mx-auto max-w-5xl space-y-10 p-8">
      <PageHeader
        title="Nexus UI — Component Gallery"
        subtitle="Shared UI primitives and design tokens"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => document.documentElement.classList.toggle('dark')}
            >
              Toggle theme
            </Button>
            <Button onClick={() => toast('success', 'Saved successfully')}>Show toast</Button>
          </>
        }
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Buttons</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <IconButton aria-label="Settings">
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-5" aria-hidden>
              <path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM10 8.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM11.5 15.5a1.5 1.5 0 10-3 0 1.5 1.5 0 003 0z" />
            </svg>
          </IconButton>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">KPI Cards</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Total Recipes" value="128" tone="primary" icon={<span>🧾</span>} />
          <KpiCard
            label="Food Cost %"
            value="31.4%"
            hint="target 30%"
            tone="warning"
            icon={<span>%</span>}
          />
          <KpiCard label="Waste (30d)" value="$412.50" tone="danger" icon={<span>🗑</span>} />
          <KpiCard label="Margin" value="68.6%" tone="success" icon={<span>↑</span>} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Status badges (document processing)</h2>
        <div className="flex flex-wrap gap-2">
          {statuses.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
          <Badge tone="primary">Custom</Badge>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Forms</h2>
        <Card className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <TextField label="Ingredient name" placeholder="e.g. Olive Oil" required />
          <SelectField
            label="Unit"
            placeholder="Select unit…"
            options={[
              { value: 'kg', label: 'Kilogram' },
              { value: 'l', label: 'Litre' },
              { value: 'ea', label: 'Each' },
            ]}
          />
          <TextField label="Cost per unit" error="Must be a positive number" defaultValue="-3" />
          <TextField label="SKU" help="Optional vendor code" />
          <Checkbox label="Active ingredient" defaultChecked />
          <SearchInput placeholder="Search ingredients…" />
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Filters + Table</h2>
        <FilterBar preset={preset} onPreset={setPreset} onClear={() => setPreset('Last 30 days')} />
        <Table>
          <THead>
            <TR>
              <TH>Recipe</TH>
              <TH>Cost</TH>
              <TH>Food cost %</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            <TR>
              <TD className="font-medium">Beef Wellington</TD>
              <TD>$12.40</TD>
              <TD>34%</TD>
              <TD>
                <StatusBadge status="completed" />
              </TD>
            </TR>
            <TR>
              <TD className="font-medium">Marinara Sauce</TD>
              <TD>$2.10</TD>
              <TD>18%</TD>
              <TD>
                <StatusBadge status="requires_review" />
              </TD>
            </TR>
          </TBody>
        </Table>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Stepper + Upload</h2>
        <Stepper steps={['Upload', 'Processing', 'Review', 'Complete']} current={1} />
        <UploadZone
          formats={['PDF', 'JPG', 'PNG', 'XLSX', 'DOCX']}
          onFiles={(f) => toast('info', `${f.length} file(s) selected`)}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Modal + Empty state</h2>
        <Button variant="secondary" onClick={() => setModalOpen(true)}>
          Open modal
        </Button>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Invite Team Member"
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setModalOpen(false)
                  toast('success', 'Invitation sent')
                }}
              >
                Send Invite
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <TextField label="Email" type="email" placeholder="chef@restaurant.com" required />
            <SelectField
              label="Role"
              options={[
                { value: 'manager', label: 'Restaurant Manager' },
                { value: 'chef', label: 'Executive Chef' },
                { value: 'member', label: 'Team Member' },
              ]}
            />
          </div>
        </Modal>
        <Card>
          <EmptyState
            title="No vendors yet"
            hint="Add your first vendor to start tracking invoices and prices."
            action={<Button>Add Vendor</Button>}
          />
        </Card>
      </section>
    </main>
  )
}

export default function DesignPage() {
  return (
    <RequireRole minRole="viewer">
      <ToastProvider>
        <Gallery />
      </ToastProvider>
    </RequireRole>
  )
}
