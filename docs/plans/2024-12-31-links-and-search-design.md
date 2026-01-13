# Links Upload & Content Search Feature Design

## Overview

Add two features to the document ingestion system:
1. **Link uploads** - Store external links as searchable reference resources
2. **Content search** - Hybrid instant filter + semantic search in the Content area

## Feature 1: Link Uploads

### Purpose

Users can store external links (Google Docs, Notion pages, Instagram profiles, etc.) as reference resources. These links become searchable via RAG - when users query the system, relevant links surface alongside document content.

### UI: New "Links" Tab

Add a "links" tab to the Upload page (`/dashboard/transcribe`) alongside video, audio, documents, youtube.

### Form Fields

| Field | Required | Description |
|-------|----------|-------------|
| Link Name | Yes | Searchable title, e.g., "TSL Framework - Direct Lead" |
| Link URL | Yes | The actual URL |
| Description | No | Additional context for better RAG matching |
| Associated Content | No | Searchable multi-select to pick related videos/documents |

### Workflow

1. User enters name, URL, optional description
2. Optionally searches and selects related content (multi-select)
3. Clicks "Save Link"
4. System creates record, embeds name+description for RAG retrieval
5. Redirects to Content page

### Database Schema

New `links` table:

```sql
CREATE TABLE links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  associated_document_ids UUID[] DEFAULT '{}',
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Association Behavior

- **Grouping**: Filter/view all links related to a specific document
- **RAG context**: When associated content matches a query, linked resources boost in relevance

### Standalone Links

Links work without associations. Name + description get embedded, RAG matches based on semantic similarity to queries.

---

## Feature 2: Content Search

### UI Changes to DocumentsTable

Add to toolbar (alongside date filters):
- Search input field with placeholder "Filter by name..."
- Search icon button to trigger semantic search

### Instant Filter (Client-side)

- As user types, immediately filters visible table rows by filename/name
- Works alongside existing date filters
- No loading state, immediate feedback

### Semantic Search (Server-side)

Triggered by: clicking search button OR pressing Enter

Opens a modal/drawer "Search Results" view showing:
- Results ranked by relevance score
- Each result displays:
  - Document/link name
  - Type badge (video, document, link, etc.)
  - Relevance score indicator
  - Snippet showing why it matched (from transcript/description)
- Click result to navigate or highlight in table

### What Gets Searched

- Document filenames and transcript text
- Link names and descriptions
- Associated content relationships boost relevance

---

## Feature 3: Links in Content Table

### Display

Links appear in DocumentsTable alongside documents/videos:

| Checkbox | ID | Source | Status | Created | Actions |
|----------|-----|--------|--------|---------|---------|
| ☐ | abc123... | (link icon) TSL Framework | — | Dec 31, 2024 | View / Delete |

### Differences from Documents

- **Icon**: Link icon instead of FileText
- **Status**: No processing status (links are instant)
- **View action**: Opens URL in new tab
- **Row expand**: Shows associated documents (optional enhancement)

### Type Filter

Add optional "Type" filter dropdown to toolbar: All / Documents / Videos / Links

---

## Implementation Components

### New Files

- `components/dashboard/LinkUpload.tsx` - Form with name, URL, description, searchable multi-select
- `components/dashboard/SearchResults.tsx` - Modal/drawer for semantic search results

### API Endpoints

- `POST /api/links` - Create link + generate embedding
- `GET /api/links` - List links (for content table)
- `DELETE /api/links/[id]` - Delete link
- `GET /api/search` - Semantic search across documents + links

### UI Updates

- Add "links" tab to Upload page tabs array
- Add search input + button to DocumentsTable toolbar
- Update DocumentsTable to fetch and display links
- Add type filter dropdown (optional)

---

## Notes

- Links don't require processing - they're stored immediately
- Embedding generated from: `{name} {description}` concatenated
- Use existing embedding infrastructure (same model as documents)
- Associated documents stored as UUID array for flexibility
