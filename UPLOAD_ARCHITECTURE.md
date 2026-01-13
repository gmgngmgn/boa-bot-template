# Upload Architecture

## Problem

Previously, video and audio uploads were failing with `413 Content Too Large` errors when files exceeded ~4-5MB. This happened because:

1. Files were uploaded through Next.js API routes (`/api/documents/upload`)
2. These routes run as Vercel Serverless Functions
3. Vercel has a hard payload limit of 4.5-5MB per request
4. Large video files would hit this limit before ever reaching Supabase Storage (which supports up to 50GB)

**Error Message:**
```
Status Code: 413 Content Too Large
FUNCTION_PAYLOAD_TOO_LARGE
```

## Solution

We've implemented **direct client-side uploads** to Supabase Storage, bypassing Vercel's serverless functions entirely for the file transfer.

### New Upload Flow

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │
       │ 1. Upload file directly
       │    (bypasses Vercel limits)
       ▼
┌─────────────────────┐
│ Supabase Storage    │
│ (50GB limit)        │
└─────────────────────┘
       │
       │ 2. Register upload
       │    (metadata only)
       ▼
┌─────────────────────┐
│ /api/documents/     │
│ register            │
└─────────────────────┘
       │
       │ 3. Start processing
       ▼
┌─────────────────────┐
│ /api/documents/     │
│ transcribe          │
└─────────────────────┘
```

### Key Changes

#### 1. New API Route: `/api/documents/register`

This lightweight endpoint only receives metadata after the client has already uploaded to storage:

```typescript
POST /api/documents/register
{
  "uploads": [
    {
      "documentId": "uuid",
      "filename": "video.mp4",
      "storagePath": "user/doc/video.mp4",
      "sourceType": "video",
      "size": 123456789
    }
  ]
}
```

**Benefits:**
- No file payload through Vercel
- Only JSON metadata (~1KB per file)
- No size limits

#### 2. Updated Upload Components

**VideoUpload.tsx** and **AudioUpload.tsx** now:

1. Use `getSupabaseBrowser()` to get a client-side Supabase client
2. Upload directly to storage: `supabase.storage.from('documents').upload()`
3. Track upload progress per file
4. Register uploads via `/api/documents/register`
5. Trigger transcription via `/api/documents/transcribe`

**Progress Tracking:**
- Visual progress bars for each file
- Status indicators (Uploading... / Uploaded)
- Better UX for large files

#### 3. Supabase Client Enhancement

Added `getSupabaseBrowser()` helper in `src/lib/supabase/client.ts`:

```typescript
export const getSupabaseBrowser = () => {
  if (typeof window === 'undefined') {
    throw new Error('getSupabaseBrowser can only be called in the browser');
  }
  
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
};
```

This ensures the Supabase client is only instantiated in the browser where direct uploads happen.

## File Size Limits

| Method | Limit | Use Case |
|--------|-------|----------|
| Vercel Serverless Function | ~4.5MB | ❌ Not suitable for media |
| Vercel Edge Function | ~1MB | ❌ Even smaller |
| Supabase Storage (Direct) | 50GB | ✅ Perfect for videos |

## Security

- Client uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` (safe to expose)
- Supabase RLS policies control upload permissions
- Storage bucket policies enforce user-specific paths
- No service role key exposed to client

## Performance Benefits

1. **No double transfer**: File goes directly from browser → Supabase (not browser → Vercel → Supabase)
2. **Parallel uploads**: Multiple files can upload simultaneously
3. **Progress tracking**: Real-time feedback for large files
4. **Resumable uploads**: Supabase supports resumable uploads for very large files

## Migration Notes

### Deprecated Route

`/api/documents/upload` is now deprecated and can be safely deleted. It's been marked with a deprecation notice.

### Backward Compatibility

- Existing documents in storage are unaffected
- Database schema remains the same
- Transcription flow unchanged
- Only the upload mechanism changed

## Testing

To verify the fix works:

1. Upload a video file > 5MB
2. Should see progress bar
3. Should complete successfully
4. Check Supabase Storage bucket for the file
5. Check `documents` table for the record

## Future Enhancements

Potential improvements to consider:

1. **Resumable uploads**: Implement Supabase's TUS protocol for very large files
2. **Chunked uploads**: Split files into chunks for better progress tracking
3. **Client-side validation**: Check file size/type before upload starts
4. **Signed URLs**: Generate time-limited upload URLs for extra security
5. **Compression**: Optionally compress videos before upload
6. **Parallel chunks**: Upload multiple chunks simultaneously for faster transfers

## Troubleshooting

### Upload fails with "Unauthorized"

- Check Supabase RLS policies on `documents` bucket
- Verify `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set correctly

### Upload succeeds but no database record

- Check `/api/documents/register` endpoint
- Verify user ID matches migration: `00000000-0000-0000-0000-000000000001`

### Progress bar doesn't update

- Current implementation shows 0% → 100% (binary)
- For granular progress, implement upload progress callbacks

## References

- [Supabase Storage Documentation](https://supabase.com/docs/guides/storage)
- [Vercel Function Limits](https://vercel.com/docs/functions/serverless-functions/runtimes#request-body-size)
- [Supabase Storage Upload API](https://supabase.com/docs/reference/javascript/storage-from-upload)

