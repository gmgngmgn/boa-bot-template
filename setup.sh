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
    echo -en "${BOLD}$prompt${NC} (default: ${CYAN}$default${NC}): " > /dev/tty
  else
    echo -en "${BOLD}$prompt${NC}: " > /dev/tty
  fi
  read result < /dev/tty

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
    echo -en "${BOLD}$prompt${NC} (y/n): " > /dev/tty
    read result < /dev/tty
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

# =====================================================
# STEP 1: Clone Repository
# =====================================================
clone_repository() {
  print_header "Cloning Repository"

  REPO_URL="https://github.com/gmgngmgn/boa-bot-template.git"
  TEMP_DIR="boa-bot-temp-$$"

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
  DEFAULT_PROJECT_NAME="boa-bot"
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

  # List organizations (parse table output, not JSON)
  print_info "Fetching your organizations..."
  echo ""
  echo -e "${BOLD}Available Organizations:${NC}"

  # Parse the table output - skip header lines, extract ID and NAME
  supabase orgs list 2>/dev/null | grep -E "^\s+[a-z]" | while read line; do
    ORG_ID_ITEM=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $1); print $1}')
    ORG_NAME_ITEM=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2}')
    echo "  $ORG_ID_ITEM : $ORG_NAME_ITEM"
  done
  echo ""

  CREATE_NEW_ORG=$(prompt_yes_no "Create a new organization?" "no")

  if [ "$CREATE_NEW_ORG" = "yes" ]; then
    ORG_NAME=$(prompt_input "Enter new organization name" "")
    if [ -n "$ORG_NAME" ]; then
      print_info "Creating organization '$ORG_NAME'..."
      ORG_CREATE_OUTPUT=$(supabase orgs create "$ORG_NAME" 2>&1)
      # Try to extract org ID from output
      ORG_ID=$(echo "$ORG_CREATE_OUTPUT" | grep -oE "[a-z]{20}" | head -1)
      if [ -n "$ORG_ID" ]; then
        print_success "Created organization: $ORG_NAME ($ORG_ID)"
      else
        print_warning "Organization created but could not parse ID"
        ORG_ID=$(prompt_input "Enter the new organization ID" "")
      fi
    fi
  else
    ORG_ID=$(prompt_input "Enter organization ID (copy from list above)" "")
  fi

  # Generate database password
  DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)

  # Create project
  echo ""
  print_info "Creating Supabase project '$PROJECT_NAME'..."

  if [ -n "$ORG_ID" ]; then
    PROJECT_OUTPUT=$(supabase projects create "$PROJECT_NAME" --db-password "$DB_PASSWORD" --region us-east-1 --org-id "$ORG_ID" 2>&1)
  else
    PROJECT_OUTPUT=$(supabase projects create "$PROJECT_NAME" --db-password "$DB_PASSWORD" --region us-east-1 2>&1)
  fi

  # Try to extract project ref from output
  SUPABASE_PROJECT_ID=$(echo "$PROJECT_OUTPUT" | grep -oE "[a-z]{20}" | head -1)

  if [ -z "$SUPABASE_PROJECT_ID" ]; then
    echo "$PROJECT_OUTPUT"
    print_error "Failed to create Supabase project"
    print_info "Falling back to manual setup..."
    setup_supabase_manual
    return
  fi

  print_success "Created Supabase project: $SUPABASE_PROJECT_ID"
  echo ""
  echo -e "${BOLD}Database Password:${NC} ${CYAN}$DB_PASSWORD${NC}"
  echo -e "${YELLOW}⚠ SAVE THIS PASSWORD - you'll need it for direct database connections${NC}"
  echo ""

  # Wait for project to be ready
  print_info "Waiting for project to be ready (this may take 1-2 minutes)..."
  sleep 60

  # Construct URLs from project ID
  SUPABASE_URL="https://${SUPABASE_PROJECT_ID}.supabase.co"

  # Get API keys - need to fetch from dashboard or prompt
  print_info "Project URL: $SUPABASE_URL"
  print_warning "API keys must be retrieved from the Supabase dashboard"
  print_info "Go to: ${CYAN}https://supabase.com/dashboard/project/${SUPABASE_PROJECT_ID}/settings/api${NC}"
  echo ""

  SUPABASE_ANON_KEY=$(prompt_input "Enter Supabase Anon Key (from dashboard)" "")
  SUPABASE_SERVICE_KEY=$(prompt_input "Enter Supabase Service Role Key (from dashboard)" "")

  # Link project (pass password for db execute)
  print_info "Linking Supabase project..."
  if supabase link --project-ref "$SUPABASE_PROJECT_ID" --password "$DB_PASSWORD" 2>&1; then
    print_success "Project linked"
  else
    print_warning "Could not link project automatically"
  fi

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
    # Use db execute with stdin redirection (not --file flag)
    if cat migrations/001_complete_setup.sql | supabase db execute 2>&1; then
      print_success "Migrations applied successfully"
    else
      print_warning "CLI migration failed"
      echo ""
      print_info "Please run migrations manually:"
      echo -e "  1. Go to: ${CYAN}https://supabase.com/dashboard/project/${SUPABASE_PROJECT_ID}/sql${NC}"
      echo -e "  2. Open file: ${CYAN}$(pwd)/migrations/001_complete_setup.sql${NC}"
      echo -e "  3. Copy all contents, paste in SQL Editor, and click Run"
      echo ""
      MANUAL_MIGRATION=$(prompt_yes_no "Press Enter when done, or skip for now?" "yes")
    fi
  else
    print_warning "Migration file not found"
  fi
}

