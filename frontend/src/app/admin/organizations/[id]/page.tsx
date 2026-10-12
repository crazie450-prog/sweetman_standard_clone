import type { Metadata } from 'next'
import AdminOrganizationView from './AdminOrganizationView'

export const metadata: Metadata = { title: 'Admin · Organization' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AdminOrganizationView id={id} />
}
