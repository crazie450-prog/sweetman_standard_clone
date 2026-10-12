import type { Metadata } from 'next'
import MenuDetailView from './MenuDetailView'

export const metadata: Metadata = { title: 'Menu' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MenuDetailView id={id} />
}
