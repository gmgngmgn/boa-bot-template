'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type Document = {
  id: string;
  user_id: string;
  filename: string;
  source_type: 'video' | 'audio' | 'pdf' | 'youtube' | 'document';
  source_url: string | null;
  status: 'processing' | 'completed' | 'error';
  transcript_text: string | null;
  metadata: any;
  created_at: string;
  updated_at: string;
};

interface IngestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: Document;
  onSuccess: () => void;
}

export function IngestModal({ open, onOpenChange, document, onSuccess }: IngestModalProps) {
  const [targetTable, setTargetTable] = useState('vector_documents');
  const [externalLink, setExternalLink] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/documents/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: document.id,
          targetTable,
          externalLink: externalLink || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start ingestion');
      }

      const { taskId } = await response.json();
      
      toast.success('Ingestion started', {
        description: `Task ID: ${taskId}`,
      });

      onSuccess();
    } catch (error) {
      toast.error('Failed to start ingestion', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white">
        <DialogHeader>
          <DialogTitle>Ingest Document</DialogTitle>
          <DialogDescription className="text-gray-400">
            Configure ingestion settings for this document
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Target Table */}
          <div className="space-y-2">
            <Label htmlFor="targetTable">Target Table *</Label>
            <Select value={targetTable} onValueChange={setTargetTable}>
              <SelectTrigger className="bg-gray-800 border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-700">
                <SelectItem value="vector_documents">vector_documents</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* External Link */}
          <div className="space-y-2">
            <Label htmlFor="externalLink">External Link (optional)</Label>
            <Input
              id="externalLink"
              type="url"
              placeholder="https://example.com/resource"
              value={externalLink}
              onChange={(e) => setExternalLink(e.target.value)}
              className="bg-gray-800 border-gray-700"
            />
            <p className="text-sm text-gray-500">
              This link will be added to metadata for reference and included in search results.
            </p>
          </div>

          {/* Document Info */}
          <div className="rounded-lg bg-gray-800/50 p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Document:</span>
              <span className="text-gray-300">{document.filename}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Type:</span>
              <span className="text-gray-300 capitalize">{document.source_type}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Status:</span>
              <span className="text-gray-300 capitalize">{document.status}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-yellow-500 hover:bg-yellow-600 text-gray-900"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Starting...
                </>
              ) : (
                'Start Ingestion'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

