'use client';

import { Button } from '@/components/ui/button';
import { X, FileText, Link as LinkIcon, ExternalLink } from 'lucide-react';

type SearchResult = {
  id: string;
  type: 'document' | 'link';
  name: string;
  url?: string;
  content: string;
  similarity: number;
  metadata?: any;
};

type Props = {
  results: SearchResult[];
  query: string;
  onClose: () => void;
  loading: boolean;
};

export function SearchResults({ results, query, onClose, loading }: Props) {
  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 p-8">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            <span className="ml-3 text-gray-600">Searching...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">Search Results</h2>
            <p className="text-sm text-gray-500">
              {results.length} results for "{query}"
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {results.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No results found. Try a different search term.
            </div>
          ) : (
            results.map((result) => (
              <div
                key={result.id}
                className="border border-gray-100 rounded-lg p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 flex-shrink-0">
                    {result.type === 'link' ? (
                      <LinkIcon className="h-4 w-4" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 truncate">
                        {result.name}
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-gray-100 rounded-full text-gray-600">
                        {Math.round(result.similarity * 100)}% match
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                      {result.content}
                    </p>
                    {result.type === 'link' && result.url && (
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-2"
                      >
                        Open link <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
