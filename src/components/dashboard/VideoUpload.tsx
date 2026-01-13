'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Upload, X, Loader2, FileVideo } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { v4 as uuidv4 } from 'uuid';

export function VideoUpload() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles(prev => [...prev, ...acceptedFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'video/mp4': ['.mp4'],
      'video/quicktime': ['.mov'],
    },
    multiple: true,
  });

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleTranscribe = async () => {
    if (files.length === 0) return;

    setUploading(true);
    const supabase = getSupabaseBrowser();
    const userId = '00000000-0000-0000-0000-000000000001';
    
    try {
      const uploads: Array<{
        documentId: string;
        filename: string;
        storagePath: string;
        sourceType: 'video' | 'audio' | 'document';
        size: number;
      }> = [];

      // Upload each file directly to Supabase Storage
      for (const file of files) {
        const documentId = uuidv4();
        const storagePath = `${userId}/${documentId}/${file.name}`;

        setUploadProgress(prev => ({ ...prev, [file.name]: 0 }));

        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(storagePath, file, {
            cacheControl: '3600',
            upsert: false,
          });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          toast.error(`Failed to upload ${file.name}`, {
            description: uploadError.message,
          });
          continue;
        }

        setUploadProgress(prev => ({ ...prev, [file.name]: 100 }));

        uploads.push({
          documentId,
          filename: file.name,
          storagePath,
          sourceType: 'video',
          size: file.size,
        });
      }

      if (uploads.length === 0) {
        throw new Error('No files were uploaded successfully');
      }

      // Register the uploads in the database
      const registerResponse = await fetch('/api/documents/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploads }),
      });

      if (!registerResponse.ok) {
        throw new Error('Failed to register uploads');
      }

      const { documentIds } = await registerResponse.json();

      // Start transcription
      const transcribeResponse = await fetch('/api/documents/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentIds,
          sourceType: 'video',
        }),
      });

      if (!transcribeResponse.ok) {
        throw new Error('Failed to start transcription');
      }

      toast.success('Transcription started', {
        description: `Processing ${uploads.length} video(s)`,
      });

      setFiles([]);
      setUploadProgress({});
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
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Add video files</h2>
        <p className="text-sm text-gray-500">Supported: MP4. You can add multiple files.</p>
      </div>

      {/* Dropzone */}
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
        <p className="text-gray-900 font-medium mb-1">Drag and drop MP4 files here</p>
        <p className="text-gray-500 text-sm mb-4">or</p>
        <Button variant="outline" className="bg-white hover:bg-gray-50 text-gray-900 border-gray-200 mb-4">
          Choose MP4 files
        </Button>
      </div>

      {/* Selected Files */}
      {files.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700">Selected Files</h3>
          {files.map((file, index) => {
            const progress = uploadProgress[file.name];
            const isUploading = uploading && progress !== undefined && progress < 100;
            
            return (
              <div
                key={index}
                className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-8 h-8 bg-gray-50 rounded flex items-center justify-center">
                      <FileVideo className="h-4 w-4 text-gray-500" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{file.name}</p>
                      <p className="text-xs text-gray-500">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                        {isUploading && ` • Uploading...`}
                        {progress === 100 && ` • Uploaded`}
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
                {isUploading && (
                  <div className="mt-2 w-full bg-gray-100 rounded-full h-1.5">
                    <div 
                      className="bg-black h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Transcribe Button */}
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
            'Transcribe Videos'
          )}
        </Button>
      </div>
    </div>
  );
}