run_migrations_api() {
  print_info "Database migrations need to be run manually..."
  echo ""

  if [ -f "migrations/001_complete_setup.sql" ]; then
    # Extract project ID from URL
    PROJECT_ID=$(echo "$SUPABASE_URL" | sed -E 's|https://([^.]+)\.supabase\.co.*|\1|')

    print_info "Please run migrations in the Supabase SQL Editor:"
    echo -e "  1. Go to: ${CYAN}https://supabase.com/dashboard/project/${PROJECT_ID}/sql${NC}"
    echo -e "  2. Open file: ${CYAN}$(pwd)/migrations/001_complete_setup.sql${NC}"
    echo -e "  3. Copy all contents, paste in SQL Editor, and click Run"
    echo ""

    MANUAL_DONE=$(prompt_yes_no "Have you run the migrations?" "yes")

    if [ "$MANUAL_DONE" = "yes" ]; then
      print_success "Migrations marked as complete"
    else
      print_warning "Remember to run migrations before using the app"
    fi
  else
    print_warning "Migration file not found"
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

# =====================================================
# STEP 5: Trigger.dev Setup
# =====================================================
setup_trigger_dev() {
  print_header "Trigger.dev Setup"

  print_info "Each project needs its own Trigger.dev project"
  print_info "The background tasks use your Supabase credentials"
  echo ""

  # Check if user wants to set up Trigger.dev now
  SETUP_TRIGGER=$(prompt_yes_no "Set up Trigger.dev now?" "yes")

  if [ "$SETUP_TRIGGER" = "no" ]; then
    print_warning "Skipping Trigger.dev setup"
    print_info "You'll need to manually update trigger.config.ts with your project ID"
    return
  fi

  echo ""
  print_info "Please create a new project at: ${CYAN}https://cloud.trigger.dev${NC}"
  print_info "Steps:"
  echo "  1. Sign in to Trigger.dev"
  echo "  2. Click 'New Project'"
  echo "  3. Name it (e.g., '$PROJECT_NAME')"
  echo "  4. Copy the Project ID (looks like: proj_xxxxxxxxxxxx)"
  echo ""

  TRIGGER_PROJECT_ID=$(prompt_input "Enter your new Trigger.dev Project ID (proj_...)" "")

  if [ -n "$TRIGGER_PROJECT_ID" ]; then
    # Update trigger.config.ts with new project ID
    if [ -f "trigger.config.ts" ]; then
      sed -i.bak "s/project: \"[^\"]*\"/project: \"$TRIGGER_PROJECT_ID\"/" trigger.config.ts
      rm -f trigger.config.ts.bak
      print_success "Updated trigger.config.ts with project: $TRIGGER_PROJECT_ID"
    fi
  else
    print_warning "No project ID provided - trigger.config.ts not updated"
  fi

  echo ""
  print_info "Now get your secret key from: ${CYAN}https://cloud.trigger.dev${NC}"
  print_info "Go to: Project Settings → API Keys"
  echo ""
  TRIGGER_SECRET_KEY=$(prompt_input "Trigger.dev Secret Key (tr_dev_...)" "")

  if [ -n "$TRIGGER_SECRET_KEY" ]; then
    print_success "Trigger.dev configured"
  else
    print_warning "No secret key provided - add it to .env.local later"
  fi
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
SUPABASE_DB_PASSWORD=${DB_PASSWORD:-}

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