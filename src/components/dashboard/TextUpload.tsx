'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

export function TextUpload() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    setLoading(true);
    try {
      const response = await fetch('/api/documents/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save text');
      }

      toast.success('Text saved successfully', {
        description: 'You can now ingest it from the Content page.',
      });

      setTitle('');
      setContent('');
      router.push('/dashboard/content');
    } catch (error) {
      toast.error('Failed to save text', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  };

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  const charCount = content.length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Free-Form Text</h2>
        <p className="text-sm text-gray-500">Add custom text content that can be ingested into the knowledge base.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-gray-50 rounded-xl p-8 border border-gray-200">
          <div className="w-16 h-16 bg-white rounded-full shadow-sm border border-gray-100 flex items-center justify-center mx-auto mb-6">
            <FileText className="h-8 w-8 text-gray-600" />
          </div>

          <div className="max-w-2xl mx-auto space-y-4">
            <div className="space-y-2">
              <Label htmlFor="text-title" className="text-sm font-medium text-gray-700">Title</Label>
              <Input
                id="text-title"
                type="text"
                placeholder="Enter a title for this content..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="bg-white border-gray-200 focus:bg-white transition-all h-10"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="text-content" className="text-sm font-medium text-gray-700">Content</Label>
              <Textarea
                id="text-content"
                placeholder="Paste or type your text content here..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="bg-white border-gray-200 focus:bg-white transition-all min-h-[300px] resize-y"
                required
              />
              <div className="flex justify-end gap-4 text-xs text-gray-400">
                <span>{wordCount.toLocaleString()} words</span>
                <span>{charCount.toLocaleString()} characters</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!title.trim() || !content.trim() || loading}
            className="bg-black hover:bg-gray-800 text-white shadow-sm"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Text'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
