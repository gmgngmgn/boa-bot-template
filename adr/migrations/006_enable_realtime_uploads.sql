-- =====================================================
-- Enable Realtime for uploads table
-- =====================================================
-- This allows the frontend to receive live updates when
-- document processing status changes

-- Add uploads table to the realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.uploads;

-- Optionally add links table if you want real-time link updates too
ALTER PUBLICATION supabase_realtime ADD TABLE public.links;
