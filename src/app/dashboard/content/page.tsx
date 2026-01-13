import { Suspense } from 'react';
import { DocumentsTable } from '@/components/dashboard/DocumentsTable';
import { DocumentsTableSkeleton } from '@/components/dashboard/DocumentsTableSkeleton';

export default function ContentPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Content</h1>
      </div>
      
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <Suspense fallback={<DocumentsTableSkeleton />}>
          <DocumentsTable />
        </Suspense>
      </div>
    </div>
  );
}
