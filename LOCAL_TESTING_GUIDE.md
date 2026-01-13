# Local Testing Guide for Upload Changes

## The Challenge

Locally, you won't hit Vercel's 4-5MB limit since your dev server doesn't have those restrictions. Here are several ways to test and verify the implementation works correctly:

## Method 1: Test on Vercel Preview Deploy (Best Option)

This is the most accurate way to test since it reproduces the actual production environment.

### Steps:

1. **Commit and push your changes:**
```bash
git add .
git commit -m "Fix: Implement direct client-side uploads to bypass Vercel payload limits"
git push
```

2. **Vercel will auto-deploy a preview**
   - Check your Vercel dashboard for the preview URL
   - Or create a PR and Vercel will comment with the preview link

3. **Test with a large file:**
   - Download or create a video file >5MB (e.g., 10MB test video)
   - Go to the preview URL
   - Try uploading the file
   - Should work without 413 errors

### Creating Test Files:

```bash
# Create a 10MB test video file on macOS
ffmpeg -f lavfi -i testsrc=duration=10:size=1280x720:rate=30 -pix_fmt yuv420p test-10mb.mp4

# Or create a dummy 10MB file
dd if=/dev/zero of=test-10mb.mp4 bs=1m count=10
```

## Method 2: Test Locally with Network Inspection

While you won't hit the limit locally, you can verify the new flow is working:

### Steps:

1. **Start your dev server** (already running)

2. **Open the test page:**
```bash
open http://localhost:3000/test-upload-limit.html
```

3. **Test the flow:**
   - Select a file (any size)
   - Click "Test New Method"
   - Open browser DevTools → Network tab
   - Verify you see:
     - ✅ NO call to `/api/documents/upload` (old method)
     - ✅ Call to `/api/documents/register` with small JSON payload
     - ✅ Direct call to Supabase Storage API

4. **Check the payload size:**
   - In Network tab, click on the `/api/documents/register` request
   - Look at "Request Payload" - should be tiny JSON (~1KB)
   - NOT the full file bytes

## Method 3: Verify Direct Upload Flow in Your App

### Steps:

1. **Navigate to your app:**
```bash
open http://localhost:3000/dashboard/transcribe
```

2. **Open Browser DevTools:**
   - Press F12 or Cmd+Option+I
   - Go to Network tab
   - Filter by "Fetch/XHR"

3. **Upload a video file:**
   - Select any MP4 file (even small ones work for testing)
   - Click "Transcribe Videos"

4. **Verify the network calls:**

You should see this sequence:

```
1. ✅ supabase.co/storage/v1/object/documents/...
   → Direct upload to Supabase Storage
   → Method: POST
   → Contains file bytes
   → No size limit

2. ✅ /api/documents/register
   → Method: POST
   → Payload: JSON metadata only (~1KB)
   → Contains: documentId, filename, storagePath, size

3. ✅ /api/documents/transcribe
   → Method: POST
   → Payload: JSON with documentIds
   → Starts processing
```

You should NOT see:
```
❌ /api/documents/upload
   → This was the old method
   → If you see this, the component isn't using the new code
```

## Method 4: Unit Test the Components

Create a simple test to verify the upload logic:

```bash
# In your terminal
cd /Users/ptk/Desktop/Manual\ Library/Coding/starter/ingestion-starter
```

Then create a test file:

```typescript
// test-upload.ts
import { getSupabaseBrowser } from '@/lib/supabase/client';

async function testDirectUpload() {
  const supabase = getSupabaseBrowser();
  
  // Create a test blob (simulates a file)
  const testBlob = new Blob(['test content'], { type: 'video/mp4' });
  const testFile = new File([testBlob], 'test.mp4', { type: 'video/mp4' });
  
  const userId = '00000000-0000-0000-0000-000000000001';
  const documentId = crypto.randomUUID();
  const storagePath = `${userId}/${documentId}/test.mp4`;
  
  // Test direct upload
  const { error } = await supabase.storage
    .from('documents')
    .upload(storagePath, testFile);
  
  if (error) {
    console.error('❌ Upload failed:', error);
    return false;
  }
  
  console.log('✅ Direct upload works!');
  
  // Test register endpoint
  const response = await fetch('/api/documents/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uploads: [{
        documentId,
        filename: 'test.mp4',
        storagePath,
        sourceType: 'video',
        size: testFile.size
      }]
    })
  });
  
  if (!response.ok) {
    console.error('❌ Register failed:', await response.text());
    return false;
  }
  
  console.log('✅ Register endpoint works!');
  return true;
}

// Run in browser console
testDirectUpload();
```

