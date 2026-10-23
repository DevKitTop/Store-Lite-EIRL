export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_name: string | null;
          business_id: string;
          created_at: string;
          description: string;
          details: Json | null;
          entity_id: string | null;
          entity_type: string;
          id: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_name?: string | null;
          business_id: string;
          created_at?: string;
          description: string;
          details?: Json | null;
          entity_id?: string | null;
          entity_type: string;
          id?: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_name?: string | null;
          business_id?: string;
          created_at?: string;
          description?: string;
          details?: Json | null;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
        };
        Relationships: [];
      };
      business_invitations: {
        Row: {
          business_id: string;
          code: string;
          code_hash: string;
          created_at: string;
          created_by: string | null;
          expires_at: string | null;
          id: string;
          max_uses: number | null;
          used_count: number;
        };
        Insert: {
          business_id: string;
          code: string;
          code_hash: string;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          max_uses?: number | null;
          used_count?: number;
        };
        Update: {
          business_id?: string;
          code?: string;
          code_hash?: string;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          max_uses?: number | null;
          used_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'business_invitations_business_id_businesses_id_fk';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'business_invitations_created_by_profiles_id_fk';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      business_settings: {
        Row: {
          business_id: string;
          contrast_level: string;
          created_at: string;
          culqi_public_key: string | null;
          culqi_secret_key: string | null;
          custom_colors: Json | null;
          id: string;
          preferences: Json | null;
          theme_mode: string;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          contrast_level?: string;
          created_at?: string;
          culqi_public_key?: string | null;
          culqi_secret_key?: string | null;
          custom_colors?: Json | null;
          id?: string;
          preferences?: Json | null;
          theme_mode?: string;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          contrast_level?: string;
          created_at?: string;
          culqi_public_key?: string | null;
          culqi_secret_key?: string | null;
          custom_colors?: Json | null;
          id?: string;
          preferences?: Json | null;
          theme_mode?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'business_settings_business_id_businesses_id_fk';
            columns: ['business_id'];
            isOneToOne: true;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      business_slug_aliases: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          slug: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          slug: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          slug?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'business_slug_aliases_business_id_businesses_id_fk';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      business_subscriptions: {
        Row: {
          business_id: string;
          cancel_at_period_end: boolean;
          created_at: string;
          gateway_customer_id: string | null;
          gateway_plan_id: string | null;
          gateway_subscription_id: string | null;
          id: string;
          plan_end_date: string | null;
          plan_start_date: string | null;
          plan_status: Database['public']['Enums']['subscription_status'];
          plan_type: Database['public']['Enums']['subscription_plan'];
          plan_updated_at: string;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          cancel_at_period_end?: boolean;
          created_at?: string;
          gateway_customer_id?: string | null;
          gateway_plan_id?: string | null;
          gateway_subscription_id?: string | null;
          id?: string;
          plan_end_date?: string | null;
          plan_start_date?: string | null;
          plan_status?: Database['public']['Enums']['subscription_status'];
          plan_type?: Database['public']['Enums']['subscription_plan'];
          plan_updated_at?: string;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          cancel_at_period_end?: boolean;
          created_at?: string;
          gateway_customer_id?: string | null;
          gateway_plan_id?: string | null;
          gateway_subscription_id?: string | null;
          id?: string;
          plan_end_date?: string | null;
          plan_start_date?: string | null;
          plan_status?: Database['public']['Enums']['subscription_status'];
          plan_type?: Database['public']['Enums']['subscription_plan'];
          plan_updated_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'business_subscriptions_business_id_businesses_id_fk';
            columns: ['business_id'];
            isOneToOne: true;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      business_team_members: {
        Row: {
          business_id: string;
          custom_permissions: Json | null;
          id: string;
          invitation_id: string | null;
          joined_at: string;
          role: string;
          user_id: string;
        };
        Insert: {
          business_id: string;
          custom_permissions?: Json | null;
          id?: string;
          invitation_id?: string | null;
          joined_at?: string;
          role?: string;
          user_id: string;
        };
        Update: {
          business_id?: string;
          custom_permissions?: Json | null;
          id?: string;
          invitation_id?: string | null;
          joined_at?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'business_team_members_business_id_businesses_id_fk';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'business_team_members_invitation_id_business_invitations_id_fk';
            columns: ['invitation_id'];
            isOneToOne: false;
            referencedRelation: 'business_invitations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'business_team_members_user_id_profiles_id_fk';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      business_team_roles: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          is_default: boolean | null;
          permissions: Json | null;
          role: string;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          is_default?: boolean | null;
          permissions?: Json | null;
          role: string;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          is_default?: boolean | null;
          permissions?: Json | null;
          role?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'business_team_roles_business_id_businesses_id_fk';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      businesses: {
        Row: {
          address: string | null;
          blacklisted: boolean;
          blacklisted_at: string | null;
          city: string | null;
          country: string | null;
          cover_image_url: string | null;
          created_at: string;
          culqi_blocked: boolean;
          departamento: string | null;
          description: string | null;
          distrito: string | null;
          email: string | null;
          geo_placename: string | null;
          geo_region: string | null;
          hero_images: string[] | null;
          id: string;
          is_active: boolean;
          latitude: number | null;
          legal_rep_email: string | null;
          legal_rep_name: string | null;
          legal_rep_phone: string | null;
          legal_rep_role: string | null;
          logo_url: string | null;
          longitude: number | null;
          name: string;
          owner_id: string;
          payment_flow: string[] | null;
          penalty_count: number;
          penalty_debt: number;
          person_type: string | null;
          provincia: string | null;
          seo_description: string | null;
          seo_keywords: string[] | null;
          seo_title: string | null;
          slug: string;
          social_links: Json | null;
          store_type: string | null;
          tax_id: string | null;
          updated_at: string;
          verification_data: Json | null;
          verification_status: string;
          whatsapp_number: string | null;
        };
        Insert: {
          address?: string | null;
          blacklisted?: boolean;
          blacklisted_at?: string | null;
          city?: string | null;
          country?: string | null;
          cover_image_url?: string | null;
          created_at?: string;
          culqi_blocked?: boolean;
          departamento?: string | null;
          description?: string | null;
          distrito?: string | null;
          email?: string | null;
          geo_placename?: string | null;
          geo_region?: string | null;
          hero_images?: string[] | null;
          id?: string;
          is_active?: boolean;
          latitude?: number | null;
          legal_rep_email?: string | null;
          legal_rep_name?: string | null;
          legal_rep_phone?: string | null;
          legal_rep_role?: string | null;
          logo_url?: string | null;
          longitude?: number | null;
          name: string;
          owner_id: string;
          payment_flow?: string[] | null;
          penalty_count?: number;
          penalty_debt?: number;
          person_type?: string | null;
          provincia?: string | null;
          seo_description?: string | null;
          seo_keywords?: string[] | null;
          seo_title?: string | null;
          slug: string;
          social_links?: Json | null;
          store_type?: string | null;
          tax_id?: string | null;
          updated_at?: string;
          verification_data?: Json | null;
          verification_status?: string;
          whatsapp_number?: string | null;
        };
        Update: {
          address?: string | null;
          blacklisted?: boolean;
          blacklisted_at?: string | null;
          city?: string | null;
          country?: string | null;
          cover_image_url?: string | null;
          created_at?: string;
          culqi_blocked?: boolean;
          departamento?: string | null;
          description?: string | null;
          distrito?: string | null;
          email?: string | null;
          geo_placename?: string | null;
          geo_region?: string | null;
          hero_images?: string[] | null;
          id?: string;
          is_active?: boolean;
          latitude?: number | null;
          legal_rep_email?: string | null;
          legal_rep_name?: string | null;
          legal_rep_phone?: string | null;
          legal_rep_role?: string | null;
          logo_url?: string | null;
          longitude?: number | null;
          name?: string;
          owner_id?: string;
          payment_flow?: string[] | null;
          penalty_count?: number;
          penalty_debt?: number;
          person_type?: string | null;
          provincia?: string | null;
          seo_description?: string | null;
          seo_keywords?: string[] | null;
          seo_title?: string | null;
          slug?: string;
          social_links?: Json | null;
          store_type?: string | null;
          tax_id?: string | null;
          updated_at?: string;
          verification_data?: Json | null;
          verification_status?: string;
          whatsapp_number?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'businesses_owner_id_profiles_id_fk';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      chat_sessions: {
        Row: {
          auth_user_id: string | null;
          business_id: string;
          created_at: string | null;
          guest_avatar_url: string | null;
          guest_email: string | null;
          guest_gender: string;
          guest_id: string;
          guest_name: string;
          id: string;
          payment_id: string | null;
          status: string | null;
          updated_at: string | null;
        };
        Insert: {
          auth_user_id?: string | null;
          business_id: string;
          created_at?: string | null;
          guest_avatar_url?: string | null;
          guest_email?: string | null;
          guest_gender?: string;
          guest_id: string;
          guest_name: string;
          id?: string;
          payment_id?: string | null;
          status?: string | null;
          updated_at?: string | null;
        };
        Update: {
          auth_user_id?: string | null;
          business_id?: string;
          created_at?: string | null;
          guest_avatar_url?: string | null;
          guest_email?: string | null;
          guest_gender?: string;
          guest_id?: string;
          guest_name?: string;
          id?: string;
          payment_id?: string | null;
          status?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'chat_sessions_business_id_businesses_id_fk';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'chat_sessions_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
        ];
      };
      complaint_book_records: {
        Row: {
          admin_responded_at: string | null;
          admin_response: string | null;
          business_id: string;
          claim_description: string;
          claim_type: string;
          claimed_amount: number | null;
          consumer_address: string;
          consumer_doc_id: string;
          consumer_doc_type: string;
          consumer_email: string;
          consumer_first_name: string;
          consumer_last_name: string;
          consumer_phone: string;
          consumer_request: string;
          contract_description: string;
          created_at: string;
          deleted_at: string | null;
          email_sent_at: string | null;
          guardian_name: string | null;
          id: string;
          minor_age: boolean;
          sla_deadline: string;
          status: string;
          ticket_number: string;
          updated_at: string;
        };
        Insert: {
          admin_responded_at?: string | null;
          admin_response?: string | null;
          business_id: string;
          claim_description: string;
          claim_type?: string;
          claimed_amount?: number | null;
          consumer_address: string;
          consumer_doc_id: string;
          consumer_doc_type: string;
          consumer_email: string;
          consumer_first_name: string;
          consumer_last_name: string;
          consumer_phone: string;
          consumer_request: string;
          contract_description: string;
          created_at?: string;
          deleted_at?: string | null;
          email_sent_at?: string | null;
          guardian_name?: string | null;
          id?: string;
          minor_age?: boolean;
          sla_deadline: string;
          status?: string;
          ticket_number: string;
          updated_at?: string;
        };
        Update: {
          admin_responded_at?: string | null;
          admin_response?: string | null;
          business_id?: string;
          claim_description?: string;
          claim_type?: string;
          claimed_amount?: number | null;
          consumer_address?: string;
          consumer_doc_id?: string;
          consumer_doc_type?: string;
          consumer_email?: string;
          consumer_first_name?: string;
          consumer_last_name?: string;
          consumer_phone?: string;
          consumer_request?: string;
          contract_description?: string;
          created_at?: string;
          deleted_at?: string | null;
          email_sent_at?: string | null;
          guardian_name?: string | null;
          id?: string;
          minor_age?: boolean;
          sla_deadline?: string;
          status?: string;
          ticket_number?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'complaint_book_records_business_id_businesses_id_fk';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      deletion_feedback: {
        Row: {
          business_id: string | null;
          business_name: string;
          business_slug: string;
          business_tax_id: string | null;
          created_at: string;
          id: string;
          owner_id: string;
          reason: string | null;
          snapshot: Json;
        };
        Insert: {
          business_id?: string | null;
          business_name: string;
          business_slug: string;
          business_tax_id?: string | null;
          created_at?: string;
          id?: string;
          owner_id: string;
          reason?: string | null;
          snapshot?: Json;
        };
        Update: {
          business_id?: string | null;
          business_name?: string;
          business_slug?: string;
          business_tax_id?: string | null;
          created_at?: string;
          id?: string;
          owner_id?: string;
          reason?: string | null;
          snapshot?: Json;
        };
        Relationships: [];
      };
      feedback_responses: {
        Row: {
          created_at: string;
          id: string;
          message: string;
          sender_type: Database['public']['Enums']['feedback_sender_type'];
          ticket_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          message: string;
          sender_type: Database['public']['Enums']['feedback_sender_type'];
          ticket_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          message?: string;
          sender_type?: Database['public']['Enums']['feedback_sender_type'];
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'feedback_responses_ticket_id_fkey';
            columns: ['ticket_id'];
            isOneToOne: false;
            referencedRelation: 'feedback_tickets';
            referencedColumns: ['id'];
          },
        ];
      };
      feedback_tickets: {
        Row: {
          business_id: string;
          category: Database['public']['Enums']['feedback_category'];
          created_at: string;
          id: string;
          message: string;
          priority: Database['public']['Enums']['feedback_priority'];
          request_type: Database['public']['Enums']['feedback_request_type'];
          status: Database['public']['Enums']['feedback_status'];
          subject: string;
          ticket_number: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          business_id: string;
          category: Database['public']['Enums']['feedback_category'];
          created_at?: string;
          id?: string;
          message: string;
          priority?: Database['public']['Enums']['feedback_priority'];
          request_type?: Database['public']['Enums']['feedback_request_type'];
          status?: Database['public']['Enums']['feedback_status'];
          subject: string;
          ticket_number: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          business_id?: string;
          category?: Database['public']['Enums']['feedback_category'];
          created_at?: string;
          id?: string;
          message?: string;
          priority?: Database['public']['Enums']['feedback_priority'];
          request_type?: Database['public']['Enums']['feedback_request_type'];
          status?: Database['public']['Enums']['feedback_status'];
          subject?: string;
          ticket_number?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'feedback_tickets_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_tickets_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      form_messages: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          is_read: boolean;
          message_text: string;
          sender_email: string;
          sender_name: string;
          sender_phone: string | null;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          is_read?: boolean;
          message_text: string;
          sender_email: string;
          sender_name: string;
          sender_phone?: string | null;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          is_read?: boolean;
          message_text?: string;
          sender_email?: string;
          sender_name?: string;
          sender_phone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'form_messages_business_id_businesses_id_fk';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      import_jobs: {
        Row: {
          business_id: string;
          completed_at: string | null;
          created_at: string;
          error_rows: number;
          file_name: string | null;
          id: string;
          processed_rows: number;
          status: Database['public']['Enums']['import_job_status'];
          total_rows: number;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          completed_at?: string | null;
          created_at?: string;
          error_rows?: number;
          file_name?: string | null;
          id?: string;
          processed_rows?: number;
          status?: Database['public']['Enums']['import_job_status'];
          total_rows?: number;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          completed_at?: string | null;
          created_at?: string;
          error_rows?: number;
          file_name?: string | null;
          id?: string;
          processed_rows?: number;
          status?: Database['public']['Enums']['import_job_status'];
          total_rows?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'import_jobs_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      import_rows: {
        Row: {
          created_at: string;
          error_message: string | null;
          id: string;
          job_id: string;
          processed_at: string | null;
          product_id: string | null;
          raw_data: Json | null;
          row_number: number;
          status: Database['public']['Enums']['import_row_status'];
        };
        Insert: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          job_id: string;
          processed_at?: string | null;
          product_id?: string | null;
          raw_data?: Json | null;
          row_number: number;
          status?: Database['public']['Enums']['import_row_status'];
        };
        Update: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          job_id?: string;
          processed_at?: string | null;
          product_id?: string | null;
          raw_data?: Json | null;
          row_number?: number;
          status?: Database['public']['Enums']['import_row_status'];
        };
        Relationships: [
          {
            foreignKeyName: 'import_rows_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'import_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'import_rows_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      messages: {
        Row: {
          content: string;
          created_at: string | null;
          id: string;
          is_from_store: boolean;
          is_read: boolean;
          payment_id: string | null;
          session_id: string;
        };
        Insert: {
          content: string;
          created_at?: string | null;
          id?: string;
          is_from_store?: boolean;
          is_read?: boolean;
          payment_id?: string | null;
          session_id: string;
        };
        Update: {
          content?: string;
          created_at?: string | null;
          id?: string;
          is_from_store?: boolean;
          is_read?: boolean;
          payment_id?: string | null;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'messages_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'messages_session_id_chat_sessions_id_fk';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'chat_sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          business_id: string;
          category: Database['public']['Enums']['notification_category'];
          created_at: string;
          data: Json | null;
          id: string;
          is_dismissed: boolean;
          is_read: boolean;
          message: string;
          read_at: string | null;
          title: string;
          type: Database['public']['Enums']['notification_type'];
        };
        Insert: {
          business_id: string;
          category: Database['public']['Enums']['notification_category'];
          created_at?: string;
          data?: Json | null;
          id?: string;
          is_dismissed?: boolean;
          is_read?: boolean;
          message: string;
          read_at?: string | null;
          title: string;
          type: Database['public']['Enums']['notification_type'];
        };
        Update: {
          business_id?: string;
          category?: Database['public']['Enums']['notification_category'];
          created_at?: string;
          data?: Json | null;
          id?: string;
          is_dismissed?: boolean;
          is_read?: boolean;
          message?: string;
          read_at?: string | null;
          title?: string;
          type?: Database['public']['Enums']['notification_type'];
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_business_id_businesses_id_fk';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      order_attachments: {
        Row: {
          attachment_type: Database['public']['Enums']['order_attachment_type'];
          created_at: string;
          file_name: string;
          file_url: string;
          id: string;
          order_id: string;
        };
        Insert: {
          attachment_type: Database['public']['Enums']['order_attachment_type'];
          created_at?: string;
          file_name: string;
          file_url: string;
          id?: string;
          order_id: string;
        };
        Update: {
          attachment_type?: Database['public']['Enums']['order_attachment_type'];
          created_at?: string;
          file_name?: string;
          file_url?: string;
          id?: string;
          order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'order_attachments_order_id_payments_id_fk';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
        ];
      };
      order_events: {
        Row: {
          created_at: string;
          from_status: string | null;
          id: string;
          payment_id: string;
          reason: string | null;
          to_status: string;
          triggered_by: string | null;
        };
        Insert: {
          created_at?: string;
          from_status?: string | null;
          id?: string;
          payment_id: string;
          reason?: string | null;
          to_status: string;
          triggered_by?: string | null;
        };
        Update: {
          created_at?: string;
          from_status?: string | null;
          id?: string;
          payment_id?: string;
          reason?: string | null;
          to_status?: string;
          triggered_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'order_events_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
        ];
      };
      order_timeline_events: {
        Row: {
          actor_id: string | null;
          actor_type: string;
          created_at: string;
          event_type: Database['public']['Enums']['order_timeline_event_type'];
          id: string;
          metadata: Json;
          order_id: string;
        };
        Insert: {
          actor_id?: string | null;
          actor_type: string;
          created_at?: string;
          event_type: Database['public']['Enums']['order_timeline_event_type'];
          id?: string;
          metadata?: Json;
          order_id: string;
        };
        Update: {
          actor_id?: string | null;
          actor_type?: string;
          created_at?: string;
          event_type?: Database['public']['Enums']['order_timeline_event_type'];
          id?: string;
          metadata?: Json;
          order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'order_timeline_events_actor_id_profiles_id_fk';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_timeline_events_order_id_payments_id_fk';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
        ];
      };
      payment_chats: {
        Row: {
          created_at: string;
          id: string;
          is_read: boolean | null;
          message: string;
          payment_id: string;
          sender: string;
          token: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_read?: boolean | null;
          message: string;
          payment_id: string;
          sender: string;
          token: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_read?: boolean | null;
          message?: string;
          payment_id?: string;
          sender?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_chats_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
        ];
      };
      payment_idempotency_keys: {
        Row: {
          created_at: string;
          key: string;
          response_body: Json | null;
          response_status: number | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          key: string;
          response_body?: Json | null;
          response_status?: number | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          key?: string;
          response_body?: Json | null;
          response_status?: number | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      payment_orders: {
        Row: {
          amount: number;
          business_id: string;
          buyer_email: string;
          buyer_phone: string | null;
          created_at: string;
          culqi_order_id: string;
          currency: string;
          expiration_date: string;
          id: string;
          metadata: Json | null;
          payment_code: string | null;
          payment_method: string;
          qr_url: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          business_id: string;
          buyer_email: string;
          buyer_phone?: string | null;
          created_at?: string;
          culqi_order_id: string;
          currency?: string;
          expiration_date: string;
          id?: string;
          metadata?: Json | null;
          payment_code?: string | null;
          payment_method: string;
          qr_url?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          business_id?: string;
          buyer_email?: string;
          buyer_phone?: string | null;
          created_at?: string;
          culqi_order_id?: string;
          currency?: string;
          expiration_date?: string;
          id?: string;
          metadata?: Json | null;
          payment_code?: string | null;
          payment_method?: string;
          qr_url?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_orders_business_id_businesses_id_fk';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          business_id: string;
          buyer_dni: string | null;
          buyer_email: string;
          buyer_phone: string | null;
          completed_at: string | null;
          courier_name: string | null;
          created_at: string;
          culqi_charge_id: string | null;
          culqi_order_id: string | null;
          culqi_reference_code: string | null;
          culqi_tracking_id: string | null;
          currency: string;
          delivery_code_expires_at: string | null;
          delivery_code_hash: string | null;
          finalization_confirmed_at: string | null;
          finalization_deadline: string | null;
          finalization_requested_at: string | null;
          id: string;
          metadata: Json | null;
          order_number: string | null;
          payment_method: string;
          pickup_code: string | null;
          product_id: string;
          rejected_at: string | null;
          rejection_image: string | null;
          rejection_reason: string | null;
          seller_note: string | null;
          seller_status: string | null;
          seller_user_id: string;
          shipped_at: string | null;
          shipping_address: string | null;
          shipping_agency: string | null;
          shipping_cost: number | null;
          shipping_department: string | null;
          shipping_district: string | null;
          shipping_paid_at: string | null;
          shipping_phone: string | null;
          shipping_province: string | null;
          shipping_reference: string | null;
          shipping_type: Database['public']['Enums']['shipping_type'] | null;
          shipping_ubigeo: string | null;
          status: string;
          ticket_image_url: string | null;
          ticket_url: string | null;
          tracking_number: string | null;
          tracking_token: string;
          updated_at: string;
          verified_at: string | null;
          version: number;
        };
        Insert: {
          amount: number;
          business_id: string;
          buyer_dni?: string | null;
          buyer_email: string;
          buyer_phone?: string | null;
          completed_at?: string | null;
          courier_name?: string | null;
          created_at?: string;
          culqi_charge_id?: string | null;
          culqi_order_id?: string | null;
          culqi_reference_code?: string | null;
          culqi_tracking_id?: string | null;
          currency?: string;
          delivery_code_expires_at?: string | null;
          delivery_code_hash?: string | null;
          finalization_confirmed_at?: string | null;
          finalization_deadline?: string | null;
          finalization_requested_at?: string | null;
          id?: string;
          metadata?: Json | null;
          order_number?: string | null;
          payment_method: string;
          pickup_code?: string | null;
          product_id: string;
          rejected_at?: string | null;
          rejection_image?: string | null;
          rejection_reason?: string | null;
          seller_note?: string | null;
          seller_status?: string | null;
          seller_user_id: string;
          shipped_at?: string | null;
          shipping_address?: string | null;
          shipping_agency?: string | null;
          shipping_cost?: number | null;
          shipping_department?: string | null;
          shipping_district?: string | null;
          shipping_paid_at?: string | null;
          shipping_phone?: string | null;
          shipping_province?: string | null;
          shipping_reference?: string | null;
          shipping_type?: Database['public']['Enums']['shipping_type'] | null;
          shipping_ubigeo?: string | null;
          status?: string;
          ticket_image_url?: string | null;
          ticket_url?: string | null;
          tracking_number?: string | null;
          tracking_token: string;
          updated_at?: string;
          verified_at?: string | null;
          version?: number;
        };
        Update: {
          amount?: number;
          business_id?: string;
          buyer_dni?: string | null;
          buyer_email?: string;
          buyer_phone?: string | null;
          completed_at?: string | null;
          courier_name?: string | null;
          created_at?: string;
          culqi_charge_id?: string | null;
          culqi_order_id?: string | null;
          culqi_reference_code?: string | null;
          culqi_tracking_id?: string | null;
          currency?: string;
          delivery_code_expires_at?: string | null;
          delivery_code_hash?: string | null;
          finalization_confirmed_at?: string | null;
          finalization_deadline?: string | null;
          finalization_requested_at?: string | null;
          id?: string;
          metadata?: Json | null;
          order_number?: string | null;
          payment_method?: string;
          pickup_code?: string | null;
          product_id?: string;
          rejected_at?: string | null;
          rejection_image?: string | null;
          rejection_reason?: string | null;
          seller_note?: string | null;
          seller_status?: string | null;
          seller_user_id?: string;
          shipped_at?: string | null;
          shipping_address?: string | null;
          shipping_agency?: string | null;
          shipping_cost?: number | null;
          shipping_department?: string | null;
          shipping_district?: string | null;
          shipping_paid_at?: string | null;
          shipping_phone?: string | null;
          shipping_province?: string | null;
          shipping_reference?: string | null;
          shipping_type?: Database['public']['Enums']['shipping_type'] | null;
          shipping_ubigeo?: string | null;
          status?: string;
          ticket_image_url?: string | null;
          ticket_url?: string | null;
          tracking_number?: string | null;
          tracking_token?: string;
          updated_at?: string;
          verified_at?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'payments_business_id_businesses_id_fk';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payments_product_id_products_id_fk';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payments_seller_user_id_profiles_id_fk';
            columns: ['seller_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      penalties: {
        Row: {
          amount: number;
          business_id: string;
          created_at: string;
          description: string;
          id: string;
          notes: string | null;
          order_id: string;
          order_number: string | null;
          paid_at: string | null;
          payment_id: string | null;
          payment_method: string | null;
          penalty_type: string;
          percentage: number | null;
          product_value: number | null;
          resolved_at: string | null;
          status: string;
          title: string;
        };
        Insert: {
          amount: number;
          business_id: string;
          created_at?: string;
          description: string;
          id?: string;
          notes?: string | null;
          order_id: string;
          order_number?: string | null;
          paid_at?: string | null;
          payment_id?: string | null;
          payment_method?: string | null;
          penalty_type: string;
          percentage?: number | null;
          product_value?: number | null;
          resolved_at?: string | null;
          status?: string;
          title: string;
        };
        Update: {
          amount?: number;
          business_id?: string;
          created_at?: string;
          description?: string;
          id?: string;
          notes?: string | null;
          order_id?: string;
          order_number?: string | null;
          paid_at?: string | null;
          payment_id?: string | null;
          payment_method?: string | null;
          penalty_type?: string;
          percentage?: number | null;
          product_value?: number | null;
          resolved_at?: string | null;
          status?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'penalties_business_id_businesses_id_fk';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'penalties_order_id_payments_id_fk';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
        ];
      };
      plan_payments: {
        Row: {
          amount_igv: number;
          amount_subtotal: number;
          amount_total: number;
          business_id: string;
          buyer_address: string | null;
          buyer_document_number: string | null;
          buyer_document_type: string | null;
          buyer_email: string;
          buyer_full_name: string | null;
          created_at: string;
          culqi_charge_id: string | null;
          culqi_reference_code: string | null;
          currency: string;
          id: string;
          metadata: Json | null;
          payment_method: Database['public']['Enums']['payment_method'];
          period: string;
          plan_end_date: string | null;
          plan_start_date: string | null;
          plan_type: Database['public']['Enums']['subscription_plan'];
          status: Database['public']['Enums']['plan_payment_status'];
          ticket_correlative: number;
          ticket_issued_at: string | null;
          ticket_series: string;
          ticket_url: string | null;
          updated_at: string;
        };
        Insert: {
          amount_igv: number;
          amount_subtotal: number;
          amount_total: number;
          business_id: string;
          buyer_address?: string | null;
          buyer_document_number?: string | null;
          buyer_document_type?: string | null;
          buyer_email: string;
          buyer_full_name?: string | null;
          created_at?: string;
          culqi_charge_id?: string | null;
          culqi_reference_code?: string | null;
          currency?: string;
          id?: string;
          metadata?: Json | null;
          payment_method: Database['public']['Enums']['payment_method'];
          period?: string;
          plan_end_date?: string | null;
          plan_start_date?: string | null;
          plan_type: Database['public']['Enums']['subscription_plan'];
          status?: Database['public']['Enums']['plan_payment_status'];
          ticket_correlative?: number;
          ticket_issued_at?: string | null;
          ticket_series?: string;
          ticket_url?: string | null;
          updated_at?: string;
        };
        Update: {
          amount_igv?: number;
          amount_subtotal?: number;
          amount_total?: number;
          business_id?: string;
          buyer_address?: string | null;
          buyer_document_number?: string | null;
          buyer_document_type?: string | null;
          buyer_email?: string;
          buyer_full_name?: string | null;
          created_at?: string;
          culqi_charge_id?: string | null;
          culqi_reference_code?: string | null;
          currency?: string;
          id?: string;
          metadata?: Json | null;
          payment_method?: Database['public']['Enums']['payment_method'];
          period?: string;
          plan_end_date?: string | null;
          plan_start_date?: string | null;
          plan_type?: Database['public']['Enums']['subscription_plan'];
          status?: Database['public']['Enums']['plan_payment_status'];
          ticket_correlative?: number;
          ticket_issued_at?: string | null;
          ticket_series?: string;
          ticket_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      product_categories: {
        Row: {
          business_id: string;
          created_at: string;
          display_order: number | null;
          id: string;
          image_url: string | null;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          display_order?: number | null;
          id?: string;
          image_url?: string | null;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          display_order?: number | null;
          id?: string;
          image_url?: string | null;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'product_categories_business_id_businesses_id_fk';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      product_likes: {
        Row: {
          created_at: string;
          id: string;
          ip_address: string;
          product_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          ip_address: string;
          product_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          ip_address?: string;
          product_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'product_likes_product_id_products_id_fk';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      product_media: {
        Row: {
          alt_text: string | null;
          created_at: string;
          display_order: number;
          id: string;
          media_type: string;
          media_url: string;
          product_id: string;
        };
        Insert: {
          alt_text?: string | null;
          created_at?: string;
          display_order?: number;
          id?: string;
          media_type?: string;
          media_url: string;
          product_id: string;
        };
        Update: {
          alt_text?: string | null;
          created_at?: string;
          display_order?: number;
          id?: string;
          media_type?: string;
          media_url?: string;
          product_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'product_media_product_id_products_id_fk';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      products: {
        Row: {
          brand: string | null;
          business_id: string;
          category_id: string | null;
          created_at: string;
          currency: string;
          description: string | null;
          display_order: number | null;
          external_code: string | null;
          id: string;
          is_available: boolean;
          metadata: Json | null;
          price: number;
          sale_status: string;
          second_price: number | null;
          seo_description: string | null;
          seo_title: string | null;
          shipping_info: string | null;
          slug: string | null;
          stars: number | null;
          stock: number;
          tags: string[] | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          brand?: string | null;
          business_id: string;
          category_id?: string | null;
          created_at?: string;
          currency?: string;
          description?: string | null;
          display_order?: number | null;
          external_code?: string | null;
          id?: string;
          is_available?: boolean;
          metadata?: Json | null;
          price: number;
          sale_status?: string;
          second_price?: number | null;
          seo_description?: string | null;
          seo_title?: string | null;
          shipping_info?: string | null;
          slug?: string | null;
          stars?: number | null;
          stock?: number;
          tags?: string[] | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          brand?: string | null;
          business_id?: string;
          category_id?: string | null;
          created_at?: string;
          currency?: string;
          description?: string | null;
          display_order?: number | null;
          external_code?: string | null;
          id?: string;
          is_available?: boolean;
          metadata?: Json | null;
          price?: number;
          sale_status?: string;
          second_price?: number | null;
          seo_description?: string | null;
          seo_title?: string | null;
          shipping_info?: string | null;
          slug?: string | null;
          stars?: number | null;
          stock?: number;
          tags?: string[] | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'products_business_id_businesses_id_fk';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_category_id_product_categories_id_fk';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'product_categories';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          address: string | null;
          age: number | null;
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          phone: string | null;
          provider_id: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          age?: number | null;
          avatar_url?: string | null;
          created_at?: string;
          email: string;
          full_name: string;
          id: string;
          phone?: string | null;
          provider_id?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          age?: number | null;
          avatar_url?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          phone?: string | null;
          provider_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      saas_issuer_config: {
        Row: {
          departamento: string;
          direccion: string;
          distrito: string;
          id: number;
          igv_rate: number;
          logo_url: string | null;
          provincia: string;
          razon_social: string;
          ruc: string;
          ubigeo: string | null;
          updated_at: string;
        };
        Insert: {
          departamento: string;
          direccion: string;
          distrito: string;
          id?: number;
          igv_rate?: number;
          logo_url?: string | null;
          provincia: string;
          razon_social: string;
          ruc: string;
          ubigeo?: string | null;
          updated_at?: string;
        };
        Update: {
          departamento?: string;
          direccion?: string;
          distrito?: string;
          id?: number;
          igv_rate?: number;
          logo_url?: string | null;
          provincia?: string;
          razon_social?: string;
          ruc?: string;
          ubigeo?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      seller_payout_accounts: {
        Row: {
          bank_account_number: string;
          bank_cci: string | null;
          bank_name: string;
          country: string;
          created_at: string;
          document_number: string;
          document_type: string;
          full_name: string;
          id: string;
          seller_user_id: string;
          updated_at: string;
          verified: boolean;
        };
        Insert: {
          bank_account_number: string;
          bank_cci?: string | null;
          bank_name: string;
          country?: string;
          created_at?: string;
          document_number: string;
          document_type?: string;
          full_name: string;
          id?: string;
          seller_user_id: string;
          updated_at?: string;
          verified?: boolean;
        };
        Update: {
          bank_account_number?: string;
          bank_cci?: string | null;
          bank_name?: string;
          country?: string;
          created_at?: string;
          document_number?: string;
          document_type?: string;
          full_name?: string;
          id?: string;
          seller_user_id?: string;
          updated_at?: string;
          verified?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'seller_payout_accounts_seller_user_id_profiles_id_fk';
            columns: ['seller_user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      verification_otps: {
        Row: {
          code_hash: string;
          created_at: string;
          expires_at: string;
          id: string;
          identifier: string;
          type: string;
          verified: boolean;
        };
        Insert: {
          code_hash: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          identifier: string;
          type: string;
          verified?: boolean;
        };
        Update: {
          code_hash?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          identifier?: string;
          type?: string;
          verified?: boolean;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      contrast_level: 'standard' | 'medium' | 'high';
      feedback_category: 'bug' | 'suggestion' | 'question' | 'other';
      feedback_priority: 'low' | 'normal' | 'high';
      feedback_request_type: 'support' | 'feedback' | 'complaint';
      feedback_sender_type: 'user' | 'admin';
      feedback_status: 'open' | 'in_progress' | 'resolved' | 'closed';
      import_job_status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
      import_row_status: 'pending' | 'processing' | 'completed' | 'error';
      media_type: 'image' | 'video';
      notification_category: 'chat' | 'almacen' | 'plan' | 'pedidos' | 'sistema';
      notification_type:
        | 'message_new'
        | 'message_unread'
        | 'stock_low'
        | 'stock_out'
        | 'plan_expiring'
        | 'plan_expired'
        | 'plan_upgraded'
        | 'order_created'
        | 'order_status_changed'
        | 'order_shipped'
        | 'order_finalization_requested'
        | 'order_finalization_confirmed'
        | 'order_finalization_rejected'
        | 'order_auto_finalized'
        | 'system';
      order_attachment_type:
        | 'tracking'
        | 'cip'
        | 'invoice'
        | 'photo'
        | 'video'
        | 'document'
        | 'other';
      order_status_v2:
        | 'CREATED'
        | 'PAID'
        | 'PREPARING_ORDER'
        | 'WAITING_CUSTOMER_CONFIRMATION'
        | 'READY_TO_SHIP'
        | 'IN_TRANSIT'
        | 'DELIVERED'
        | 'COMPLETED'
        | 'ISSUE_REPORTED'
        | 'DISPUTE'
        | 'SELLER_TIMEOUT'
        | 'CANCELLED'
        | 'PICKED_UP'
        | 'READY_FOR_PICKUP';
      order_timeline_event_type:
        | 'ORDER_CREATED'
        | 'ORDER_PAID'
        | 'ORDER_PREPARING'
        | 'ATTACHMENT_UPLOADED'
        | 'CUSTOMER_CONFIRMED'
        | 'CUSTOMER_REPORTED_ISSUE'
        | 'DISPUTE_CREATED'
        | 'SHIPPING_PAYMENT_PENDING'
        | 'SHIPPING_PAYMENT_CONFIRMED'
        | 'PICKUP_CODE_GENERATED'
        | 'ORDER_READY_TO_SHIP'
        | 'ORDER_IN_TRANSIT'
        | 'ORDER_DELIVERED'
        | 'ORDER_COMPLETED'
        | 'SELLER_TIMEOUT'
        | 'AUTO_APPROVED'
        | 'ORDER_CANCELLED'
        | 'ORDER_PICKED_UP'
        | 'ORDER_READY_FOR_PICKUP';
      payment_method: 'card' | 'yape' | 'plin';
      payment_status:
        | 'pending'
        | 'paid'
        | 'not_delivered'
        | 'delivered'
        | 'completed'
        | 'failed'
        | 'disputed'
        | 'refund_requested'
        | 'refunded'
        | 'esperando_confirmacion'
        | 'validando'
        | 'en_reparto';
      plan_payment_status: 'pending' | 'paid' | 'failed' | 'refunded' | 'disputed';
      shipping_type: 'agencia' | 'domicilio' | 'recojo';
      subscription_plan:
        | 'basico'
        | 'emprendedor'
        | 'business_pro'
        | 'enterprise_ai'
        | 'enterprise_pro'
        | 'lite'
        | 'lite_pago'
        | 'lite_plus';
      subscription_status: 'active' | 'inactive' | 'past_due' | 'canceled' | 'expired' | 'trialing';
      theme_mode: 'light' | 'dark';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      contrast_level: ['standard', 'medium', 'high'],
      feedback_category: ['bug', 'suggestion', 'question', 'other'],
      feedback_priority: ['low', 'normal', 'high'],
      feedback_request_type: ['support', 'feedback', 'complaint'],
      feedback_sender_type: ['user', 'admin'],
      feedback_status: ['open', 'in_progress', 'resolved', 'closed'],
      import_job_status: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
      import_row_status: ['pending', 'processing', 'completed', 'error'],
      media_type: ['image', 'video'],
      notification_category: ['chat', 'almacen', 'plan', 'pedidos', 'sistema'],
      notification_type: [
        'message_new',
        'message_unread',
        'stock_low',
        'stock_out',
        'plan_expiring',
        'plan_expired',
        'plan_upgraded',
        'order_created',
        'order_status_changed',
        'order_shipped',
        'order_finalization_requested',
        'order_finalization_confirmed',
        'order_finalization_rejected',
        'order_auto_finalized',
        'system',
      ],
      order_attachment_type: ['tracking', 'cip', 'invoice', 'photo', 'video', 'document', 'other'],
      order_status_v2: [
        'CREATED',
        'PAID',
        'PREPARING_ORDER',
        'WAITING_CUSTOMER_CONFIRMATION',
        'READY_TO_SHIP',
        'IN_TRANSIT',
        'DELIVERED',
        'COMPLETED',
        'ISSUE_REPORTED',
        'DISPUTE',
        'SELLER_TIMEOUT',
        'CANCELLED',
        'PICKED_UP',
        'READY_FOR_PICKUP',
      ],
      order_timeline_event_type: [
        'ORDER_CREATED',
        'ORDER_PAID',
        'ORDER_PREPARING',
        'ATTACHMENT_UPLOADED',
        'CUSTOMER_CONFIRMED',
        'CUSTOMER_REPORTED_ISSUE',
        'DISPUTE_CREATED',
        'SHIPPING_PAYMENT_PENDING',
        'SHIPPING_PAYMENT_CONFIRMED',
        'PICKUP_CODE_GENERATED',
        'ORDER_READY_TO_SHIP',
        'ORDER_IN_TRANSIT',
        'ORDER_DELIVERED',
        'ORDER_COMPLETED',
        'SELLER_TIMEOUT',
        'AUTO_APPROVED',
        'ORDER_CANCELLED',
        'ORDER_PICKED_UP',
        'ORDER_READY_FOR_PICKUP',
      ],
      payment_method: ['card', 'yape', 'plin'],
      payment_status: [
        'pending',
        'paid',
        'not_delivered',
        'delivered',
        'completed',
        'failed',
        'disputed',
        'refund_requested',
        'refunded',
        'esperando_confirmacion',
        'validando',
        'en_reparto',
      ],
      plan_payment_status: ['pending', 'paid', 'failed', 'refunded', 'disputed'],
      shipping_type: ['agencia', 'domicilio', 'recojo'],
      subscription_plan: [
        'basico',
        'emprendedor',
        'business_pro',
        'enterprise_ai',
        'enterprise_pro',
        'lite',
        'lite_pago',
        'lite_plus',
      ],
      subscription_status: ['active', 'inactive', 'past_due', 'canceled', 'expired', 'trialing'],
      theme_mode: ['light', 'dark'],
    },
  },
} as const;
