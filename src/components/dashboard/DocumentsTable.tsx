'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle2, XCircle, Loader2, MoreHorizontal, FileText, Link as LinkIcon, Search, DatabaseZap } from 'lucide-react';
import { SearchResults } from './SearchResults';
import { IngestModal } from './IngestModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { format } from 'date-fns';
import { toast } from 'sonner';
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

type Link = {
  id: string;
  user_id: string;
  name: string;
  url: string;
  description: string | null;
  associated_document_ids: string[];
  created_at: string;
};

type ContentItem =
  | (Document & { itemType: 'document' })
  | (Link & { itemType: 'link' });

const PAGE_SIZE = 50;

export function DocumentsTable() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ingestModalOpen, setIngestModalOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [contentType, setContentType] = useState<'all' | 'documents' | 'links'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [itemsToDelete, setItemsToDelete] = useState<{ docIds: string[]; linkIds: string[] }>({ docIds: [], linkIds: [] });

  const fetchLinks = async () => {
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);

      const res = await fetch(`/api/links?${params.toString()}`);
      const json = await res.json();
      if (json.data) setLinks(json.data);
    } catch (error) {
      console.error('Failed to fetch links:', error);
    }
  };

  useEffect(() => {
    fetchDocuments();
    fetchLinks();

    const channel = supabase
      .channel('uploads')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'uploads',
      }, () => {
        fetchDocuments();
      })
      .subscribe();

    const linksChannel = supabase
      .channel('links')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'links',
      }, () => {
        fetchLinks();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(linksChannel);
    };
  }, [fromDate, toDate, currentPage]);

  const fetchDocuments = async () => {
    setLoading(true);

    try {
      const params = new URLSearchParams();
      params.set('page', String(currentPage + 1));
      params.set('limit', String(PAGE_SIZE));
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);

      const res = await fetch(`/api/documents?${params.toString()}`);
      const json = await res.json();

      if (json.documents) {
        setDocuments(json.documents);
        setTotalCount(json.total || 0);
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    }

    setLoading(false);
  };

  // Combine and filter content
  const allContent: ContentItem[] = [
    ...documents.map(d => ({ ...d, itemType: 'document' as const })),
    ...links.map(l => ({ ...l, itemType: 'link' as const })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const filteredContent = contentType === 'all'
    ? allContent
    : allContent.filter(item =>
        contentType === 'documents' ? item.itemType === 'document' : item.itemType === 'link'
      );

  // Instant filter by name when typing (not showing search results modal)
  const displayContent = searchQuery && !showSearchResults
    ? filteredContent.filter(item => {
        const name = item.itemType === 'link' ? item.name : item.filename;
        return name.toLowerCase().includes(searchQuery.toLowerCase());
      })
    : filteredContent;

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setSearching(true);
    setShowSearchResults(true);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) setSelected(new Set(filteredContent.map(d => d.id)));
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

  const handleDeleteSelected = () => {
    const selectedItems = filteredContent.filter(item => selected.has(item.id));
    const docIds = selectedItems.filter(i => i.itemType === 'document').map(i => i.id);
    const linkIds = selectedItems.filter(i => i.itemType === 'link').map(i => i.id);

    if (docIds.length === 0 && linkIds.length === 0) return;

    setItemsToDelete({ docIds, linkIds });
    setDeleteModalOpen(true);
  };

  const handleDeleteSingleDocument = (documentId: string) => {
    setItemsToDelete({ docIds: [documentId], linkIds: [] });
    setDeleteModalOpen(true);
  };

  const handleDeleteSingleLink = (linkId: string) => {
    setItemsToDelete({ docIds: [], linkIds: [linkId] });
    setDeleteModalOpen(true);
  };

  const performDelete = async () => {
    const { docIds, linkIds } = itemsToDelete;
    setDeleteLoading(true);

    try {
      // Delete documents via API
      if (docIds.length > 0) {
        const response = await fetch('/api/documents', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentIds: docIds }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          console.error('Delete API error:', data);
          throw new Error(data.details?.join(', ') || data.error || 'Failed to delete documents');
        }
      }

      // Delete links
      for (const linkId of linkIds) {
        const response = await fetch(`/api/links/${linkId}`, { method: 'DELETE' });
        if (!response.ok) {
          throw new Error('Failed to delete link');
        }
      }

      const totalDeleted = docIds.length + linkIds.length;
      toast.success(`Deleted ${totalDeleted} item${totalDeleted > 1 ? 's' : ''}`);

      setSelected(new Set());
      setDeleteModalOpen(false);
      setItemsToDelete({ docIds: [], linkIds: [] });
      fetchDocuments();
      fetchLinks();
    } catch (error) {
      toast.error('Delete failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const getDeleteItemType = (): 'document' | 'link' | 'mixed' => {
    const { docIds, linkIds } = itemsToDelete;
    if (docIds.length > 0 && linkIds.length > 0) return 'mixed';
    if (linkIds.length > 0) return 'link';
    return 'document';
  };

  const getStatusBadge = (status: Document['status'], metadata?: any) => {
    // Check if document has been ingested into RAG pipeline
    const isIngested = metadata?.ingested === true;

    switch (status) {
      case 'completed':
        if (isIngested) {
          return (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-100">
              <DatabaseZap className="h-3 w-3" />
              Ingested
            </span>
          );
        }
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
            <input
              type="text"
              placeholder="Search content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch();
              }}
              className="h-9 w-64 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm outline-none focus:border-gray-400"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleSearch}
              disabled={!searchQuery.trim()}
              className="h-9"
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setCurrentPage(0);
              }}
              className="h-9 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm outline-none focus:border-gray-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">To</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setCurrentPage(0);
              }}
              className="h-9 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm outline-none focus:border-gray-400"
            />
          </div>
          <select
            value={contentType}
            onChange={(e) => setContentType(e.target.value as 'all' | 'documents' | 'links')}
            className="h-9 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm outline-none focus:border-gray-400"
          >
            <option value="all">All Types</option>
            <option value="documents">Documents</option>
            <option value="links">Links</option>
          </select>
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
                checked={selected.size === filteredContent.length && filteredContent.length > 0}
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
          {displayContent.map((item) => (
            <tr key={item.id} className="hover:bg-gray-50/50 transition-colors group">
              <td className="p-4">
                <Checkbox
                  checked={selected.has(item.id)}
                  onCheckedChange={(checked) => handleSelect(item.id, checked as boolean)}
                />
              </td>
              <td className="p-4 font-mono text-xs text-gray-500">
                {item.id.slice(0, 8)}...
              </td>
              <td className="p-4">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">
                    {item.itemType === 'link' ? <LinkIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  </div>
                  <span className="font-medium text-gray-900 truncate max-w-[300px]">
                    {item.itemType === 'link' ? item.name : item.filename}
                  </span>
                </div>
              </td>
              <td className="p-4">
                {item.itemType === 'link' ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600 border border-gray-100">
                    Link
                  </span>
                ) : (
                  getStatusBadge(item.status, item.metadata)
                )}
              </td>
              <td className="p-4 text-gray-500">
                {format(new Date(item.created_at), 'MMM d, yyyy • h:mm a')}
              </td>
              <td className="p-4">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex justify-end gap-2">
                  {item.itemType === 'link' ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={() => window.open(item.url, '_blank')}
                        >
                          Open Link
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-red-600 focus:text-red-700 focus:bg-red-50"
                          onClick={() => handleDeleteSingleLink(item.id)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <>
                      {item.metadata?.ingested ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs text-purple-600 border-purple-200 hover:bg-purple-50"
                          onClick={() => handleIngest(item)}
                        >
                          Re-ingest
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => handleIngest(item)}
                          disabled={item.status !== 'completed'}
                        >
                          Ingest
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            className="text-red-600 focus:text-red-700 focus:bg-red-50"
                            onClick={() => handleDeleteSingleDocument(item.id)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      <div className="p-4 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
        <span>
          {displayContent.length === 0
            ? 'No content'
            : `Showing ${displayContent.length} ${contentType === 'all' ? 'items' : contentType} (${documents.length} documents, ${links.length} links)`}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === 0}
            onClick={() => setCurrentPage(p => p - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={(currentPage + 1) * PAGE_SIZE >= totalCount}
            onClick={() => setCurrentPage(p => p + 1)}
          >
            Next
          </Button>
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

      {showSearchResults && (
        <SearchResults
          results={searchResults}
          query={searchQuery}
          loading={searching}
          onClose={() => {
            setShowSearchResults(false);
            setSearchResults([]);
          }}
        />
      )}

      <DeleteConfirmModal
        open={deleteModalOpen}
        onOpenChange={(open) => {
          setDeleteModalOpen(open);
          if (!open) setItemsToDelete({ docIds: [], linkIds: [] });
        }}
        onConfirm={performDelete}
        loading={deleteLoading}
        itemCount={itemsToDelete.docIds.length + itemsToDelete.linkIds.length}
        itemType={getDeleteItemType()}
      />
    </div>
  );
}
