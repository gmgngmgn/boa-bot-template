export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      documents: {
        Row: {
          id: string
          user_id: string
          filename: string
          source_type: 'video' | 'audio' | 'pdf' | 'youtube' | 'document'
          source_url: string | null
          status: 'processing' | 'completed' | 'error'
          transcript_text: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          filename: string
          source_type: 'video' | 'audio' | 'pdf' | 'youtube' | 'document'
          source_url?: string | null
          status?: 'processing' | 'completed' | 'error'
          transcript_text?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          filename?: string
          source_type?: 'video' | 'audio' | 'pdf' | 'youtube' | 'document'
          source_url?: string | null
          status?: 'processing' | 'completed' | 'error'
          transcript_text?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
      }
      document_vectors: {
        Row: {
          id: string
          user_id: string
          document_id: string
          vector_ids: number[]
          chunk_count: number
          target_table: string
          external_link: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          document_id: string
          vector_ids: number[]
          chunk_count: number
          target_table?: string
          external_link?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          document_id?: string
          vector_ids?: number[]
          chunk_count?: number
          target_table?: string
          external_link?: string | null
          created_at?: string
        }
      }
      metadata_fields: {
        Row: {
          id: string
          user_id: string
          field_name: string
          example_value: string | null
          enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          field_name: string
          example_value?: string | null
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          field_name?: string
          example_value?: string | null
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
}

