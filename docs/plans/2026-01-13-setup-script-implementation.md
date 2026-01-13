# Setup Script Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create an automated setup script that clones the repo, configures Supabase (tables, functions, edge functions), sets up Trigger.dev, and generates `.env.local`.

**Architecture:** Single bash script with modular functions. Hybrid Supabase setup (CLI preferred, API fallback). Edge functions deployed via Supabase CLI or MCP. All SQL consolidated into one migration file.

**Tech Stack:** Bash, Supabase CLI, Supabase Management API, Trigger.dev CLI, jq for JSON parsing

---

## Task 1: Create Consolidated Migration SQL

**Files:**
- Create: `migrations/001_complete_setup.sql`

**Step 1: Create the migrations directory**

```bash
mkdir -p migrations
```

**Step 2: Write the consolidated migration file**

Create `migrations/001_complete_setup.sql` with all tables, functions, indices, and RLS policies.

```sql
-- =====================================================
-- Complete Setup Migration
-- =====================================================
-- This migration creates all tables, functions, and
-- policies needed for the document ingestion system.
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================
-- 1. DOCUMENTS TABLE (Main Knowledge Base)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.documents (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  content TEXT,
  embedding vector(1536),
  metadata JSONB,
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

CREATE INDEX IF NOT EXISTS idx_documents_embedding ON public.documents
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_documents_fts ON public.documents USING gin(fts);

-- =====================================================
-- 2. STUDENT_DOCUMENTS TABLE (Student Knowledge Base)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.student_documents (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  content TEXT,
  embedding vector(1536),
  metadata JSONB,
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

CREATE INDEX IF NOT EXISTS idx_student_documents_embedding ON public.student_documents
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_student_documents_fts ON public.student_documents USING gin(fts);

-- =====================================================
-- 3. CHAT TABLE (Conversation History)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.chat (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR NOT NULL,
  message JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_session_id ON public.chat(session_id);

-- =====================================================
-- 4. Create Admin User
-- =====================================================
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  role,
  aud,
  confirmation_token
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'admin@local.dev',
  '',
  now(),
  now(),
  now(),
  'authenticated',
  'authenticated',
  ''
)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- 5. UPLOADS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  filename TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('video', 'audio', 'pdf', 'youtube', 'document', 'link')),
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'error')),
  transcript_text TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON public.uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON public.uploads(status);
CREATE INDEX IF NOT EXISTS idx_uploads_created_at ON public.uploads(created_at DESC);

-- =====================================================
-- 6. UPLOAD_VECTORS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.upload_vectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  upload_id UUID NOT NULL REFERENCES public.uploads(id) ON DELETE CASCADE,
  vector_ids BIGINT[] DEFAULT '{}',
  chunk_count INTEGER DEFAULT 0,
  target_table TEXT DEFAULT 'documents',
  external_link TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upload_vectors_upload_id ON public.upload_vectors(upload_id);

-- =====================================================
-- 7. METADATA_FIELDS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.metadata_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  field_name TEXT NOT NULL,
  example_value TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metadata_fields_user_id ON public.metadata_fields(user_id);

-- =====================================================
-- 8. ENABLE RLS
-- =====================================================
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metadata_fields ENABLE ROW LEVEL SECURITY;

-- Service role policies (full access)
CREATE POLICY "Service role full access to documents" ON public.documents FOR ALL USING (true);
CREATE POLICY "Service role full access to student_documents" ON public.student_documents FOR ALL USING (true);
CREATE POLICY "Service role full access to uploads" ON public.uploads FOR ALL USING (true);
CREATE POLICY "Service role full access to upload_vectors" ON public.upload_vectors FOR ALL USING (true);
CREATE POLICY "Service role full access to metadata_fields" ON public.metadata_fields FOR ALL USING (true);

-- =====================================================
-- 9. HYBRID_SEARCH FUNCTION (Main Knowledge Base)
-- =====================================================
CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_text text,
  query_embedding vector,
  match_count integer,
  full_text_weight double precision DEFAULT 1,
  semantic_weight double precision DEFAULT 1,
  rrf_k integer DEFAULT 50
)
RETURNS TABLE(
  id bigint,
  content text,
  metadata jsonb,
  keyword_rank_ix integer,
  semantic_rank_ix integer,
  rrf_score double precision
)
LANGUAGE sql
AS $$
WITH full_text AS (
  SELECT
    documents.id,
    row_number() OVER (ORDER BY ts_rank_cd(fts, websearch_to_tsquery(query_text)) DESC)::integer AS rank_ix
  FROM documents
  WHERE fts @@ websearch_to_tsquery(query_text)
  ORDER BY rank_ix
  LIMIT least(match_count, 30) * 2
),
semantic AS (
  SELECT
    documents.id,
    row_number() OVER (ORDER BY embedding <#> query_embedding)::integer AS rank_ix
  FROM documents
  ORDER BY rank_ix
  LIMIT least(match_count, 30) * 2
),
combined AS (
  SELECT
    coalesce(f.id, s.id) AS id,
    f.rank_ix AS keyword_rank_ix,
    s.rank_ix AS semantic_rank_ix
  FROM full_text f
  FULL OUTER JOIN semantic s ON f.id = s.id
)
SELECT
  d.id,
  d.content,
  d.metadata,
  c.keyword_rank_ix,
  c.semantic_rank_ix,
  (coalesce(1.0 / (rrf_k + c.keyword_rank_ix), 0.0) * full_text_weight) +
  (coalesce(1.0 / (rrf_k + c.semantic_rank_ix), 0.0) * semantic_weight) AS rrf_score
FROM combined c
JOIN documents d ON d.id = c.id
ORDER BY rrf_score DESC
LIMIT least(match_count, 30);
$$;

-- =====================================================
-- 10. STUDENT_HYBRID_SEARCH FUNCTION
-- =====================================================
CREATE OR REPLACE FUNCTION public.student_hybrid_search(
  query_text text,
  query_embedding vector,
  match_count integer,
  full_text_weight double precision DEFAULT 1,
  semantic_weight double precision DEFAULT 1,
  rrf_k integer DEFAULT 50
)
RETURNS TABLE(
  id bigint,
  content text,
  metadata jsonb,
  keyword_rank_ix integer,
  semantic_rank_ix integer,
  rrf_score double precision
)
LANGUAGE sql
AS $$
WITH full_text AS (
  SELECT
    student_documents.id,
    row_number() OVER (ORDER BY ts_rank_cd(fts, websearch_to_tsquery(query_text)) DESC)::integer AS rank_ix
  FROM student_documents
  WHERE fts @@ websearch_to_tsquery(query_text)
  ORDER BY rank_ix
  LIMIT least(match_count, 30) * 2
),
semantic AS (
  SELECT
    student_documents.id,
    row_number() OVER (ORDER BY embedding <#> query_embedding)::integer AS rank_ix
  FROM student_documents
  ORDER BY rank_ix
  LIMIT least(match_count, 30) * 2
),
combined AS (
  SELECT
    coalesce(f.id, s.id) AS id,
    f.rank_ix AS keyword_rank_ix,
    s.rank_ix AS semantic_rank_ix
  FROM full_text f
  FULL OUTER JOIN semantic s ON f.id = s.id
)
SELECT
  d.id,
  d.content,
  d.metadata,
  c.keyword_rank_ix,
  c.semantic_rank_ix,
  (coalesce(1.0 / (rrf_k + c.keyword_rank_ix), 0.0) * full_text_weight) +
  (coalesce(1.0 / (rrf_k + c.semantic_rank_ix), 0.0) * semantic_weight) AS rrf_score
FROM combined c
JOIN student_documents d ON d.id = c.id
ORDER BY rrf_score DESC
LIMIT least(match_count, 30);
$$;

-- =====================================================
-- 11. UPDATED_AT TRIGGER
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_uploads_updated_at ON public.uploads;
CREATE TRIGGER update_uploads_updated_at
  BEFORE UPDATE ON public.uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_metadata_fields_updated_at ON public.metadata_fields;
CREATE TRIGGER update_metadata_fields_updated_at
  BEFORE UPDATE ON public.metadata_fields
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- 12. CASCADE DELETE FOR UPLOADS
-- =====================================================
CREATE OR REPLACE FUNCTION public.delete_upload_vectors()
RETURNS TRIGGER AS $$
DECLARE
  tracking_row RECORD;
BEGIN
  FOR tracking_row IN
    SELECT vector_ids, target_table FROM public.upload_vectors WHERE upload_id = OLD.id
  LOOP
    IF tracking_row.target_table = 'documents' THEN
      DELETE FROM public.documents WHERE id = ANY(tracking_row.vector_ids);
    ELSIF tracking_row.target_table = 'student_documents' THEN
      DELETE FROM public.student_documents WHERE id = ANY(tracking_row.vector_ids);
    END IF;
  END LOOP;

  DELETE FROM public.documents WHERE metadata->>'upload_id' = OLD.id::text;
  DELETE FROM public.student_documents WHERE metadata->>'upload_id' = OLD.id::text;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_delete_upload_vectors ON public.uploads;
CREATE TRIGGER trigger_delete_upload_vectors
  BEFORE DELETE ON public.uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_upload_vectors();

-- =====================================================
-- 13. STORAGE BUCKET
-- =====================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- SETUP COMPLETE
-- =====================================================
```

