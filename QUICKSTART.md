# 🚀 Quick Start Guide

## 1. Run Database Migration

Copy and paste this into your Supabase SQL Editor:

**File**: `adr/migrations/002_add_document_tracking.sql`

This will:
- ✅ Create admin user (UUID: `00000000-0000-0000-0000-000000000001`)
- ✅ Create `documents` table
- ✅ Create `document_vectors` tracking table
- ✅ Create `metadata_fields` table
- ✅ Set up automatic vector cleanup trigger
- ✅ Configure RLS policies
- ✅ Create storage bucket

**Note**: The migration creates a placeholder admin user with a fixed UUID that the app uses for all operations.

---

## 2. Set Environment Variables

Make sure your `.env.local` has:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
ASSEMBLYAI_API_KEY=your_assemblyai_key
SCRAPE_CREATORS_API_KEY=your_scrapecreators_key
OPENAI_API_KEY=your_openai_key
TRIGGER_SECRET_KEY=your_trigger_secret_key
```

---

## 3. Install Dependencies

```bash
npm install
```

---

## 4. Deploy Trigger.dev Tasks

```bash
npx trigger.dev@latest deploy
```

---

## 5. Run Development Server

```bash
npm run dev
```

---

## 6. Login

1. Go to `http://localhost:3000`
2. You'll be redirected to `/login`
3. Enter password: `Dm2wXSRiU5jXu^Q4`
4. Click "Sign In"
5. You'll be redirected to `/dashboard/content`

---

## 7. Test the Flow

### Upload a Video
1. Go to **Transcribe** tab
2. Click **Video** tab
3. Drag & drop an MP4 file
4. Click "Transcribe Videos"
5. You'll be redirected to Content page

### View Progress
1. On **Content** page, you'll see your document
2. Status will show "processing" with spinner
3. Wait for it to change to "completed" ✓

### Ingest Document
1. Click "Ingest" button on completed document
2. Modal opens with:
   - Target Table: `vector_documents`
   - External Link: (enter optional URL like `https://course.com/lesson-1`)
3. Click "Start Ingestion"
4. Toast notification appears
5. Document is now searchable!

### Add Metadata Fields
1. Go to **Client Settings** tab
2. Add fields like:
   - Key: `course`, Example: `Inner Circle`
   - Key: `instructor`, Example: `John Doe`
3. Click "Add field"
4. These fields will be extracted during ingestion

### Delete Document
1. Select document(s) with checkbox
2. Click "Delete Selected"
3. Confirm deletion
4. **Vectors are automatically deleted too!**

---

## 🎯 You're Done!

The system is fully functional. All features work:
- ✅ Upload & transcribe
- ✅ View documents with real-time updates
- ✅ Ingest with external link
- ✅ Metadata extraction
- ✅ Automatic vector cleanup
- ✅ Simple password authentication

---

## 🔐 Login Credentials

**Password**: `Dm2wXSRiU5jXu^Q4`

(Stored in `app/login/page.tsx` - change it if needed)

---

## 📚 Documentation

- **README_DEPLOYMENT.md** - Full deployment guide
- **spec/BUILD_COMPLETE.md** - Build summary
- **spec/ui-flow-detailed.md** - UI specifications
- **adr/ADR-001-document-ingestion-sync.md** - Architecture decisions

---

## 🐛 If Something Doesn't Work

### 404 Error
- Make sure you ran `npm run dev`
- Check that all files are in the correct locations
- Verify Next.js is running on port 3000

### Login Not Working
- Check browser console for errors
- Verify password matches exactly
- Clear cookies and try again

### Documents Not Showing
- Run the database migration first
- Check Supabase connection
- Verify environment variables are set

### Upload Fails
- Check storage bucket exists
- Verify service role key is correct
- Check browser console for errors

---

## 🎉 Enjoy!

You now have a complete document ingestion system ready to use!

