export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      chart_analyses: {
        Row: {
          created_at: string
          id: string
          question: string | null
          result: string
          symbol: string | null
          timeframe: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          question?: string | null
          result: string
          symbol?: string | null
          timeframe?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          question?: string | null
          result?: string
          symbol?: string | null
          timeframe?: string | null
          user_id?: string
        }
        Relationships: []
      }
      coach_messages: {
        Row: {
          actions: Json | null
          content: string
          created_at: string
          id: string
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          actions?: Json | null
          content: string
          created_at?: string
          id?: string
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          actions?: Json | null
          content?: string
          created_at?: string
          id?: string
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "coach_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_threads: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      knowledge_notes: {
        Row: {
          category: string
          content: string
          created_at: string
          id: string
          title: string
          user_id: string
        }
        Insert: {
          category?: string
          content?: string
          created_at?: string
          id?: string
          title: string
          user_id: string
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          day: string
          dedupe_key: string | null
          id: string
          kind: string
          read: boolean
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          day: string
          dedupe_key?: string | null
          id?: string
          kind?: string
          read?: boolean
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          day?: string
          dedupe_key?: string | null
          id?: string
          kind?: string
          read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          active: boolean
          at_time: string | null
          body: string
          created_at: string
          id: string
          next_at: string
          repeat: string
          title: string
          user_id: string
        }
        Insert: {
          active?: boolean
          at_time?: string | null
          body?: string
          created_at?: string
          id?: string
          next_at: string
          repeat?: string
          title: string
          user_id: string
        }
        Update: {
          active?: boolean
          at_time?: string | null
          body?: string
          created_at?: string
          id?: string
          next_at?: string
          repeat?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      rule_violations: {
        Row: {
          id: string
          note: string | null
          occurred_at: string
          rule_id: string | null
          trade_id: string | null
          user_id: string
        }
        Insert: {
          id?: string
          note?: string | null
          occurred_at?: string
          rule_id?: string | null
          trade_id?: string | null
          user_id: string
        }
        Update: {
          id?: string
          note?: string | null
          occurred_at?: string
          rule_id?: string | null
          trade_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rule_violations_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "trading_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_violations_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      strategies: {
        Row: {
          allowed: boolean
          created_at: string
          description: string | null
          entry_conditions: string | null
          exit_conditions: string | null
          id: string
          markets: string | null
          name: string
          timeframes: string | null
          user_id: string
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          description?: string | null
          entry_conditions?: string | null
          exit_conditions?: string | null
          id?: string
          markets?: string | null
          name: string
          timeframes?: string | null
          user_id: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          description?: string | null
          entry_conditions?: string | null
          exit_conditions?: string | null
          id?: string
          markets?: string | null
          name?: string
          timeframes?: string | null
          user_id?: string
        }
        Relationships: []
      }
      trades: {
        Row: {
          checklist_passed: boolean
          close_notes: string | null
          closed_at: string | null
          created_at: string
          direction: string
          emotion: string | null
          entry_price: number | null
          exit_price: number | null
          id: string
          notes: string | null
          opened_at: string
          pnl: number | null
          position_size: number | null
          risk_amount: number
          status: string
          stop_loss: number | null
          strategy_id: string | null
          symbol: string
          take_profit: number | null
          user_id: string
        }
        Insert: {
          checklist_passed?: boolean
          close_notes?: string | null
          closed_at?: string | null
          created_at?: string
          direction: string
          emotion?: string | null
          entry_price?: number | null
          exit_price?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          pnl?: number | null
          position_size?: number | null
          risk_amount?: number
          status?: string
          stop_loss?: number | null
          strategy_id?: string | null
          symbol: string
          take_profit?: number | null
          user_id: string
        }
        Update: {
          checklist_passed?: boolean
          close_notes?: string | null
          closed_at?: string | null
          created_at?: string
          direction?: string
          emotion?: string | null
          entry_price?: number | null
          exit_price?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          pnl?: number | null
          position_size?: number | null
          risk_amount?: number
          status?: string
          stop_loss?: number | null
          strategy_id?: string | null
          symbol?: string
          take_profit?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trades_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      trading_rules: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          title: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          title: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      trading_sessions: {
        Row: {
          ended_at: string | null
          id: string
          mood: string | null
          plan: string | null
          review: string | null
          started_at: string
          user_id: string
        }
        Insert: {
          ended_at?: string | null
          id?: string
          mood?: string | null
          plan?: string | null
          review?: string | null
          started_at?: string
          user_id: string
        }
        Update: {
          ended_at?: string | null
          id?: string
          mood?: string | null
          plan?: string | null
          review?: string | null
          started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trading_settings: {
        Row: {
          cooldown_minutes: number
          cooldown_until: string | null
          created_at: string
          currency: string
          daily_target: number
          display_name: string | null
          max_consecutive_losses: number
          max_daily_loss: number
          max_daily_profit: number
          max_daily_risk: number
          max_risk_per_trade: number
          max_trades_per_day: number
          monthly_max_loss: number
          monthly_target: number
          onboarded: boolean
          session_end: string | null
          session_start: string | null
          starting_balance: number
          timezone: string
          trading_paused: boolean
          updated_at: string
          user_id: string
          weekly_max_loss: number
          weekly_target: number
        }
        Insert: {
          cooldown_minutes?: number
          cooldown_until?: string | null
          created_at?: string
          currency?: string
          daily_target?: number
          display_name?: string | null
          max_consecutive_losses?: number
          max_daily_loss?: number
          max_daily_profit?: number
          max_daily_risk?: number
          max_risk_per_trade?: number
          max_trades_per_day?: number
          monthly_max_loss?: number
          monthly_target?: number
          onboarded?: boolean
          session_end?: string | null
          session_start?: string | null
          starting_balance?: number
          timezone?: string
          trading_paused?: boolean
          updated_at?: string
          user_id: string
          weekly_max_loss?: number
          weekly_target?: number
        }
        Update: {
          cooldown_minutes?: number
          cooldown_until?: string | null
          created_at?: string
          currency?: string
          daily_target?: number
          display_name?: string | null
          max_consecutive_losses?: number
          max_daily_loss?: number
          max_daily_profit?: number
          max_daily_risk?: number
          max_risk_per_trade?: number
          max_trades_per_day?: number
          monthly_max_loss?: number
          monthly_target?: number
          onboarded?: boolean
          session_end?: string | null
          session_start?: string | null
          starting_balance?: number
          timezone?: string
          trading_paused?: boolean
          updated_at?: string
          user_id?: string
          weekly_max_loss?: number
          weekly_target?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
