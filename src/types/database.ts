export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_bootstrap_state: {
        Row: {
          admin_user_id: string | null
          completed_at: string | null
          singleton: boolean
        }
        Insert: {
          admin_user_id?: string | null
          completed_at?: string | null
          singleton?: boolean
        }
        Update: {
          admin_user_id?: string | null
          completed_at?: string | null
          singleton?: boolean
        }
        Relationships: []
      }
      admin_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expired_at: string | null
          expires_at: string
          id: string
          invited_by: string
          revoked_at: string | null
          revoked_by: string | null
          status: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expired_at?: string | null
          expires_at: string
          id?: string
          invited_by: string
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expired_at?: string | null
          expires_at?: string
          id?: string
          invited_by?: string
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
        }
        Relationships: []
      }
      admins: {
        Row: {
          created_at: string
          is_active: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          is_active?: boolean
          user_id?: string
        }
        Relationships: []
      }
      families: {
        Row: {
          created_at: string
          id: string
          import_fingerprint: string | null
          name: string
          root_person_id: string | null
          slug: string
        }
        Insert: {
          created_at?: string
          id: string
          import_fingerprint?: string | null
          name: string
          root_person_id?: string | null
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          import_fingerprint?: string | null
          name?: string
          root_person_id?: string | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "families_root_person_id_fkey"
            columns: ["root_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      family_creation_proposals: {
        Row: {
          created_at: string
          id: string
          name: string
          root_person_id: string
          slug: string
          source_family_id: string
          submission_id: string
        }
        Insert: {
          created_at?: string
          id: string
          name: string
          root_person_id: string
          slug: string
          source_family_id: string
          submission_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          root_person_id?: string
          slug?: string
          source_family_id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_creation_proposals_root_person_id_fkey"
            columns: ["root_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_creation_proposals_source_family_id_fkey"
            columns: ["source_family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_creation_proposals_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: true
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      family_membership_revisions: {
        Row: {
          base_revision_id: string | null
          created_at: string
          family_id: string
          family_membership_id: string
          id: string
          person_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["moderation_status"]
          submission_id: string | null
        }
        Insert: {
          base_revision_id?: string | null
          created_at?: string
          family_id: string
          family_membership_id: string
          id: string
          person_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          submission_id?: string | null
        }
        Update: {
          base_revision_id?: string | null
          created_at?: string
          family_id?: string
          family_membership_id?: string
          id?: string
          person_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_membership_revisions_base_fk"
            columns: ["family_membership_id", "base_revision_id"]
            isOneToOne: false
            referencedRelation: "family_membership_revisions"
            referencedColumns: ["family_membership_id", "id"]
          },
          {
            foreignKeyName: "family_membership_revisions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_membership_revisions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_membership_revisions_stable_fk"
            columns: ["family_membership_id", "family_id", "person_id"]
            isOneToOne: false
            referencedRelation: "family_memberships"
            referencedColumns: ["id", "family_id", "person_id"]
          },
          {
            foreignKeyName: "family_membership_revisions_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      family_memberships: {
        Row: {
          created_at: string
          current_revision_id: string | null
          current_revision_status:
            | Database["public"]["Enums"]["moderation_status"]
            | null
          family_id: string
          id: string
          legacy_id: string | null
          legacy_numeric_id: number | null
          person_id: string
        }
        Insert: {
          created_at?: string
          current_revision_id?: string | null
          current_revision_status?:
            | Database["public"]["Enums"]["moderation_status"]
            | null
          family_id: string
          id: string
          legacy_id?: string | null
          legacy_numeric_id?: number | null
          person_id: string
        }
        Update: {
          created_at?: string
          current_revision_id?: string | null
          current_revision_status?:
            | Database["public"]["Enums"]["moderation_status"]
            | null
          family_id?: string
          id?: string
          legacy_id?: string | null
          legacy_numeric_id?: number | null
          person_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_memberships_current_revision_fk"
            columns: ["id", "current_revision_id", "current_revision_status"]
            isOneToOne: false
            referencedRelation: "family_membership_revisions"
            referencedColumns: ["family_membership_id", "id", "status"]
          },
          {
            foreignKeyName: "family_memberships_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_memberships_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      life_event_revisions: {
        Row: {
          base_revision_id: string | null
          certainty: number | null
          created_at: string
          date_end: string | null
          date_start: string | null
          date_text: string | null
          details: string | null
          event_type: Database["public"]["Enums"]["life_event_type"]
          id: string
          life_event_id: string
          place_text: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["moderation_status"]
          submission_id: string | null
        }
        Insert: {
          base_revision_id?: string | null
          certainty?: number | null
          created_at?: string
          date_end?: string | null
          date_start?: string | null
          date_text?: string | null
          details?: string | null
          event_type: Database["public"]["Enums"]["life_event_type"]
          id: string
          life_event_id: string
          place_text?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          submission_id?: string | null
        }
        Update: {
          base_revision_id?: string | null
          certainty?: number | null
          created_at?: string
          date_end?: string | null
          date_start?: string | null
          date_text?: string | null
          details?: string | null
          event_type?: Database["public"]["Enums"]["life_event_type"]
          id?: string
          life_event_id?: string
          place_text?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "life_event_revisions_base_fk"
            columns: ["life_event_id", "base_revision_id"]
            isOneToOne: false
            referencedRelation: "life_event_revisions"
            referencedColumns: ["life_event_id", "id"]
          },
          {
            foreignKeyName: "life_event_revisions_life_event_id_fkey"
            columns: ["life_event_id"]
            isOneToOne: false
            referencedRelation: "life_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "life_event_revisions_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      life_events: {
        Row: {
          created_at: string
          current_revision_id: string | null
          current_revision_status:
            | Database["public"]["Enums"]["moderation_status"]
            | null
          id: string
          person_id: string
        }
        Insert: {
          created_at?: string
          current_revision_id?: string | null
          current_revision_status?:
            | Database["public"]["Enums"]["moderation_status"]
            | null
          id: string
          person_id: string
        }
        Update: {
          created_at?: string
          current_revision_id?: string | null
          current_revision_status?:
            | Database["public"]["Enums"]["moderation_status"]
            | null
          id?: string
          person_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "life_events_current_revision_fk"
            columns: ["id", "current_revision_id", "current_revision_status"]
            isOneToOne: false
            referencedRelation: "life_event_revisions"
            referencedColumns: ["life_event_id", "id", "status"]
          },
          {
            foreignKeyName: "life_events_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      media_revisions: {
        Row: {
          base_revision_id: string | null
          caption: string | null
          created_at: string
          id: string
          legacy_uri: string | null
          mime_type: string
          person_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["moderation_status"]
          storage_path: string | null
          submission_id: string | null
        }
        Insert: {
          base_revision_id?: string | null
          caption?: string | null
          created_at?: string
          id: string
          legacy_uri?: string | null
          mime_type: string
          person_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          storage_path?: string | null
          submission_id?: string | null
        }
        Update: {
          base_revision_id?: string | null
          caption?: string | null
          created_at?: string
          id?: string
          legacy_uri?: string | null
          mime_type?: string
          person_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          storage_path?: string | null
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_revisions_base_fk"
            columns: ["person_id", "base_revision_id"]
            isOneToOne: false
            referencedRelation: "media_revisions"
            referencedColumns: ["person_id", "id"]
          },
          {
            foreignKeyName: "media_revisions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_revisions_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_link_revisions: {
        Row: {
          base_revision_id: string | null
          certainty: number | null
          child_id: string
          created_at: string
          id: string
          parent_id: string
          parent_link_id: string
          relationship_type: Database["public"]["Enums"]["parent_relationship_type"]
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["moderation_status"]
          submission_id: string | null
        }
        Insert: {
          base_revision_id?: string | null
          certainty?: number | null
          child_id: string
          created_at?: string
          id: string
          parent_id: string
          parent_link_id: string
          relationship_type: Database["public"]["Enums"]["parent_relationship_type"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          submission_id?: string | null
        }
        Update: {
          base_revision_id?: string | null
          certainty?: number | null
          child_id?: string
          created_at?: string
          id?: string
          parent_id?: string
          parent_link_id?: string
          relationship_type?: Database["public"]["Enums"]["parent_relationship_type"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parent_link_revisions_base_fk"
            columns: ["parent_link_id", "base_revision_id"]
            isOneToOne: false
            referencedRelation: "parent_link_revisions"
            referencedColumns: ["parent_link_id", "id"]
          },
          {
            foreignKeyName: "parent_link_revisions_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_link_revisions_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_link_revisions_stable_fk"
            columns: ["parent_link_id", "parent_id", "child_id"]
            isOneToOne: false
            referencedRelation: "parent_links"
            referencedColumns: ["id", "parent_id", "child_id"]
          },
          {
            foreignKeyName: "parent_link_revisions_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_links: {
        Row: {
          child_id: string
          created_at: string
          current_revision_id: string | null
          current_revision_status:
            | Database["public"]["Enums"]["moderation_status"]
            | null
          id: string
          parent_id: string
        }
        Insert: {
          child_id: string
          created_at?: string
          current_revision_id?: string | null
          current_revision_status?:
            | Database["public"]["Enums"]["moderation_status"]
            | null
          id: string
          parent_id: string
        }
        Update: {
          child_id?: string
          created_at?: string
          current_revision_id?: string | null
          current_revision_status?:
            | Database["public"]["Enums"]["moderation_status"]
            | null
          id?: string
          parent_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_links_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_links_current_revision_fk"
            columns: ["id", "current_revision_id", "current_revision_status"]
            isOneToOne: false
            referencedRelation: "parent_link_revisions"
            referencedColumns: ["parent_link_id", "id", "status"]
          },
          {
            foreignKeyName: "parent_links_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      partnership_revisions: {
        Row: {
          base_revision_id: string | null
          created_at: string
          date_end: string | null
          date_start: string | null
          date_text: string | null
          id: string
          partnership_id: string
          partnership_type: Database["public"]["Enums"]["partnership_type"]
          person1_id: string
          person2_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["moderation_status"]
          status_text: string | null
          submission_id: string | null
        }
        Insert: {
          base_revision_id?: string | null
          created_at?: string
          date_end?: string | null
          date_start?: string | null
          date_text?: string | null
          id: string
          partnership_id: string
          partnership_type: Database["public"]["Enums"]["partnership_type"]
          person1_id: string
          person2_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          status_text?: string | null
          submission_id?: string | null
        }
        Update: {
          base_revision_id?: string | null
          created_at?: string
          date_end?: string | null
          date_start?: string | null
          date_text?: string | null
          id?: string
          partnership_id?: string
          partnership_type?: Database["public"]["Enums"]["partnership_type"]
          person1_id?: string
          person2_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          status_text?: string | null
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partnership_revisions_base_fk"
            columns: ["partnership_id", "base_revision_id"]
            isOneToOne: false
            referencedRelation: "partnership_revisions"
            referencedColumns: ["partnership_id", "id"]
          },
          {
            foreignKeyName: "partnership_revisions_person1_id_fkey"
            columns: ["person1_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partnership_revisions_person2_id_fkey"
            columns: ["person2_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partnership_revisions_stable_fk"
            columns: ["partnership_id", "person1_id", "person2_id"]
            isOneToOne: false
            referencedRelation: "partnerships"
            referencedColumns: ["id", "person1_id", "person2_id"]
          },
          {
            foreignKeyName: "partnership_revisions_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      partnerships: {
        Row: {
          created_at: string
          current_revision_id: string | null
          current_revision_status:
            | Database["public"]["Enums"]["moderation_status"]
            | null
          id: string
          person1_id: string
          person2_id: string
        }
        Insert: {
          created_at?: string
          current_revision_id?: string | null
          current_revision_status?:
            | Database["public"]["Enums"]["moderation_status"]
            | null
          id: string
          person1_id: string
          person2_id: string
        }
        Update: {
          created_at?: string
          current_revision_id?: string | null
          current_revision_status?:
            | Database["public"]["Enums"]["moderation_status"]
            | null
          id?: string
          person1_id?: string
          person2_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partnerships_current_revision_fk"
            columns: ["id", "current_revision_id", "current_revision_status"]
            isOneToOne: false
            referencedRelation: "partnership_revisions"
            referencedColumns: ["partnership_id", "id", "status"]
          },
          {
            foreignKeyName: "partnerships_person1_id_fkey"
            columns: ["person1_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partnerships_person2_id_fkey"
            columns: ["person2_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          created_at: string
          current_revision_id: string | null
          current_revision_status:
            | Database["public"]["Enums"]["moderation_status"]
            | null
          id: string
          legacy_id: string | null
          legacy_numeric_id: number | null
          merged_into_person_id: string | null
        }
        Insert: {
          created_at?: string
          current_revision_id?: string | null
          current_revision_status?:
            | Database["public"]["Enums"]["moderation_status"]
            | null
          id: string
          legacy_id?: string | null
          legacy_numeric_id?: number | null
          merged_into_person_id?: string | null
        }
        Update: {
          created_at?: string
          current_revision_id?: string | null
          current_revision_status?:
            | Database["public"]["Enums"]["moderation_status"]
            | null
          id?: string
          legacy_id?: string | null
          legacy_numeric_id?: number | null
          merged_into_person_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "people_current_revision_fk"
            columns: ["id", "current_revision_id", "current_revision_status"]
            isOneToOne: false
            referencedRelation: "person_revisions"
            referencedColumns: ["person_id", "id", "status"]
          },
          {
            foreignKeyName: "people_merged_into_person_id_fkey"
            columns: ["merged_into_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      person_revisions: {
        Row: {
          aliases: string[]
          base_revision_id: string | null
          created_at: string
          display_name: string
          family_name: string | null
          gender: string | null
          given_name: string | null
          id: string
          is_living: boolean | null
          middle_names: string | null
          person_id: string
          privacy: Database["public"]["Enums"]["privacy_level"]
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["moderation_status"]
          submission_id: string | null
          summary: string | null
        }
        Insert: {
          aliases?: string[]
          base_revision_id?: string | null
          created_at?: string
          display_name: string
          family_name?: string | null
          gender?: string | null
          given_name?: string | null
          id: string
          is_living?: boolean | null
          middle_names?: string | null
          person_id: string
          privacy?: Database["public"]["Enums"]["privacy_level"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          submission_id?: string | null
          summary?: string | null
        }
        Update: {
          aliases?: string[]
          base_revision_id?: string | null
          created_at?: string
          display_name?: string
          family_name?: string | null
          gender?: string | null
          given_name?: string | null
          id?: string
          is_living?: boolean | null
          middle_names?: string | null
          person_id?: string
          privacy?: Database["public"]["Enums"]["privacy_level"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          submission_id?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "person_revisions_base_fk"
            columns: ["person_id", "base_revision_id"]
            isOneToOne: false
            referencedRelation: "person_revisions"
            referencedColumns: ["person_id", "id"]
          },
          {
            foreignKeyName: "person_revisions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_revisions_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          citation: string | null
          created_at: string
          id: string
          submission_id: string
          title: string
          url: string | null
        }
        Insert: {
          citation?: string | null
          created_at?: string
          id: string
          submission_id: string
          title: string
          url?: string | null
        }
        Update: {
          citation?: string | null
          created_at?: string
          id?: string
          submission_id?: string
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sources_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          client_request_id: string | null
          created_at: string
          family_id: string | null
          id: string
          idempotency_actor_digest: string | null
          message: string | null
          request_hash: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["moderation_status"]
          submitter_contact: string | null
          submitter_name: string | null
          submitter_user_id: string | null
          updated_at: string
        }
        Insert: {
          client_request_id?: string | null
          created_at?: string
          family_id?: string | null
          id: string
          idempotency_actor_digest?: string | null
          message?: string | null
          request_hash?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          submitter_contact?: string | null
          submitter_name?: string | null
          submitter_user_id?: string | null
          updated_at?: string
        }
        Update: {
          client_request_id?: string | null
          created_at?: string
          family_id?: string | null
          id?: string
          idempotency_actor_digest?: string | null
          message?: string | null
          request_hash?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          submitter_contact?: string | null
          submitter_name?: string | null
          submitter_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_admin_invitation: { Args: never; Returns: Json }
      approve_family_submission: {
        Args: { p_review_note?: string; p_submission_id: string }
        Returns: Json
      }
      bootstrap_first_google_admin: {
        Args: { p_user_id: string }
        Returns: Json
      }
      create_admin_invitation: {
        Args: { p_email: string; p_expires_at?: string }
        Returns: Json
      }
      edit_uuid: { Args: { p_seed: string }; Returns: string }
      get_admin_profile: { Args: never; Returns: Json }
      get_admin_submission: { Args: { p_submission_id: string }; Returns: Json }
      get_family_graph: {
        Args: { p_family_ids: string[]; p_include_pending?: boolean }
        Returns: Json
      }
      get_family_graph_by_slugs: {
        Args: { p_family_slugs: string[]; p_include_pending?: boolean }
        Returns: Json
      }
      import_family_sheet: {
        Args: { p_family_name: string; p_family_slug: string; p_payload: Json }
        Returns: Json
      }
      is_google_admin: { Args: never; Returns: boolean }
      is_google_identity: { Args: never; Returns: boolean }
      list_admin_invitations: { Args: never; Returns: Json }
      list_family_creation_proposals: {
        Args: { p_source_family_ids: string[] }
        Returns: Json
      }
      list_pending_admin_submissions: {
        Args: {
          p_after_created_at?: string
          p_after_id?: string
          p_limit?: number
        }
        Returns: Json
      }
      list_public_families: {
        Args: never
        Returns: {
          id: string
          name: string
          slug: string
        }[]
      }
      moderate_family_edit_submission: {
        Args: {
          p_decision: string
          p_review_note?: string
          p_submission_id: string
        }
        Returns: Json
      }
      moderate_family_submission: {
        Args: {
          p_decision: string
          p_review_note?: string
          p_submission_id: string
        }
        Returns: Json
      }
      reject_family_submission: {
        Args: { p_review_note?: string; p_submission_id: string }
        Returns: Json
      }
      revoke_admin_invitation: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      submit_family_creation: {
        Args: {
          p_anonymous_actor_secret?: string
          p_client_request_id: string
          p_name: string
          p_root_person_id: string
          p_slug: string
          p_source_family_id: string
        }
        Returns: Json
      }
      submit_family_edit: {
        Args: {
          p_anonymous_actor_secret?: string
          p_bundle: Json
          p_client_request_id: string
          p_family_id: string
        }
        Returns: Json
      }
      unify_person: {
        Args: {
          p_source_person_id: string
          p_target_person_id: string
        }
        Returns: Json
      }
      unify_person_by_legacy_id: {
        Args: {
          p_source_family_slug: string
          p_source_legacy_id: string
          p_target_family_slug: string
          p_target_legacy_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      life_event_type:
        | "birth"
        | "death"
        | "residence"
        | "education"
        | "occupation"
        | "other"
      moderation_status:
        | "pending"
        | "approved"
        | "rejected"
        | "superseded"
        | "conflict"
      parent_relationship_type:
        | "biological"
        | "adoptive"
        | "step"
        | "foster"
        | "guardian"
      partnership_type:
        | "marriage"
        | "civil_union"
        | "domestic_partnership"
        | "other"
      privacy_level: "public" | "family" | "private"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      life_event_type: [
        "birth",
        "death",
        "residence",
        "education",
        "occupation",
        "other",
      ],
      moderation_status: [
        "pending",
        "approved",
        "rejected",
        "superseded",
        "conflict",
      ],
      parent_relationship_type: [
        "biological",
        "adoptive",
        "step",
        "foster",
        "guardian",
      ],
      partnership_type: [
        "marriage",
        "civil_union",
        "domestic_partnership",
        "other",
      ],
      privacy_level: ["public", "family", "private"],
    },
  },
} as const
