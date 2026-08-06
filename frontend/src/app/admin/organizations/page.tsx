import type { Metadata } from 'next'
import AdminOrganizationsView from './AdminOrganizationsView'

export const metadata: Metadata = { title: 'Admin · Organizations' }

export default function Page() {
  return <AdminOrganizationsView />
}
