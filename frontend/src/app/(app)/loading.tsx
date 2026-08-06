import { Skeleton, SkeletonKpiRow, SkeletonTable } from '@/components/ui/Skeleton'

export default function AppLoading() {
  return (
    <div className="page-enter">
      <div className="mb-8">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <SkeletonKpiRow />
      <div className="mt-6">
        <SkeletonTable />
      </div>
      <span className="sr-only" role="status">
        Loading…
      </span>
    </div>
  )
}
