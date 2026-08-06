'use client'

import { RequireRole } from '@/components/layout/RequireRole'

import { useState } from 'react'
import {
  Button,
  Card,
  Checkbox,
  PageHeader,
  SelectField,
  Stepper,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  UploadZone,
  useToast,
} from '@/components/ui'
import { useQuery } from '@tanstack/react-query'
import { orderGuideService } from '@/lib/api/services'

const STEPS = ['Upload', 'Sheets', 'Vendors', 'Products', 'Import']

function OrderGuideImportPage() {
  const { data: analysis } = useQuery({
    queryKey: ['order-guide-analysis'],
    queryFn: orderGuideService.analysis,
  })
  const detectedSheets = analysis?.sheets ?? []
  const detectedVendors = analysis?.detectedVendors ?? []
  const existingVendors = analysis?.existingVendors ?? []
  const detectedProducts = analysis?.products ?? []
  const [step, setStep] = useState(0)
  const [fileName, setFileName] = useState<string | null>(null)
  const [skippedSheets, setSkippedSheets] = useState<string[]>([])
  const [skippedProducts, setSkippedProducts] = useState<string[]>([])
  const toast = useToast()

  const sheets = detectedSheets.map((s) => s.name).filter((n) => !skippedSheets.includes(n))
  const products = detectedProducts.map((p) => p.name).filter((n) => !skippedProducts.includes(n))

  const toggle = (list: string[], set: (v: string[]) => void, name: string) =>
    set(list.includes(name) ? list.filter((n) => n !== name) : [...list, name])

  const reset = () => {
    setStep(0)
    setFileName(null)
    setSkippedSheets([])
    setSkippedProducts([])
  }

  return (
    <>
      <PageHeader
        title="Order Guide Import"
        subtitle="Import vendor order guides from Excel files"
      />

      <div className="mb-6">
        <Stepper steps={STEPS} current={step} />
      </div>

      {step === 0 && (
        <Card className="space-y-4">
          <h2 className="section-title text-lg font-semibold">Upload Order Guide</h2>
          <p className="text-sm text-text-muted">
            Upload an Excel file containing vendor order guides. The system will analyze sheets and
            extract vendor and product information.
          </p>
          <UploadZone
            hint="Drag and drop your Excel file here"
            formats={['.xlsx', '.xls']}
            onFiles={(files) => setFileName(files[0]?.name ?? 'order-guide.xlsx')}
          />
          <p className="text-xs text-text-muted">Supports .xlsx and .xls files</p>
          {fileName && (
            <p className="text-sm">
              Selected file: <span className="font-medium">{fileName}</span>
            </p>
          )}
          <div className="flex flex-wrap justify-end">
            <Button disabled={!fileName} onClick={() => setStep(1)}>
              Upload and Analyze
            </Button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card className="space-y-4">
          <h2 className="section-title text-lg font-semibold">Select Sheets</h2>
          <p className="text-sm text-text-muted">
            Select which sheets from the Excel file should be analyzed for vendor order guides.
          </p>
          <div className="grid grid-cols-1 gap-2">
            {detectedSheets.map((s) => (
              <Checkbox
                key={s.name}
                checked={sheets.includes(s.name)}
                onChange={() => toggle(skippedSheets, setSkippedSheets, s.name)}
                label={`${s.name} · ${s.rows} rows`}
              />
            ))}
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button disabled={sheets.length === 0} onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="space-y-4">
          <h2 className="section-title text-lg font-semibold">Match Vendors</h2>
          <p className="text-sm text-text-muted">
            Match detected vendors to existing vendors, or create new ones.
          </p>
          <Table>
            <THead>
              <TR>
                <TH>Detected vendor</TH>
                <TH>Sheet</TH>
                <TH>Match to</TH>
              </TR>
            </THead>
            <TBody>
              {detectedVendors.map((v, i) => (
                <TR key={v.detected}>
                  <TD className="font-medium">{v.detected}</TD>
                  <TD>{v.sheet}</TD>
                  <TD>
                    <SelectField
                      label={`Match for ${v.detected}`}
                      hideLabel
                      defaultValue={`v${i + 1}`}
                      options={existingVendors}
                      className="max-w-xs"
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button onClick={() => setStep(3)}>Continue</Button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card className="space-y-4">
          <h2 className="section-title text-lg font-semibold">Review Products</h2>
          <p className="text-sm text-text-muted">
            Review the detected products and select which ones to import.
          </p>
          <Table>
            <THead>
              <TR>
                <TH>
                  <span className="sr-only">Select</span>
                </TH>
                <TH>Product name</TH>
                <TH>Unit</TH>
                <TH>Price</TH>
              </TR>
            </THead>
            <TBody>
              {detectedProducts.map((p) => (
                <TR key={p.name}>
                  <TD>
                    <Checkbox
                      checked={products.includes(p.name)}
                      onChange={() => toggle(skippedProducts, setSkippedProducts, p.name)}
                      label=""
                      aria-label={`Import ${p.name}`}
                    />
                  </TD>
                  <TD className="font-medium">{p.name}</TD>
                  <TD>{p.unit}</TD>
                  <TD>{p.price}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button disabled={products.length === 0} onClick={() => setStep(4)}>
              Continue
            </Button>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card className="space-y-4">
          <h2 className="section-title text-lg font-semibold">Import Summary</h2>
          <ul className="space-y-1 text-sm">
            <li>
              File: <span className="font-medium">{fileName ?? 'order-guide.xlsx'}</span>
            </li>
            <li>
              Sheets selected: <span className="font-medium">{sheets.length}</span>
            </li>
            <li>
              Vendors matched: <span className="font-medium">{detectedVendors.length}</span>
            </li>
            <li>
              Products to import: <span className="font-medium">{products.length}</span>
            </li>
          </ul>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep(3)}>
              Back
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={reset}>
                Start Over
              </Button>
              <Button onClick={() => toast('info', 'Order guide import is not available yet')}>
                Import
              </Button>
            </div>
          </div>
        </Card>
      )}
    </>
  )
}

export default function Page() {
  return (
    <RequireRole minRole="staff">
      <OrderGuideImportPage />
    </RequireRole>
  )
}
