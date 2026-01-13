'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Link as LinkIcon, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
type Document = {
  id: string;
  filename: string;
  source_type: string;
};

export function LinkUpload() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  // Document selection state
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/documents?limit=100');
      const json = await res.json();
      if (json.documents) {
        setDocuments(json.documents.map((d: any) => ({
          id: d.id,
          filename: d.filename,
          source_type: d.source_type,
        })));
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    }
  };

  const filteredDocs = documents.filter(doc =>
    doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleDoc = (id: string) => {
    setSelectedDocs(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !url) return;

    setLoading(true);
    try {
      const response = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          url,
          description: description || undefined,
          associatedDocumentIds: selectedDocs.length > 0 ? selectedDocs : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save link');
      }

      toast.success('Link saved', {
        description: 'Your link has been added and is now searchable.',
      });

      router.push('/dashboard/content');
    } catch (error) {
      toast.error('Failed to save link', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Add a Link</h2>
        <p className="text-sm text-gray-500">Save external links as searchable resources.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-gray-50 rounded-xl p-8 border border-gray-200">
          <div className="w-16 h-16 bg-white rounded-full shadow-sm border border-gray-100 flex items-center justify-center mx-auto mb-6">
            <LinkIcon className="h-8 w-8 text-gray-600" />
          </div>

          <div className="max-w-md mx-auto space-y-4">
            <div className="space-y-2">
              <Label htmlFor="link-name" className="text-sm font-medium text-gray-700">
                Link Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="link-name"
                type="text"
                placeholder="e.g., TSL Framework - Direct Lead"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-white border-gray-200 h-10"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="link-url" className="text-sm font-medium text-gray-700">
                URL <span className="text-red-500">*</span>
              </Label>
              <Input
                id="link-url"
                type="url"
                placeholder="https://..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="bg-white border-gray-200 h-10"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="link-description" className="text-sm font-medium text-gray-700">
                Description <span className="text-gray-400">(optional)</span>
              </Label>
              <Input
                id="link-description"
                type="text"
                placeholder="Brief description for better search matching"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-white border-gray-200 h-10"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">
                Associated Content <span className="text-gray-400">(optional)</span>
              </Label>
              <div className="relative">
                <Input
                  type="text"
                  placeholder="Search documents to associate..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setDropdownOpen(true)}
                  className="bg-white border-gray-200 h-10"
                />
                {dropdownOpen && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredDocs.length === 0 ? (
                      <div className="p-3 text-sm text-gray-500">No documents found</div>
                    ) : (
                      filteredDocs.map(doc => (
                        <div
                          key={doc.id}
                          className="flex items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer"
                          onClick={() => toggleDoc(doc.id)}
                        >
                          <div className={`w-4 h-4 border rounded flex items-center justify-center ${
                            selectedDocs.includes(doc.id) ? 'bg-black border-black' : 'border-gray-300'
                          }`}>
                            {selectedDocs.includes(doc.id) && <Check className="h-3 w-3 text-white" />}
                          </div>
                          <span className="text-sm truncate">{doc.filename}</span>
                        </div>
                      ))
                    )}
                    <div className="border-t p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => setDropdownOpen(false)}
                      >
                        Done
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              {selectedDocs.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {selectedDocs.map(id => {
                    const doc = documents.find(d => d.id === id);
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs"
                      >
                        {doc?.filename.slice(0, 20)}...
                        <X
                          className="h-3 w-3 cursor-pointer hover:text-red-500"
                          onClick={() => toggleDoc(id)}
                        />
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!name || !url || loading}
            className="bg-black hover:bg-gray-800 text-white shadow-sm"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Link'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
