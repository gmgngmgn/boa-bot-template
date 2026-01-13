import { Suspense } from 'react';
import { MetadataFieldsManager } from '@/components/dashboard/MetadataFieldsManager';
import { Skeleton } from '@/components/ui/skeleton';

export default function SettingsPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <Suspense fallback={<Skeleton className="h-96 w-full bg-white rounded-xl" />}>
        <MetadataFieldsManager />
      </Suspense>
    </div>
  );
}
