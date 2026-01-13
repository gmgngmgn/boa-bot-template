'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Plus, Settings as SettingsIcon } from 'lucide-react';
import { toast } from 'sonner';

type MetadataField = {
  id: string;
  user_id: string;
  field_name: string;
  example_value: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export function MetadataFieldsManager() {
  const [fields, setFields] = useState<MetadataField[]>([]);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldExample, setNewFieldExample] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFields();
  }, []);

  const fetchFields = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/metadata-fields', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to load metadata fields');
      }
      const payload = await response.json();
      setFields(payload.fields || []);
    } catch (error) {
      toast.error('Failed to load fields', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
    setLoading(false);
    }
  };

  const handleAddField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFieldName) return;

    try {
      const response = await fetch('/api/metadata-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fieldName: newFieldName,
          exampleValue: newFieldExample || null,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to add field');
      }

      toast.success('Field added successfully');
      setNewFieldName('');
      setNewFieldExample('');
      fetchFields();
    } catch (error) {
      toast.error('Failed to add field', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const handleDeleteField = async (id: string) => {
    try {
      const response = await fetch('/api/metadata-fields', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to delete field');
      }

      toast.success('Field deleted successfully');
      fetchFields();
    } catch (error) {
      toast.error('Failed to delete field', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  if (loading) {
    return <div className="text-gray-500 text-sm">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Client Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your document metadata configuration.</p>
      </div>

      {/* Add New Field Section */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Add Metadata Field</h2>
          <p className="text-sm text-gray-500">
            Define new fields to be extracted from your documents.
          </p>
        </div>

        <form onSubmit={handleAddField} className="flex gap-4 items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="field-name" className="text-xs font-medium text-gray-700">Field Key</Label>
            <Input
              id="field-name"
              placeholder="e.g. Course Name"
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
              className="bg-gray-50 border-gray-200 focus:bg-white focus:border-gray-300 transition-all text-gray-900 placeholder:text-gray-400"
            />
          </div>
          <div className="flex-1 space-y-2">
            <Label htmlFor="field-example" className="text-xs font-medium text-gray-700">Example Value</Label>
            <Input
              id="field-example"
              placeholder="e.g. Inner Circle"
              value={newFieldExample}
              onChange={(e) => setNewFieldExample(e.target.value)}
              className="bg-gray-50 border-gray-200 focus:bg-white focus:border-gray-300 transition-all text-gray-900 placeholder:text-gray-400"
            />
          </div>
          <Button
            type="submit"
            className="bg-black text-white hover:bg-gray-800 shadow-sm px-6"
            disabled={!newFieldName}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Field
          </Button>
        </form>
      </div>

      {/* Existing Fields Section */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
          <h3 className="text-sm font-medium text-gray-900">Configured Fields</h3>
          <span className="text-xs text-gray-500 font-medium bg-white px-2 py-1 rounded-md border border-gray-100">{fields.length} fields</span>
        </div>
        
        {fields.length > 0 ? (
          <div className="divide-y divide-gray-50">
            <div className="grid grid-cols-[1fr_1fr_100px] gap-4 px-6 py-3 bg-gray-50/30 text-xs font-medium text-gray-500 uppercase tracking-wider">
              <div>Key</div>
              <div>Example</div>
              <div className="text-right">Actions</div>
            </div>
            {fields.map((field) => (
              <div
                key={field.id}
                className="grid grid-cols-[1fr_1fr_100px] gap-4 px-6 py-4 items-center hover:bg-gray-50/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                  <span className="text-sm font-medium text-gray-900">{field.field_name}</span>
                </div>
                <div className="text-sm text-gray-500">{field.example_value || '-'}</div>
                <div className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteField(field.id)}
                    className="text-gray-400 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <SettingsIcon className="h-6 w-6 text-gray-400" />
            </div>
            <h3 className="text-sm font-medium text-gray-900 mb-1">No fields configured</h3>
            <p className="text-sm text-gray-500">Add your first metadata field above to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}