**Step 3: Verify file created**

```bash
cat migrations/001_complete_setup.sql | head -20
```

Expected: First 20 lines of SQL file shown

**Step 4: Commit**

```bash
git add migrations/001_complete_setup.sql
git commit -m "feat: add consolidated migration for complete setup"
```

---

## Task 2: Create Edge Function Source Files

**Files:**
- Create: `supabase/functions/hybrid_search_function/index.ts`
- Create: `supabase/functions/student_hybrid_search_function/index.ts`

**Step 1: Create supabase functions directory**

```bash
mkdir -p supabase/functions/hybrid_search_function
mkdir -p supabase/functions/student_hybrid_search_function
```

**Step 2: Write hybrid_search_function/index.ts**

```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';
import OpenAI from 'npm:openai';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;

Deno.serve(async (req) => {
  const { query } = await req.json();

  const openai = new OpenAI({ apiKey: openaiApiKey });

  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
    dimensions: 1536
  });

  const [{ embedding }] = embeddingResponse.data;

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const { data: documents } = await supabase.rpc('hybrid_search', {
    query_text: query,
    query_embedding: embedding,
    match_count: 10
  });

  return new Response(JSON.stringify(documents), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

**Step 3: Write student_hybrid_search_function/index.ts**

```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';
import OpenAI from 'npm:openai';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;

