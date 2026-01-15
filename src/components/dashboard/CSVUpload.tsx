'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Upload, FileSpreadsheet, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';

type CSVRow = {
  'Document Name': string;
  'Doc URL': string;
  'Video URL'?: string;
  [key: string]: string | undefined;
};

export function CSVUpload() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<CSVRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [targetTable, setTargetTable] = useState<'documents' | 'student_documents'>('documents');

  const validateCSV = (data: any[]): { valid: boolean; error?: string; rows: CSVRow[] } => {
    if (!data || data.length === 0) {
      return { valid: false, error: 'CSV file is empty', rows: [] };
    }

    const firstRow = data[0];
    const hasDocumentName = 'Document Name' in firstRow;
    const hasDocUrl = 'Doc URL' in firstRow;

    if (!hasDocumentName || !hasDocUrl) {
      const missing = [];
      if (!hasDocumentName) missing.push('Document Name');
      if (!hasDocUrl) missing.push('Doc URL');
      return { valid: false, error: `Missing required columns: ${missing.join(', ')}`, rows: [] };
    }

    // Filter out empty rows
    const validRows = data.filter(row =>
      row['Document Name']?.trim() && row['Doc URL']?.trim()
    );

    if (validRows.length === 0) {
      return { valid: false, error: 'No valid rows found (all rows missing Document Name or Doc URL)', rows: [] };
    }

    return { valid: true, rows: validRows };
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const csvFile = acceptedFiles[0];
    if (!csvFile) return;

    setFile(csvFile);
    setParseError(null);
    setRows([]);

    Papa.parse(csvFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const validation = validateCSV(results.data);
        if (!validation.valid) {
          setParseError(validation.error || 'Invalid CSV');
          setFile(null);
        } else {
          setRows(validation.rows);
        }
      },
      error: (error) => {
        setParseError(`Failed to parse CSV: ${error.message}`);
        setFile(null);
      },
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
    },
    multiple: false,
  });

  const handleImport = async () => {
    if (rows.length === 0) return;

    setUploading(true);

    try {
      const response = await fetch('/api/documents/csv-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: rows.map(row => ({
            documentName: row['Document Name'],
            docUrl: row['Doc URL'],
            externalLink: row['Video URL'] || undefined,
          })),
          targetTable,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to start import');
      }

      const data = await response.json();

      toast.success('CSV import started', {
        description: `Processing ${data.rowCount} documents`,
      });

      router.push('/dashboard/content');
    } catch (error) {
      toast.error('Import failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setUploading(false);
    }
  };

  const clearFile = () => {
    setFile(null);
    setRows([]);
    setParseError(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Import from CSV</h2>
        <p className="text-sm text-gray-500">
          Bulk import documents from Google Docs. CSV must have columns: Document Name, Doc URL, Video URL (optional).
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Target Knowledge Base
          </label>
          <select
            value={targetTable}
            onChange={(e) => setTargetTable(e.target.value as 'documents' | 'student_documents')}
            className="h-10 w-full max-w-xs rounded-md border border-gray-200 bg-white px-3 text-sm outline-none focus:border-gray-400"
          >
            <option value="documents">Main Knowledge Base</option>
            <option value="student_documents">Student Knowledge Base</option>
          </select>
        </div>

        {!file ? (
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
              <FileSpreadsheet className="h-6 w-6 text-gray-600" />
            </div>
            <p className="text-gray-900 font-medium mb-1">Drag and drop CSV file here</p>
            <p className="text-gray-500 text-sm mb-4">or</p>
            <Button variant="outline" className="bg-white hover:bg-gray-50 text-gray-900 border-gray-200">
              Choose CSV file
            </Button>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-xl p-6 bg-white">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
                  <FileSpreadsheet className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">{file.name}</p>
                  <p className="text-sm text-gray-500">
                    {rows.length} document{rows.length !== 1 ? 's' : ''} found
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFile}
                className="text-gray-400 hover:text-gray-600"
              >
                Change file
              </Button>
            </div>

            {rows.length > 0 && (
              <div className="border border-gray-100 rounded-lg overflow-hidden">
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-medium text-gray-600">#</th>
                        <th className="text-left p-2 font-medium text-gray-600">Document Name</th>
                        <th className="text-left p-2 font-medium text-gray-600">Has Link</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {rows.slice(0, 10).map((row, idx) => (
                        <tr key={idx}>
                          <td className="p-2 text-gray-400">{idx + 1}</td>
                          <td className="p-2 text-gray-900 truncate max-w-[300px]">
                            {row['Document Name']}
                          </td>
                          <td className="p-2 text-gray-500">
                            {row['Video URL'] ? 'Yes' : 'No'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > 10 && (
                  <div className="bg-gray-50 px-2 py-1 text-xs text-gray-500 text-center border-t border-gray-100">
                    And {rows.length - 10} more...
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {parseError && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {parseError}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleImport}
          disabled={rows.length === 0 || uploading}
          className="bg-black hover:bg-gray-800 text-white shadow-sm"
        >
          {uploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Starting import...
            </>
          ) : (
            `Import ${rows.length} Document${rows.length !== 1 ? 's' : ''}`
          )}
        </Button>
      </div>
    </div>
  );
}
