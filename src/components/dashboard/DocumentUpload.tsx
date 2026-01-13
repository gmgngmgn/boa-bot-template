'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Upload, X, Loader2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { v4 as uuidv4 } from 'uuid';

type DocumentPreview = {
  id: string;
  name: string;
  path: string;
  status: string;
  createdAt: string;
  url: string;
};

export function DocumentUpload() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [documentPreviews, setDocumentPreviews] = useState<DocumentPreview[]>([]);
  const [loadingPreviews, setLoadingPreviews] = useState(true);
  const bucket = 'documents';

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles(prev => [...prev, ...acceptedFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
    },
    multiple: true,
  });

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const buildPreviewUrl = useCallback(
    (path: string) =>
      `/api/storage/proxy?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`,
    [bucket]
  );

  const fetchPreviewList = useCallback(async () => {
    setLoadingPreviews(true);
    try {
      const response = await fetch('/api/documents?limit=50', { cache: 'no-store' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      const payload = await response.json();
      const docs = Array.isArray(payload?.documents) ? payload.documents : [];
      const mapped: DocumentPreview[] = docs
        .filter((doc: any) => doc?.source_url)
        .map((doc: any) => ({
          id: doc.id,
          name: doc.filename,
          path: doc.source_url,
          status: doc.status,
          createdAt: doc.created_at,
          url: buildPreviewUrl(doc.source_url),
        }));
      setDocumentPreviews(mapped);
    } catch (err) {
      console.error('Document fetch error:', err);
      toast.error('Failed to load documents', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoadingPreviews(false);
    }
  }, [buildPreviewUrl]);

  useEffect(() => {
    fetchPreviewList();
  }, [fetchPreviewList]);

  const upsertPreview = (preview: DocumentPreview) => {
    setDocumentPreviews(prev => {
      const existing = prev.filter(p => p.path !== preview.path);
      return [preview, ...existing].slice(0, 50);
    });
  };

  const handleProcess = async () => {
    if (files.length === 0) return;

    setUploading(true);
    const userId = '00000000-0000-0000-0000-000000000001';
    const documentIds: string[] = [];

    try {
      // Upload each file directly to Supabase Storage from the browser
      for (const file of files) {
        const documentId = uuidv4();
        // Sanitize filename: remove special chars, spaces to hyphens
        const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '-');
        const storagePath = `${userId}/${documentId}/${sanitizedFilename}`;

        // Direct upload to storage
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(storagePath, file, {
            upsert: false,
          });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          toast.error(`Failed to upload ${file.name}`, {
            description: uploadError.message,
          });
          continue;
        }

        documentIds.push(documentId);

        upsertPreview({
          id: documentId,
          name: file.name,
          path: storagePath,
          status: 'processing',
          createdAt: new Date().toISOString(),
          url: buildPreviewUrl(storagePath),
        });

        // Create document record via API
        await fetch('/api/documents/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentId,
            filename: file.name,
            sourceType: 'document',
            storagePath,
          }),
        });
      }

      if (documentIds.length === 0) {
        throw new Error('No files were uploaded successfully');
      }

      // Trigger text extraction
      const transcribeResponse = await fetch('/api/documents/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentIds,
          sourceType: 'document',
        }),
      });

      if (!transcribeResponse.ok) {
        throw new Error('Failed to start processing');
      }

      toast.success('Processing started', {
        description: `Processing ${documentIds.length} document(s)`,
      });

      router.push('/dashboard/content');
    } catch (error) {
      toast.error('Upload failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${url}`);
      toast.success('Link copied to clipboard');
    } catch (err) {
      toast.error('Failed to copy link');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Add documents</h2>
        <p className="text-sm text-gray-500">Supported: PDF, DOCX, TXT, MD. You can add multiple files.</p>
      </div>

      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors
          ${isDragActive 
            ? 'border-black bg-gray-50' 
            : 'border-gray-200 hover:border-gray-300 bg-gray-50/50'
          }
        `}
      >
        <input {...getInputProps()} />
        <div className="w-12 h-12 bg-white rounded-full shadow-sm border border-gray-100 flex items-center justify-center mx-auto mb-4">
          <Upload className="h-6 w-6 text-gray-600" />
        </div>
        <p className="text-gray-900 font-medium mb-1">Drag and drop documents here</p>
        <p className="text-gray-500 text-sm mb-4">or</p>
        <Button variant="outline" className="bg-white hover:bg-gray-50 text-gray-900 border-gray-200">
          Choose documents
        </Button>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700">Selected Files</h3>
          {files.map((file, index) => (
            <div
              key={index}
              className="flex items-center justify-between bg-white border border-gray-100 rounded-lg p-3 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gray-50 rounded flex items-center justify-center">
                  <FileText className="h-4 w-4 text-gray-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeFile(index)}
                disabled={uploading}
                className="text-gray-400 hover:text-red-600 hover:bg-red-50"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleProcess}
          disabled={files.length === 0 || uploading}
          className="bg-black hover:bg-gray-800 text-white shadow-sm"
        >
          {uploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading...
            </>
          ) : (
            'Process Documents'
          )}
        </Button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">Recent Documents</h3>
          <Button
            variant="ghost"
            size="sm"
            className="text-gray-500 hover:text-gray-900"
            onClick={fetchPreviewList}
            disabled={loadingPreviews}
          >
            Refresh
          </Button>
        </div>

        {loadingPreviews ? (
          <div className="text-sm text-gray-500">Loading documents...</div>
        ) : documentPreviews.length === 0 ? (
          <div className="text-sm text-gray-500">No documents available yet.</div>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {documentPreviews.map(doc => (
              <li key={doc.path} className="flex items-center justify-between p-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-gray-900 truncate max-w-[320px]">
                    {doc.name}
                  </span>
                  <span className="text-xs text-gray-500 capitalize">{doc.status}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => window.open(doc.url, '_blank', 'noopener')}
                  >
                    Preview
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCopyLink(doc.url)}
                  >
                    Copy Link
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