## Method 5: Check Supabase Storage Directly

Verify files are actually going to Supabase:

1. **Go to Supabase Dashboard:**
   - Open https://supabase.com/dashboard
   - Select your project
   - Go to Storage → documents bucket

2. **Upload a file through your app**

3. **Refresh the Storage view:**
   - You should see: `00000000-0000-0000-0000-000000000001/{uuid}/{filename}`
   - Click to preview/download
   - Verify it's the correct file

## Method 6: Compare Old vs New Payload Sizes

### Old Method (Deprecated):
```bash
# If you were to use the old endpoint (don't do this)
curl -X POST http://localhost:3000/api/documents/upload \
  -F "files=@large-video.mp4" \
  -H "Cookie: auth-session=authenticated"

# Payload size: ENTIRE FILE (e.g., 50MB)
# Would fail on Vercel with 413
```

### New Method:
```bash
# 1. Upload directly to Supabase (happens in browser)
# Payload goes to: supabase.co/storage/v1/object/documents/...
# Size: ENTIRE FILE (but doesn't touch Vercel)

# 2. Register metadata
curl -X POST http://localhost:3000/api/documents/register \
  -H "Content-Type: application/json" \
  -H "Cookie: auth-session=authenticated" \
  -d '{
    "uploads": [{
      "documentId": "uuid-here",
      "filename": "large-video.mp4",
      "storagePath": "user/uuid/large-video.mp4",
      "sourceType": "video",
      "size": 52428800
    }]
  }'

# Payload size: ~200 bytes of JSON
# Will NEVER fail with 413
```

## What to Look For

### ✅ Success Indicators:

1. **Network tab shows:**
   - Direct calls to `supabase.co` domain
   - Small JSON payloads to your API routes
   - No `/api/documents/upload` calls

2. **Files appear in Supabase Storage:**
   - Check Storage bucket in Supabase dashboard
   - Files should be under correct user path

3. **Database records created:**
   - Check `documents` table
   - Should have entries with correct `source_url`

4. **No 413 errors:**
   - Even with large files (>5MB)
   - Progress bars show during upload

### ❌ Failure Indicators:

1. **Still seeing `/api/documents/upload` calls:**
   - Component not updated correctly
   - Check imports in VideoUpload/AudioUpload

2. **413 errors on Vercel:**
   - Old code still deployed
   - Redeploy with new changes

3. **Files not in Supabase Storage:**
   - Check Supabase RLS policies
   - Verify bucket permissions
   - Check NEXT_PUBLIC_SUPABASE_ANON_KEY

## Quick Verification Checklist

- [ ] Dev server running (`npm run dev`)
- [ ] Navigate to `/dashboard/transcribe`
- [ ] Open DevTools Network tab
- [ ] Upload a video file
- [ ] See direct Supabase Storage call
- [ ] See `/api/documents/register` call (small payload)
- [ ] See `/api/documents/transcribe` call
- [ ] File appears in Supabase Storage dashboard
- [ ] Record created in `documents` table
- [ ] No errors in console

## Recommended Testing Approach

**For local development:**
1. Use Method 3 (Verify Direct Upload Flow) - quickest feedback
2. Check Supabase Storage dashboard to confirm files arrive
3. Verify database records are created

**Before deploying to production:**
1. Use Method 1 (Test on Vercel Preview) - most accurate
2. Test with files of various sizes: 1MB, 10MB, 50MB, 100MB
3. Test multiple file uploads simultaneously
4. Verify transcription jobs start correctly

## Troubleshooting

### "getSupabaseBrowser can only be called in the browser"
- This is expected on server-side
- Make sure components are marked with `'use client'`
- Check that you're not calling it in API routes

### Files upload but no database record
- Check `/api/documents/register` endpoint
- Verify response in Network tab
- Check server logs for errors

### Upload succeeds but transcription doesn't start
- Check `/api/documents/transcribe` endpoint
- Verify Inngest is running (`npx inngest-cli@latest dev`)
- Check Inngest dashboard for job status

## Next Steps

After verifying locally:

1. **Commit and push:**
```bash
git add .
git commit -m "Fix: Implement direct client-side uploads to bypass Vercel payload limits"
git push
```

2. **Test on Vercel preview deploy**

3. **Monitor production:**
   - Check Vercel logs for any 413 errors (should be gone)
   - Monitor Supabase Storage usage
   - Verify transcription jobs complete successfully

4. **Optional: Delete deprecated route**
```bash
rm src/app/api/documents/upload/route.ts
```