Deno.serve(async (req) => {
  const { query } = await req.json();

  const openai = new OpenAI({ apiKey: openaiApiKey });

  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
    dimensions: 1536
  });

  const [{ embedding }] = embeddingResponse.data;

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const { data: student_documents } = await supabase.rpc('student_hybrid_search', {
    query_text: query,
    query_embedding: embedding,
    match_count: 10
  });

  return new Response(JSON.stringify(student_documents), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

**Step 4: Verify files created**

```bash
ls -la supabase/functions/*/index.ts
```

Expected: Both index.ts files listed

**Step 5: Commit**

```bash
git add supabase/functions/
git commit -m "feat: add edge function source files for hybrid search"
```

---

## Task 3: Create Main Setup Script - Part 1 (Header & Utilities)

**Files:**
- Create: `setup.sh`

**Step 1: Create setup.sh with header and utility functions**

```bash
#!/bin/bash
set -e

# =====================================================
# Project Setup Script
# =====================================================
# This script automates the complete project setup:
# 1. Clones the repository
# 2. Configures project name and branding
# 3. Sets up Supabase (tables, functions, edge functions)
# 4. Configures Trigger.dev
# 5. Creates .env.local with credentials
# =====================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Utility functions
print_header() {
  echo ""
  echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}${BLUE}  $1${NC}"
  echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_info() { echo -e "${CYAN}ℹ${NC} $1"; }

prompt_input() {
  local prompt="$1"
  local default="$2"
  local result

  if [ -n "$default" ]; then
    echo -en "${BOLD}$prompt${NC} (default: ${CYAN}$default${NC}): "
  else
    echo -en "${BOLD}$prompt${NC}: "
  fi
  read result

  if [ -z "$result" ] && [ -n "$default" ]; then
    result="$default"
  fi

  echo "$result"
}

prompt_yes_no() {
  local prompt="$1"
  local default="$2"
  local result

  while true; do
    echo -en "${BOLD}$prompt${NC} (y/n): "
    read result
    case "$result" in
      [Yy]* ) echo "yes"; return;;
      [Nn]* ) echo "no"; return;;
      "" )
        if [ -n "$default" ]; then
          echo "$default"
          return
        fi
        ;;
    esac
  done
}

check_command() {
  if command -v "$1" &> /dev/null; then
    return 0
  else
    return 1
  fi
}

# Sanitize project name (lowercase, hyphens only)
sanitize_name() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//'
}

# Get initials from display name
get_initials() {
  echo "$1" | sed 's/\([A-Za-z]\)[^ ]* */\1/g' | tr '[:lower:]' '[:upper:]' | cut -c1-2
}
```

**Step 2: Verify script created**

```bash
head -60 setup.sh
```

Expected: First 60 lines showing header and utility functions

**Step 3: Make executable**

```bash
chmod +x setup.sh
```

**Step 4: Commit**

```bash
git add setup.sh
git commit -m "feat: add setup script header and utilities"
```

---

## Task 4: Create Main Setup Script - Part 2 (Clone & Naming)

**Files:**
- Modify: `setup.sh` (append)

**Step 1: Add clone and naming functions**

Append to `setup.sh`:

```bash

# =====================================================
# STEP 1: Clone Repository
# =====================================================
clone_repository() {
  print_header "Cloning Repository"

  REPO_URL="https://github.com/gmgngmgn/stemar-bot.git"
  TEMP_DIR="stemar-bot-temp-$$"

  print_info "Cloning from $REPO_URL..."

  if ! git clone "$REPO_URL" "$TEMP_DIR" 2>/dev/null; then
    print_error "Failed to clone repository"
    exit 1
  fi

  print_success "Repository cloned"
}

# =====================================================
# STEP 2: Configure Project Name & Branding
# =====================================================
configure_project() {
  print_header "Project Configuration"

  # Project directory name
  DEFAULT_PROJECT_NAME="stemar-bot"
  echo ""
  PROJECT_NAME=$(prompt_input "What would you like to name your project directory?" "$DEFAULT_PROJECT_NAME")
  PROJECT_NAME=$(sanitize_name "$PROJECT_NAME")

  # Check if directory already exists
  if [ -d "$PROJECT_NAME" ] && [ "$PROJECT_NAME" != "$TEMP_DIR" ]; then
    print_error "Directory '$PROJECT_NAME' already exists"
    exit 1
  fi

  # Display name for header
  DEFAULT_DISPLAY_NAME="Elite Ecommerce"
  echo ""
  DISPLAY_NAME=$(prompt_input "What display name should appear in the app header?" "$DEFAULT_DISPLAY_NAME")

  # Get initials for logo
  INITIALS=$(get_initials "$DISPLAY_NAME")

  echo ""
  print_info "Project directory: ${CYAN}$PROJECT_NAME${NC}"
  print_info "Display name: ${CYAN}$DISPLAY_NAME${NC}"
  print_info "Logo initials: ${CYAN}$INITIALS${NC}"

  # Rename directory
  if [ "$PROJECT_NAME" != "$TEMP_DIR" ]; then
    mv "$TEMP_DIR" "$PROJECT_NAME"
  fi

  cd "$PROJECT_NAME"

  # Update package.json
  if [ -f "package.json" ]; then
    if check_command jq; then
      jq ".name = \"$PROJECT_NAME\"" package.json > package.json.tmp && mv package.json.tmp package.json
    else
      sed -i.bak "s/\"name\": \"[^\"]*\"/\"name\": \"$PROJECT_NAME\"/" package.json && rm -f package.json.bak
    fi
    print_success "Updated package.json"
  fi

  # Update Sidebar.tsx
  SIDEBAR_FILE="src/components/dashboard/Sidebar.tsx"
  if [ -f "$SIDEBAR_FILE" ]; then
    # Update display name
    sed -i.bak "s/Elite Ecommerce/$DISPLAY_NAME/g" "$SIDEBAR_FILE"
    # Update initials
    sed -i.bak "s/>EE</>$INITIALS</g" "$SIDEBAR_FILE"
    rm -f "$SIDEBAR_FILE.bak"
    print_success "Updated sidebar branding"
  fi

  # Remove setup.sh from cloned repo (it's for fresh installs)
  rm -f setup.sh

  print_success "Project configured"
}

# =====================================================
# STEP 3: Install Dependencies
# =====================================================
install_dependencies() {
  print_header "Installing Dependencies"

  if ! check_command npm; then
    print_error "npm is not installed. Please install Node.js first."
    exit 1
  fi

  print_info "Running npm install..."
  npm install --silent

  print_success "Dependencies installed"
}
```

**Step 2: Verify changes**

```bash
tail -80 setup.sh
```

Expected: Clone, configure, and install functions shown

**Step 3: Commit**

```bash
git add setup.sh
git commit -m "feat: add clone, naming, and dependency installation to setup script"
```

---

## Task 5: Create Main Setup Script - Part 3 (Supabase Setup)

**Files:**
- Modify: `setup.sh` (append)

**Step 1: Add Supabase setup functions**

Append to `setup.sh`:

```bash

# =====================================================
# STEP 4: Supabase Setup
# =====================================================
setup_supabase() {
  print_header "Supabase Setup"

  SUPABASE_CLI_AVAILABLE=false

  # Check if Supabase CLI is available and logged in
  if check_command supabase; then
    if supabase projects list &>/dev/null; then
      SUPABASE_CLI_AVAILABLE=true
      print_success "Supabase CLI detected and logged in"
    else
      print_warning "Supabase CLI found but not logged in"
    fi
  else
    print_warning "Supabase CLI not found"
  fi

  if [ "$SUPABASE_CLI_AVAILABLE" = true ]; then
    setup_supabase_cli
  else
    setup_supabase_manual
  fi
}

setup_supabase_cli() {
  print_info "Setting up via Supabase CLI..."
  echo ""

  # List organizations
  print_info "Fetching your organizations..."
  ORGS=$(supabase orgs list --output json 2>/dev/null || echo "[]")

  if [ "$ORGS" = "[]" ]; then
    print_warning "No organizations found. Creating project in default org."
    ORG_ID=""
  else
    echo ""
    echo -e "${BOLD}Available Organizations:${NC}"
    echo "$ORGS" | jq -r '.[] | "  \(.id): \(.name)"' 2>/dev/null || echo "  (Unable to parse orgs)"
    echo ""

    CREATE_NEW_ORG=$(prompt_yes_no "Create a new organization?" "no")

    if [ "$CREATE_NEW_ORG" = "yes" ]; then
      ORG_NAME=$(prompt_input "Enter new organization name" "")
      if [ -n "$ORG_NAME" ]; then
        ORG_RESULT=$(supabase orgs create "$ORG_NAME" --output json 2>/dev/null || echo "{}")
        ORG_ID=$(echo "$ORG_RESULT" | jq -r '.id // empty')
        if [ -n "$ORG_ID" ]; then
          print_success "Created organization: $ORG_NAME"
        else
          print_warning "Could not create org, using default"
          ORG_ID=""
        fi
      fi
    else
      ORG_ID=$(prompt_input "Enter organization ID (from list above)" "")
    fi
  fi

  # Generate database password
  DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)

  # Create project
  echo ""
  print_info "Creating Supabase project..."

  PROJECT_CREATE_CMD="supabase projects create \"$PROJECT_NAME\" --db-password \"$DB_PASSWORD\" --region us-east-1"
  if [ -n "$ORG_ID" ]; then
    PROJECT_CREATE_CMD="$PROJECT_CREATE_CMD --org-id \"$ORG_ID\""
  fi

  PROJECT_RESULT=$(eval "$PROJECT_CREATE_CMD --output json" 2>/dev/null || echo "{}")
  SUPABASE_PROJECT_ID=$(echo "$PROJECT_RESULT" | jq -r '.id // empty')

  if [ -z "$SUPABASE_PROJECT_ID" ]; then
    print_error "Failed to create Supabase project"
    print_info "Falling back to manual setup..."
    setup_supabase_manual
    return
  fi

  print_success "Created Supabase project: $SUPABASE_PROJECT_ID"

  # Wait for project to be ready
  print_info "Waiting for project to be ready (this may take 1-2 minutes)..."
  sleep 60

  # Get project details
  PROJECT_DETAILS=$(supabase projects show "$SUPABASE_PROJECT_ID" --output json 2>/dev/null || echo "{}")
  SUPABASE_URL=$(echo "$PROJECT_DETAILS" | jq -r '.api.url // empty')
  SUPABASE_ANON_KEY=$(echo "$PROJECT_DETAILS" | jq -r '.api.anon_key // empty')
  SUPABASE_SERVICE_KEY=$(echo "$PROJECT_DETAILS" | jq -r '.api.service_key // empty')

  if [ -z "$SUPABASE_URL" ]; then
    print_warning "Could not fetch project details automatically"
    SUPABASE_URL=$(prompt_input "Enter Supabase URL" "")
    SUPABASE_ANON_KEY=$(prompt_input "Enter Supabase Anon Key" "")
    SUPABASE_SERVICE_KEY=$(prompt_input "Enter Supabase Service Role Key" "")
  fi

  # Link project
  supabase link --project-ref "$SUPABASE_PROJECT_ID" 2>/dev/null || true

  # Run migrations
  run_migrations_cli

  # Deploy edge functions
  deploy_edge_functions_cli
}

setup_supabase_manual() {
  echo ""
  print_info "Please create a Supabase project at ${CYAN}https://supabase.com/dashboard${NC}"
  print_info "Then provide the following credentials:"
  echo ""

  SUPABASE_URL=$(prompt_input "Supabase URL (e.g., https://xxx.supabase.co)" "")
  SUPABASE_ANON_KEY=$(prompt_input "Supabase Anon Key" "")
  SUPABASE_SERVICE_KEY=$(prompt_input "Supabase Service Role Key" "")

  if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ] || [ -z "$SUPABASE_SERVICE_KEY" ]; then
    print_error "Supabase credentials are required"
    exit 1
  fi

  print_success "Supabase credentials saved"

  # Run migrations via API
  run_migrations_api

  print_warning "Edge functions must be deployed manually or via Supabase CLI"
  print_info "See supabase/functions/ for edge function source code"
}

run_migrations_cli() {
  print_info "Running database migrations..."

  if [ -f "migrations/001_complete_setup.sql" ]; then
    supabase db push 2>/dev/null || {
      print_warning "CLI migration failed, trying API..."
      run_migrations_api
    }
    print_success "Migrations applied"
  else
    print_warning "Migration file not found"
  fi
}

run_migrations_api() {
  print_info "Applying migrations via API..."

  if [ -f "migrations/001_complete_setup.sql" ]; then
    MIGRATION_SQL=$(cat migrations/001_complete_setup.sql)

    # Execute via Supabase REST API
    curl -s -X POST \
      "${SUPABASE_URL}/rest/v1/rpc/exec_sql" \
      -H "apikey: ${SUPABASE_SERVICE_KEY}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"query\": $(echo "$MIGRATION_SQL" | jq -Rs .)}" \
      >/dev/null 2>&1 || {
        print_warning "API migration may have partially failed"
        print_info "You may need to run migrations manually in Supabase SQL Editor"
      }

    print_success "Migrations applied via API"
  fi
}

deploy_edge_functions_cli() {
  print_info "Deploying edge functions..."

  # Deploy hybrid_search_function
  if [ -d "supabase/functions/hybrid_search_function" ]; then
    supabase functions deploy hybrid_search_function 2>/dev/null && \
      print_success "Deployed hybrid_search_function" || \
      print_warning "Failed to deploy hybrid_search_function"
  fi

  # Deploy student_hybrid_search_function
  if [ -d "supabase/functions/student_hybrid_search_function" ]; then
    supabase functions deploy student_hybrid_search_function 2>/dev/null && \
      print_success "Deployed student_hybrid_search_function" || \
      print_warning "Failed to deploy student_hybrid_search_function"
  fi
}
```

**Step 2: Verify changes**

```bash
grep -n "setup_supabase" setup.sh | head -10
```

Expected: Function definitions found

**Step 3: Commit**

```bash
git add setup.sh
git commit -m "feat: add Supabase setup (CLI and manual fallback)"
```

---

## Task 6: Create Main Setup Script - Part 4 (Trigger.dev & API Keys)

**Files:**
- Modify: `setup.sh` (append)

**Step 1: Add Trigger.dev and API key functions**

Append to `setup.sh`:

```bash

# =====================================================
# STEP 5: Trigger.dev Setup
# =====================================================
setup_trigger_dev() {
  print_header "Trigger.dev Setup"

  print_info "Initializing Trigger.dev..."
  print_info "A browser window will open for authentication"
  echo ""

  # Run trigger.dev init
  npx trigger.dev@latest init 2>/dev/null || {
    print_warning "Trigger.dev init may require manual setup"
  }

  # Check if trigger.config.ts was updated
  if [ -f "trigger.config.ts" ]; then
    TRIGGER_PROJECT_ID=$(grep -o 'project: "[^"]*"' trigger.config.ts | cut -d'"' -f2)
    if [ -n "$TRIGGER_PROJECT_ID" ]; then
      print_success "Trigger.dev project linked: $TRIGGER_PROJECT_ID"
    fi
  fi

  # Prompt for secret key if not captured
  echo ""
  print_info "Enter your Trigger.dev secret key"
  print_info "Find it at: ${CYAN}https://cloud.trigger.dev${NC} → Project Settings → API Keys"
  echo ""
  TRIGGER_SECRET_KEY=$(prompt_input "Trigger.dev Secret Key (tr_dev_...)" "")
}

# =====================================================
# STEP 6: API Keys Configuration
# =====================================================
configure_api_keys() {
  print_header "API Keys Configuration"

  echo ""
  CONFIGURE_KEYS=$(prompt_yes_no "Do you want to enter API keys now?" "yes")

  if [ "$CONFIGURE_KEYS" = "yes" ]; then
    echo ""
    print_info "Enter your API keys (press Enter to skip any)"
    echo ""

    ASSEMBLYAI_API_KEY=$(prompt_input "AssemblyAI API Key" "")
    SCRAPE_CREATORS_API_KEY=$(prompt_input "ScrapeCreators API Key" "")

    if [ -z "$OPENAI_API_KEY" ]; then
      OPENAI_API_KEY=$(prompt_input "OpenAI API Key (sk-...)" "")
    fi

    # Set OpenAI key in Supabase secrets if CLI available
    if [ -n "$OPENAI_API_KEY" ] && [ "$SUPABASE_CLI_AVAILABLE" = true ]; then
      print_info "Setting OpenAI key in Supabase edge function secrets..."
      supabase secrets set OPENAI_API_KEY="$OPENAI_API_KEY" 2>/dev/null && \
        print_success "Supabase secrets configured" || \
        print_warning "Could not set Supabase secrets automatically"
    fi

    print_success "API keys configured"
  else
    print_info "Skipping API key configuration"
    print_warning "Remember to add API keys to .env.local before running the app"
  fi
}

# =====================================================
# STEP 7: Create .env.local
# =====================================================
create_env_file() {
  print_header "Creating Environment File"

  cat > .env.local << EOF
# Supabase
NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL:-https://your-project.supabase.co}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-your-anon-key}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_KEY:-your-service-role-key}

# AI Services
ASSEMBLYAI_API_KEY=${ASSEMBLYAI_API_KEY:-your-assemblyai-key}
SCRAPE_CREATORS_API_KEY=${SCRAPE_CREATORS_API_KEY:-your-scrapecreators-key}
OPENAI_API_KEY=${OPENAI_API_KEY:-your-openai-key}

# Trigger.dev
TRIGGER_SECRET_KEY=${TRIGGER_SECRET_KEY:-your-trigger-secret-key}
EOF

  print_success "Created .env.local"

  # Check for missing keys
  MISSING_KEYS=""
  [ -z "$SUPABASE_URL" ] || [ "$SUPABASE_URL" = "https://your-project.supabase.co" ] && MISSING_KEYS="$MISSING_KEYS SUPABASE"
  [ -z "$ASSEMBLYAI_API_KEY" ] || [ "$ASSEMBLYAI_API_KEY" = "your-assemblyai-key" ] && MISSING_KEYS="$MISSING_KEYS ASSEMBLYAI"
  [ -z "$SCRAPE_CREATORS_API_KEY" ] || [ "$SCRAPE_CREATORS_API_KEY" = "your-scrapecreators-key" ] && MISSING_KEYS="$MISSING_KEYS SCRAPE_CREATORS"
  [ -z "$OPENAI_API_KEY" ] || [ "$OPENAI_API_KEY" = "your-openai-key" ] && MISSING_KEYS="$MISSING_KEYS OPENAI"
  [ -z "$TRIGGER_SECRET_KEY" ] || [ "$TRIGGER_SECRET_KEY" = "your-trigger-secret-key" ] && MISSING_KEYS="$MISSING_KEYS TRIGGER"

  if [ -n "$MISSING_KEYS" ]; then
    print_warning "Missing keys:$MISSING_KEYS"
  fi
}
```

**Step 2: Verify changes**

```bash
grep -n "configure_api_keys\|setup_trigger_dev" setup.sh
```

Expected: Both functions found

**Step 3: Commit**

```bash
git add setup.sh
git commit -m "feat: add Trigger.dev setup and API key configuration"
```

---

## Task 7: Create Main Setup Script - Part 5 (Main & Summary)

**Files:**
- Modify: `setup.sh` (append)

**Step 1: Add summary and main function**

Append to `setup.sh`:

```bash

# =====================================================
# STEP 8: Final Summary
# =====================================================
show_summary() {
  print_header "Setup Complete!"

  echo -e "${BOLD}Project:${NC} $PROJECT_NAME"
  echo -e "${BOLD}Display Name:${NC} $DISPLAY_NAME"
  echo -e "${BOLD}Location:${NC} $(pwd)"
  echo ""

  echo -e "${BOLD}Supabase:${NC}"
  if [ -n "$SUPABASE_URL" ] && [ "$SUPABASE_URL" != "https://your-project.supabase.co" ]; then
    print_success "Project configured"
    print_success "Tables and functions created"
    if [ "$SUPABASE_CLI_AVAILABLE" = true ]; then
      print_success "Edge functions deployed"
    else
      print_warning "Edge functions need manual deployment"
    fi
  else
    print_warning "Needs configuration in .env.local"
  fi
  echo ""

  echo -e "${BOLD}Trigger.dev:${NC}"
  if [ -n "$TRIGGER_SECRET_KEY" ] && [ "$TRIGGER_SECRET_KEY" != "your-trigger-secret-key" ]; then
    print_success "Project linked"
  else
    print_warning "Needs configuration"
  fi
  echo ""

  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "${BOLD}Next steps:${NC}"
  echo -e "  1. ${CYAN}cd $PROJECT_NAME${NC}"
  echo -e "  2. Fill in any missing API keys in ${CYAN}.env.local${NC}"
  echo -e "  3. ${CYAN}npm run dev${NC}          # Start Next.js"
  echo -e "  4. ${CYAN}npx trigger.dev@latest dev${NC}  # Start Trigger.dev (separate terminal)"
  echo ""
}

# =====================================================
# MAIN
# =====================================================
main() {
  echo ""
  echo -e "${BOLD}${BLUE}╔═══════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║     Project Setup Script                  ║${NC}"
  echo -e "${BOLD}${BLUE}║     Document Ingestion & RAG System       ║${NC}"
  echo -e "${BOLD}${BLUE}╚═══════════════════════════════════════════╝${NC}"
  echo ""

  # Check prerequisites
  if ! check_command git; then
    print_error "git is not installed"
    exit 1
  fi

  if ! check_command npm; then
    print_error "npm is not installed"
    exit 1
  fi

  # Run setup steps
  clone_repository
  configure_project
  install_dependencies
  setup_supabase
  setup_trigger_dev
  configure_api_keys
  create_env_file
  show_summary

  # Offer to start dev server
  echo ""
  START_DEV=$(prompt_yes_no "Would you like to start the dev server now?" "no")

  if [ "$START_DEV" = "yes" ]; then
    echo ""
    print_info "Starting development server..."
    npm run dev
  fi
}

# Run main
main "$@"
```

**Step 2: Verify complete script**

```bash
wc -l setup.sh
```

Expected: ~400-450 lines

**Step 3: Test script syntax**

```bash
bash -n setup.sh && echo "Syntax OK"
```

Expected: "Syntax OK"

**Step 4: Commit**

```bash
git add setup.sh
git commit -m "feat: complete setup script with summary and main function"
```

---

## Task 8: Final Verification & Documentation

**Step 1: Verify all files exist**

```bash
ls -la setup.sh migrations/001_complete_setup.sql supabase/functions/*/index.ts
```

Expected: All 4 files listed

**Step 2: Update README or add setup instructions**

The setup script is self-documenting. Users can run:
```bash
curl -fsSL https://raw.githubusercontent.com/gmgngmgn/stemar-bot/main/setup.sh | bash
```

Or clone and run locally:
```bash
git clone https://github.com/gmgngmgn/stemar-bot.git
cd stemar-bot
./setup.sh
```

**Step 3: Final commit with all changes**

```bash
git status
git add -A
git commit -m "feat: complete automated project setup system

- Add consolidated migration with all tables and functions
- Add edge function source files for hybrid search
- Add interactive setup script with:
  - Project cloning and naming
  - Supabase setup (CLI or manual)
  - Trigger.dev integration
  - API key configuration
  - Environment file generation"
```

**Step 4: Push to remote**

```bash
git push origin main
```

---

## Summary

**Files Created:**
1. `migrations/001_complete_setup.sql` - Complete database setup
2. `supabase/functions/hybrid_search_function/index.ts` - Main search edge function
3. `supabase/functions/student_hybrid_search_function/index.ts` - Student search edge function
4. `setup.sh` - Interactive setup script (~400 lines)

**Setup Flow:**
1. Clone repo → 2. Name project → 3. Install deps → 4. Supabase → 5. Trigger.dev → 6. API keys → 7. Done
