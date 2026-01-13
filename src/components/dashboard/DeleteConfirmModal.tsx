'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle } from 'lucide-react';

interface DeleteConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  loading?: boolean;
  title?: string;
  description?: string;
  itemCount?: number;
  itemType?: 'document' | 'link' | 'mixed';
}

export function DeleteConfirmModal({
  open,
  onOpenChange,
  onConfirm,
  loading = false,
  title,
  description,
  itemCount = 1,
  itemType = 'document',
}: DeleteConfirmModalProps) {
  const getDefaultTitle = () => {
    if (itemType === 'mixed') {
      return `Delete ${itemCount} items?`;
    }
    return itemCount === 1
      ? `Delete this ${itemType}?`
      : `Delete ${itemCount} ${itemType}s?`;
  };

  const getDefaultDescription = () => {
    if (itemType === 'document' || itemType === 'mixed') {
      return 'This will permanently delete the selected items and all associated vector embeddings from the knowledge base. This action cannot be undone.';
    }
    return 'This will permanently delete the selected links. This action cannot be undone.';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-md w-full rounded-2xl shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-red-50 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-gray-900">
                {title || getDefaultTitle()}
              </DialogTitle>
            </div>
          </div>
          <DialogDescription className="text-gray-500 mt-3">
            {description || getDefaultDescription()}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex justify-end gap-3 mt-6">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="text-gray-500"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
