import type { Metadata } from 'next'
import RecipeDetailView from './RecipeDetailView'

export const metadata: Metadata = { title: 'Recipe' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RecipeDetailView id={id} />
}
