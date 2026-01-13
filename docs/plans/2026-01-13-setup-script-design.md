# Setup Script Design

**Date:** 2026-01-13
**Purpose:** Automated project setup script that clones the repo and configures Supabase + Trigger.dev

## Overview

A single bash script (`setup.sh`) that automates the entire project setup process. Users run one command and get a fully configured project with database, edge functions, and background job processing.

**Entry points:**
```bash
# Local execution
./setup.sh

# Or remote execution (after pushing to repo)
curl -fsSL https://raw.githubusercontent.com/gmgngmgn/stemar-bot/main/setup.sh | bash
```

## Complete Flow

```
Start → Clone Repo → Name Project → Install Deps → Supabase Setup → Trigger.dev Setup → API Keys → Done
```

---

## Section 1: Clone & Project Naming

**Steps:**
1. Clone repo from `https://github.com/gmgngmgn/stemar-bot.git`
2. Prompt for **project directory name** (default: `stemar-bot`)
3. Prompt for **display name / brand name** (default: `Elite Ecommerce`)
4. Rename directory if custom name provided
5. Update `package.json` name field
6. Update `src/components/dashboard/Sidebar.tsx` header text
7. Run `npm install`

**Validation:**
- Check directory doesn't already exist
- Sanitize directory name (lowercase, hyphens, no spaces)

---

## Section 2: Supabase Setup (Hybrid Approach)

### If Supabase CLI Available

1. Check `supabase` CLI installed and logged in (`supabase projects list`)
2. Ask: "Create new organization?" or "Use existing organization?"
3. If existing, list orgs and let user choose
4. Create project in chosen org
5. Run migrations via CLI
6. Deploy edge functions
7. Set edge function secrets

### If No CLI (Fallback)

1. Prompt for credentials:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
2. Run migrations via Supabase Management API
3. Deploy edge functions via API
4. Set secrets via API

### Database Schema

**Tables to create:**

| Table | Purpose |
|-------|---------|
| `documents` | Main knowledge base vectors (bigint id, content, embedding, metadata, fts) |
| `student_documents` | Student knowledge base vectors (same structure) |
| `chat` | Chat history (session_id, message, id) |
| `uploads` | Tracks uploaded files and processing status |
| `upload_vectors` | Links uploads to vector chunk IDs |
| `metadata_fields` | User-defined extraction fields |

**Functions to create:**

```sql
-- hybrid_search: RRF combining keyword + semantic search on documents table
CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_text text,
  query_embedding vector,
  match_count integer,
  full_text_weight double precision DEFAULT 1,
  semantic_weight double precision DEFAULT 1,
  rrf_k integer DEFAULT 50
) RETURNS TABLE(...) LANGUAGE sql AS $function$
  -- Full-text search + semantic search combined via RRF
$function$;

-- student_hybrid_search: Same for student_documents table
CREATE OR REPLACE FUNCTION public.student_hybrid_search(...) ...;
```

**Edge Functions to deploy:**

| Function | Purpose |
|----------|---------|
| `hybrid_search_function` | API endpoint for main knowledge base search |
| `student_hybrid_search_function` | API endpoint for student knowledge base search |

**Edge Function Secrets:**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

---

## Section 3: Trigger.dev Setup

**Steps:**
1. Run `npx trigger.dev@latest init`
2. Browser opens for authentication
3. User creates/selects project
4. CLI updates `trigger.config.ts` with new project ID
5. Capture `TRIGGER_SECRET_KEY`

---

## Section 4: API Keys (Optional)

**Prompt:** "Do you want to enter API keys now? (y/n)"

**If yes, prompt for:**
- `ASSEMBLYAI_API_KEY` - audio/video transcription
- `SCRAPE_CREATORS_API_KEY` - YouTube transcript fetching
- `OPENAI_API_KEY` - embeddings (also set in Supabase secrets)

**If no:**
- Create `.env.local` with placeholder comments

---

## Section 5: Finalize

**Output `.env.local`:**
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# AI Services
ASSEMBLYAI_API_KEY=xxx
SCRAPE_CREATORS_API_KEY=xxx
OPENAI_API_KEY=sk-xxx

# Trigger.dev
TRIGGER_SECRET_KEY=tr_dev_xxx
```

**Display summary:**
- Project location and names
- Supabase resources created
- Trigger.dev project linked
- Missing API keys (if any)
- Next steps to run the app

**Optionally ask:** "Start dev server now? (y/n)"

---

## Technical Implementation Notes

### Script Structure

```bash
#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Functions
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }

# Main flow
clone_repo()
prompt_project_name()
prompt_display_name()
install_dependencies()
setup_supabase()
setup_trigger_dev()
configure_api_keys()
finalize()
```

### Supabase CLI Commands

```bash
# Check login
supabase projects list

# List orgs
supabase orgs list

# Create project
supabase projects create "project-name" --org-id "org-id" --db-password "generated" --region "us-east-1"

# Run migrations
supabase db push

# Deploy edge function
supabase functions deploy hybrid_search_function

# Set secrets
supabase secrets set OPENAI_API_KEY=sk-xxx
```

### File Modifications

**package.json:** Update `name` field
**src/components/dashboard/Sidebar.tsx:** Replace "Elite Ecommerce" with display name

---

## Migration SQL (Consolidated)

The script will create a single consolidated migration file that includes:
1. Enable pgvector extension
2. Create all 6 tables with indices
3. Enable RLS and create policies
4. Create `hybrid_search` function
5. Create `student_hybrid_search` function
6. Create storage bucket
7. Create admin user placeholder
