import { useQuery } from '@tanstack/react-query'
import { dayIn, today } from './date-range'
import { queries } from '@/lib/api/queries'

export function useRestaurantDay(): { today: string; latest: string } {
  const { data: org } = useQuery(queries.organization())
  const latest = dayIn(org?.timezone)
  const mine = today()
  return { today: mine < latest ? mine : latest, latest }
}
