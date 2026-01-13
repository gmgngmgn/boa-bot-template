# ADR-001: Document Ingestion with Vector Store Tracking

**Date:** 2024-11-22
**Status:** Accepted

## 1. Context

This is a **single-user application** where users can upload, transcribe, and ingest documents (videos, audio, PDFs, etc.) into their own vector database for semantic search. The vector embeddings are stored in a `vector_documents` table within the same Supabase project.

A critical requirement is data consistency: if a user deletes a source document from the UI, the corresponding vector embeddings in `vector_documents` must also be deleted to prevent orphaned data and maintain storage efficiency.

Currently, there is no explicit tracking mechanism between source documents and their generated vector chunks. While we could rely on metadata queries (e.g., `WHERE metadata->>'_document_id' = ?`), this approach is less performant and harder to audit than maintaining an explicit tracking table.

## 2. Decision

We will implement a tracking mechanism between source documents and their vector embeddings by introducing a new table and updating the ingestion pipeline.

### 2.1 New Table: `document_vectors`

We will create a table `document_vectors` to track the relationship between documents and their vector chunks:

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `uuid` (PK) | Unique identifier for the tracking record. |
| `user_id` | `uuid` (FK) | References `auth.users.id`. |
| `document_id` | `uuid` (FK) | References `documents.id`. |
| `vector_ids` | `uuid[]` | Array of IDs from `vector_documents` table. |
| `chunk_count` | `integer` | Number of chunks ingested. |
| `created_at` | `timestamptz` | Timestamp of ingestion. |

### 2.2 New Table: `documents`

We will create a `documents` table to store document metadata:

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `uuid` (PK) | Unique identifier. |
| `user_id` | `uuid` (FK) | References `auth.users.id`. |
| `filename` | `text` | Original filename. |
| `source_type` | `text` | Type: 'video', 'audio', 'pdf', 'youtube', etc. |
| `source_url` | `text` | URL or storage path. |
| `status` | `text` | Status: 'processing', 'completed', 'error'. |
| `transcript_text` | `text` | Extracted/transcribed text. |
| `metadata` | `jsonb` | Additional metadata. |
| `created_at` | `timestamptz` | Upload timestamp. |

### 2.3 Ingestion Pipeline Update

The `ingest-documents` Trigger.dev task will:
1.  Insert chunks into `vector_documents` and **capture the returned IDs**.
2.  Insert a record into `document_vectors` containing these IDs.

### 2.4 Deletion Workflow

A new `delete-document` task will:
1.  Accept a `document_id`.
2.  Look up the corresponding record in `document_vectors`.
3.  Delete rows from `vector_documents` using the stored `vector_ids`.
4.  Delete the record from `document_vectors` and `documents`.

## 3. Alternatives Considered

### Option A: Metadata-based Deletion
Query `DELETE FROM vector_documents WHERE metadata->>'_document_id' = ?`.
*   **Pros:** Simpler implementation (no tracking table needed).
*   **Cons:** Requires JSONB index for performance; less explicit; harder to audit exactly what was deleted.

### Option B: Soft Deletes
Mark records as deleted with a flag.
*   **Pros:** Non-destructive; allows undo.
*   **Cons:** Does not free up storage; complicates queries (must filter deleted records).

### Option C: Cascade Deletes via Foreign Keys
Use database foreign keys with `ON DELETE CASCADE`.
*   **Pros:** Automatic cleanup.
*   **Cons:** Requires restructuring `vector_documents` to have a `document_id` column; less flexible for future multi-table scenarios.

## 4. Rationale

Option A (tracking table) provides the best balance of explicitness, auditability, and performance. Storing an array of UUIDs is efficient (for 1000 chunks ≈ 16KB) and allows us to know exactly which vector rows belong to which document without complex metadata queries.

## 5. Consequences

*   **Storage Overhead:** Minimal (~16KB per 1000-chunk document).
*   **Complexity:** Ingestion task must capture and store returned IDs.
*   **Consistency:** Must handle partial failures (e.g., vectors inserted but tracking record fails). Trigger.dev retries mitigate this.
*   **Performance:** Deletion is a simple `DELETE WHERE id = ANY(array)` query, which is fast with proper indexing.

## 6. Implementation

### 6.1 Database Migration
Execute the migration file `adr/migrations/001_create_document_ingestion_tables.sql` in your Supabase SQL Editor.

This migration creates:
- **`documents`** table with user isolation via RLS
- **`vector_documents`** table with pgvector extension
- **`document_vectors`** tracking table with automatic cleanup
- **`metadata_fields`** table for user-defined extraction fields
- **Automatic trigger** that deletes vector chunks when documents are deleted
- **Helper function** for semantic search
- **Storage bucket** with RLS policies for file uploads

**Key Feature**: When you delete a document, a database trigger automatically deletes all associated vector chunks from `vector_documents` using the tracked IDs in `document_vectors`. No manual cleanup needed!

### 6.2 Future Steps
- Implement the `delete-document` Trigger.dev task
- Add UI for viewing/managing documents
- Add progress tracking for long-running transcriptions

