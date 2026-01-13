'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Upload, X, Loader2, Music } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

export function AudioUpload() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles(prev => [...prev, ...acceptedFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/mpeg': ['.mp3'],
      'audio/wav': ['.wav'],
      'audio/m4a': ['.m4a'],
      'audio/aac': ['.aac'],
      'audio/flac': ['.flac'],
      'audio/ogg': ['.ogg'],
    },
    multiple: true,
  });

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleTranscribe = async () => {
    if (files.length === 0) return;

    setUploading(true);
    try {
      const formData = new FormData();
      files.forEach(file => {
        formData.append('files', file);
      });

      const uploadResponse = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload files');
      }

      const { documentIds } = await uploadResponse.json();

      const transcribeResponse = await fetch('/api/documents/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentIds,
          sourceType: 'audio',
        }),
      });

      if (!transcribeResponse.ok) {
        throw new Error('Failed to start transcription');
      }

      toast.success('Transcription started', {
        description: `Processing ${files.length} audio file(s)`,
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Add audio files</h2>
        <p className="text-sm text-gray-500">Supported: MP3, WAV, M4A, AAC, FLAC, OGG. You can add multiple files.</p>
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
        <p className="text-gray-900 font-medium mb-1">Drag and drop audio files here</p>
        <p className="text-gray-500 text-sm mb-4">or</p>
        <Button variant="outline" className="bg-white hover:bg-gray-50 text-gray-900 border-gray-200">
          Choose audio files
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
                  <Music className="h-4 w-4 text-gray-500" />
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
          onClick={handleTranscribe}
          disabled={files.length === 0 || uploading}
          className="bg-black hover:bg-gray-800 text-white shadow-sm"
        >
          {uploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading...
            </>
          ) : (
            'Transcribe Audio'
          )}
        </Button>
      </div>
    </div>
  );
}
