import { Skeleton } from '@/components/ui/skeleton';

export function DocumentsTableSkeleton() {
  return (
    <div className="space-y-0">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex gap-4">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="p-4 border-b border-gray-50 flex items-center gap-4">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-24" />
          <div className="flex items-center gap-2 flex-1">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-8" />
        </div>
      ))}
    </div>
  );
}

