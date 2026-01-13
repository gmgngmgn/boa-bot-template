'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle2, XCircle, Loader2, MoreHorizontal, FileText } from 'lucide-react';
import { IngestModal } from './IngestModal';
import { format } from 'date-fns';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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

export function DocumentsTable() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ingestModalOpen, setIngestModalOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    fetchDocuments();
    
    const channel = supabase
      .channel('documents')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'documents',
      }, () => {
        fetchDocuments();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fromDate, toDate]);

  const fetchDocuments = async () => {
    setLoading(true);
    let query = supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false });

    if (fromDate) query = query.gte('created_at', fromDate);
    if (toDate) query = query.lte('created_at', toDate);

    const { data, error } = await query;
    if (!error && data) setDocuments(data);
    setLoading(false);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) setSelected(new Set(documents.map(d => d.id)));
    else setSelected(new Set());
  };

  const handleSelect = (id: string, checked: boolean) => {
    const newSelected = new Set(selected);
    if (checked) newSelected.add(id);
    else newSelected.delete(id);
    setSelected(newSelected);
  };

  const handleIngest = (document: Document) => {
    setSelectedDocument(document);
    setIngestModalOpen(true);
  };

  const handleDeleteSelected = async () => {
    if (!confirm(`Delete ${selected.size} document(s)?`)) return;

    const { error } = await supabase
      .from('documents')
      .delete()
      .in('id', Array.from(selected));

    if (!error) {
      setSelected(new Set());
      fetchDocuments();
    }
  };

  const getStatusBadge = (status: Document['status']) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-100">
            <CheckCircle2 className="h-3 w-3" />
            Completed
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-100">
            <XCircle className="h-3 w-3" />
            Error
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
            <Loader2 className="h-3 w-3 animate-spin" />
            Processing
          </span>
        );
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading...</div>;

  return (
    <div>
      {/* Toolbar */}
      <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-9 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm outline-none focus:border-gray-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">To</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-9 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm outline-none focus:border-gray-400"
            />
          </div>
        </div>
        
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleDeleteSelected}
            disabled={selected.size === 0}
            className="h-9 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-100"
          >
            Delete Selected
          </Button>
          <Button
            className="h-9 bg-black text-white hover:bg-gray-800"
            disabled={selected.size === 0}
          >
            Ingest Selected
          </Button>
        </div>
      </div>

      {/* Table */}
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50/50 text-gray-500 font-medium border-b border-gray-100">
          <tr>
            <th className="p-4 w-12">
              <Checkbox
                checked={selected.size === documents.length && documents.length > 0}
                onCheckedChange={handleSelectAll}
              />
            </th>
            <th className="p-4 font-medium">Transcript ID</th>
            <th className="p-4 font-medium">Source</th>
            <th className="p-4 font-medium">Status</th>
            <th className="p-4 font-medium">Created</th>
            <th className="p-4 w-12"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {documents.map((doc) => (
            <tr key={doc.id} className="hover:bg-gray-50/50 transition-colors group">
              <td className="p-4">
                <Checkbox
                  checked={selected.has(doc.id)}
                  onCheckedChange={(checked) => handleSelect(doc.id, checked as boolean)}
                />
              </td>
              <td className="p-4 font-mono text-xs text-gray-500">
                {doc.id.slice(0, 8)}...
              </td>
              <td className="p-4">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">
                    <FileText className="h-4 w-4" />
                  </div>
                  <span className="font-medium text-gray-900 truncate max-w-[300px]">
                    {doc.filename}
                  </span>
                </div>
              </td>
              <td className="p-4">
                {getStatusBadge(doc.status)}
              </td>
              <td className="p-4 text-gray-500">
                {format(new Date(doc.created_at), 'MMM d, yyyy • h:mm a')}
              </td>
              <td className="p-4">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => handleIngest(doc)}
                    disabled={doc.status !== 'completed'}
                  >
                    Ingest
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem
                        className="text-red-600 focus:text-red-700 focus:bg-red-50"
                        onClick={async () => {
                          if (confirm('Delete this document?')) {
                            await supabase.from('documents').delete().eq('id', doc.id);
                            fetchDocuments();
                          }
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      <div className="p-4 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
        <span>Showing {documents.length} documents</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled>Previous</Button>
          <Button variant="outline" size="sm" disabled>Next</Button>
        </div>
      </div>

      {selectedDocument && (
        <IngestModal
          open={ingestModalOpen}
          onOpenChange={setIngestModalOpen}
          document={selectedDocument}
          onSuccess={() => {
            setIngestModalOpen(false);
            fetchDocuments();
          }}
        />
      )}
    </div>
  );
}
