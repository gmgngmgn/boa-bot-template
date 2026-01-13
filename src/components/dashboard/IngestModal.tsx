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
  const [targetTable, setTargetTable] = useState('documents');
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
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-lg w-full rounded-2xl shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-gray-900">Ingest Document</DialogTitle>
          <DialogDescription className="text-gray-500">
            Configure ingestion settings for this document
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Target Table */}
          <div className="space-y-2">
            <Label htmlFor="targetTable">Target Knowledge Base *</Label>
            <Select value={targetTable} onValueChange={setTargetTable}>
              <SelectTrigger className="bg-gray-50 border-gray-200 focus:border-gray-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-gray-200">
                <SelectItem value="documents">
                  <div className="flex flex-col">
                    <span>Main Knowledge Base</span>
                    <span className="text-xs text-gray-400">documents table</span>
                  </div>
                </SelectItem>
                <SelectItem value="student_documents">
                  <div className="flex flex-col">
                    <span>Student Knowledge Base</span>
                    <span className="text-xs text-gray-400">student_documents table</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-gray-500">
              Choose which knowledge base to add this content to.
            </p>
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
              className="bg-gray-50 border-gray-200 focus:border-gray-300"
            />
            <p className="text-sm text-gray-500">
              This link will be added to metadata for reference and included in search results.
            </p>
          </div>

          {/* Document Info */}
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Document:</span>
              <span className="text-gray-900 font-medium text-right">{document.filename}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Type:</span>
              <span className="text-gray-900 capitalize">{document.source_type}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Status:</span>
              <span className="text-gray-900 capitalize">{document.status}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
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
              type="submit"
              className="bg-black text-white hover:bg-gray-900"
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

