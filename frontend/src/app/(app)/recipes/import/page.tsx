'use client'

import Link from 'next/link'
import { Button, Card, PageHeader, UploadZone, useToast } from '@/components/ui'
import { RequireRole } from '@/components/layout/RequireRole'

function RecipeImportPage() {
  const toast = useToast()

  return (
    <>
      <PageHeader
        title="Bulk Recipe Import"
        subtitle="Upload multiple recipe files at once"
        actions={
          <Link href="/recipes" className="text-sm text-text-muted underline hover:text-text">
            Cancel
          </Link>
        }
      />

      <Card className="space-y-4">
        <div className="text-center">
          <h2 className="section-title text-lg font-semibold">Select Recipe Files</h2>
          <p className="mt-1 text-sm text-text-muted">
            Upload one or more recipe documents. Supports .txt, .md, .doc, .docx, and .pdf files.
          </p>
        </div>

        <UploadZone
          formats={['TXT', 'MD', 'DOCX', 'PDF', 'JPG', 'PNG', 'HEIC']}
          hint="Drag and drop recipe files or images here"
          onFiles={() => toast('info', 'Recipe import is not available yet')}
        />

        <div className="rounded-lg border-l-4 border-info bg-info-100 p-4 text-sm text-info-700 dark:bg-info-900/40 dark:text-info-100">
          <p className="font-semibold">Reading recipes arrives with document processing</p>
          <p className="mt-1">
            Uploaded files will be read for names, portions, ingredients and quantities. Every
            extracted value is shown for review, and nothing is saved to your recipes until you
            confirm it.
          </p>
        </div>

        <div className="flex justify-center">
          <Link href="/recipes/new">
            <Button variant="secondary">Create a recipe by hand instead</Button>
          </Link>
        </div>
      </Card>
    </>
  )
}

export default function Page() {
  return (
    <RequireRole minRole="staff">
      <RecipeImportPage />
    </RequireRole>
  )
}
