-- Add 'csv-import' to source_type constraint
ALTER TABLE public.uploads
DROP CONSTRAINT IF EXISTS uploads_source_type_check;

ALTER TABLE public.uploads
ADD CONSTRAINT uploads_source_type_check
CHECK (source_type IN ('video', 'audio', 'pdf', 'youtube', 'document', 'link', 'csv-import'));
