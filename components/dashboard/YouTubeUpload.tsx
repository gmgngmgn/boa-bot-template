'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Youtube } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

export function YouTubeUpload() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    try {
      const response = await fetch('/api/documents/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: 'youtube',
          youtubeUrl: url,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start transcription');
      }

      toast.success('YouTube transcription started', {
        description: 'Processing video...',
      });

      router.push('/dashboard/content');
    } catch (error) {
      toast.error('Failed to start transcription', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">YouTube Video</h2>
        <p className="text-sm text-gray-500">Enter a YouTube URL to extract the transcript.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-gray-50 rounded-xl p-8 border border-gray-200 text-center">
          <div className="w-16 h-16 bg-white rounded-full shadow-sm border border-gray-100 flex items-center justify-center mx-auto mb-6">
            <Youtube className="h-8 w-8 text-red-600" />
          </div>
          
          <div className="max-w-md mx-auto space-y-2 text-left">
            <Label htmlFor="youtube-url" className="text-sm font-medium text-gray-700">YouTube URL</Label>
            <Input
              id="youtube-url"
              type="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="bg-white border-gray-200 focus:bg-white transition-all h-10"
              required
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!url || loading}
            className="bg-black hover:bg-gray-800 text-white shadow-sm"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              'Get Transcript'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
