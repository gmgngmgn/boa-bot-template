-- =====================================================
-- Fix Delete Upload Timeout
-- =====================================================
-- Issue: The trigger function delete_upload_vectors() was causing timeouts
-- because it scanned 41k+ rows with: metadata->>'upload_id' = OLD.id::text
--
-- Solution: Remove the slow metadata-based delete queries since the
-- upload_vectors table already tracks all vector IDs for proper cleanup.

CREATE OR REPLACE FUNCTION public.delete_upload_vectors()
RETURNS TRIGGER AS $$
DECLARE
  tracking_row RECORD;
BEGIN
  -- Get all vector tracking records for this upload
  FOR tracking_row IN
    SELECT vector_ids, target_table FROM public.upload_vectors WHERE upload_id = OLD.id
  LOOP
    -- Delete vectors from the target table using tracked vector_ids (uses primary key index - fast!)
    IF tracking_row.target_table = 'documents' THEN
      DELETE FROM public.documents WHERE id = ANY(tracking_row.vector_ids);
    ELSIF tracking_row.target_table = 'student_documents' THEN
      DELETE FROM public.student_documents WHERE id = ANY(tracking_row.vector_ids);
    END IF;
  END LOOP;

  -- Note: Removed slow metadata-based delete queries that caused timeouts:
  -- DELETE FROM public.documents WHERE metadata->>'upload_id' = OLD.id::text;
  -- DELETE FROM public.student_documents WHERE metadata->>'upload_id' = OLD.id::text;
  -- The upload_vectors table tracks all vector IDs, so the loop above handles cleanup properly.

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
