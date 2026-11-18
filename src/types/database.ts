/**
 * Kiểu TypeScript của schema Supabase (khớp supabase/migrations).
 * Khi có Supabase CLI: `npm run db:types` để sinh tự động ra database.generated.ts rồi thay file này.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type GoalType = 'presentation' | 'reporting' | 'interview' | 'pitching' | 'debating';
export type LangCode = 'vi' | 'en';
export type PlanTier = 'free' | 'pass' | 'premium' | 'team';
export type Product = 'pass' | 'premium' | 'team';
export type SubmissionKind = 'audio' | 'video' | 'script';
export type SessionStatus = 'draft' | 'uploading' | 'uploaded' | 'pending_premium' | 'pending_quota' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type AnalysisStatus = 'queued' | 'transcribing' | 'analyzing_body' | 'scoring' | 'completed' | 'failed' | 'timed_out';
export type LessonSkill = 'structure' | 'opening' | 'closing' | 'pace' | 'filler' | 'body' | 'content' | 'qa';
export type LessonStatus = 'not_started' | 'in_progress' | 'completed';
export type PaymentProvider = 'momo' | 'vnpay' | 'mock';
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
export type BillingCycle = 'monthly' | 'yearly' | 'semiannual' | 'once';
export type SubscriptionStatus = 'active' | 'cancelled' | 'expired';

type Table<Row, Required extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};
type Ts = string;

export type ProfileRow = {
  id: string; email: string; full_name: string; organization: string | null; avatar_url: string | null;
  default_goal: GoalType; ui_language: LangCode; speaking_language: LangCode; onboarded_at: Ts | null;
  plan: PlanTier; premium_expires_at: Ts | null; plan_started_at: Ts | null; pass_credits: number; created_at: Ts; updated_at: Ts;
};
export type UsageScope = 'month' | 'pass';
export type UsageCounterRow = { user_id: string; scope: UsageScope; period_start: string; analyses_used: number; updated_at: Ts }
export type CourseRow = {
  id: string; goal: GoalType; slug: string; title: Json; description: Json; ai_persona: Json; cover_image: string | null;
  sort_order: number; is_published: boolean; created_at: Ts; updated_at: Ts;
};
export type LessonRow = {
  id: string; course_id: string; slug: string; position: number; skill: LessonSkill; title: Json; theory: Json; tip: Json | null;
  task: Json; suggested_kind: SubmissionKind; target_sec: number; est_minutes: number; pass_score: number; is_published: boolean;
  created_at: Ts; updated_at: Ts;
};
export type PracticePromptRow = { id: string; goal: GoalType; key: string; text: Json; sort_order: number; is_active: boolean }
export type LibraryItemRow = {
  id: string; user_id: string; kind: SubmissionKind; title: string; storage_path: string | null; mime_type: string | null;
  size_bytes: number | null; duration_sec: number | null; script_text: string | null; word_count: number | null;
  upload_completed_at: Ts | null; created_at: Ts; updated_at: Ts; deleted_at: Ts | null;
  media_expires_at: Ts | null; media_deleted_at: Ts | null; media_delete_reason: 'user' | 'retention' | 'account' | 'upload_abandoned' | null; retention_warned_at: Ts | null;
};
export type PracticeSessionRow = {
  id: string; user_id: string; library_item_id: string; lesson_id: string | null; prompt_id: string | null; goal: GoalType;
  speaking_language: LangCode; title: string; is_placement: boolean; status: SessionStatus;
  blocked_reason: 'over_free_duration' | 'no_quota' | null; credit_reserved: boolean; attempt_count: number;
  last_error_code: string | null; last_error_message: string | null; queued_at: Ts | null; started_at: Ts | null;
  completed_at: Ts | null; created_at: Ts; updated_at: Ts; client_body_metrics: Json | null; body_metrics_received_at: Ts | null;
};
export type AnalysisResultRow = {
  id: string; session_id: string; user_id: string; status: AnalysisStatus; overall_score: number | null; criteria_scores: Json;
  transcript: Json | null; speech_metrics: Json | null; body_metrics: Json | null; feedback: Json | null; stt_model: string | null;
  llm_model: string | null; prompt_version: string | null; input_tokens: number | null; output_tokens: number | null;
  cost_usd: number | null; trigger_run_id: string | null; error_code: string | null; error_message: string | null;
  started_at: Ts | null; finished_at: Ts | null; created_at: Ts; updated_at: Ts;
};
export type AnalysisEventRow = { id: number; session_id: string; level: 'debug' | 'info' | 'warn' | 'error'; step: string; message: string; data: Json | null; created_at: Ts }
export type UserLessonProgressRow = {
  user_id: string; lesson_id: string; status: LessonStatus; theory_read_at: Ts | null; best_score: number | null;
  attempts: number; completed_at: Ts | null; updated_at: Ts;
};
export type SubscriptionRow = {
  id: string; user_id: string; plan: PlanTier; product: Product; cycle: BillingCycle; status: SubscriptionStatus; auto_renew: boolean;
  current_period_start: Ts; current_period_end: Ts; cancelled_at: Ts | null; created_at: Ts; updated_at: Ts;
};
export type PaymentRow = {
  id: string; user_id: string; subscription_id: string | null; provider: PaymentProvider; order_code: string; provider_txn_id: string | null;
  amount_vnd: number; cycle: BillingCycle; product: Product; status: PaymentStatus; resume_session_id: string | null; return_path: string | null;
  failure_code: string | null; failure_message: string | null; ipn_payload: Json | null; expires_at: Ts; paid_at: Ts | null;
  created_at: Ts; updated_at: Ts;
};

export type TeamRow = { id: string; owner_id: string; name: string; plan_expires_at: Ts | null; created_at: Ts; updated_at: Ts };
export type TeamMemberRow = { team_id: string; email: string; user_id: string | null; role: 'leader' | 'member'; status: 'invited' | 'active'; invited_at: Ts; joined_at: Ts | null };
export type TeamScriptRow = { id: string; team_id: string; author_id: string | null; title: string; body: string; created_at: Ts };

export type EmailStatus = 'sent' | 'mocked' | 'failed';
export type EmailMessageRow = {
  id: string; user_id: string | null; to_email: string; template: string; subject: string; provider: 'resend' | 'mock';
  provider_message_id: string | null; status: EmailStatus; error: string | null; created_at: Ts;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, 'id' | 'email'>;
      usage_counters: Table<UsageCounterRow, 'user_id' | 'period_start'>;
      courses: Table<CourseRow, 'goal' | 'slug' | 'title' | 'description' | 'ai_persona'>;
      lessons: Table<LessonRow, 'course_id' | 'slug' | 'position' | 'skill' | 'title' | 'task' | 'suggested_kind' | 'target_sec' | 'est_minutes'>;
      practice_prompts: Table<PracticePromptRow, 'goal' | 'key' | 'text'>;
      library_items: Table<LibraryItemRow, 'user_id' | 'kind' | 'title'>;
      practice_sessions: Table<PracticeSessionRow, 'user_id' | 'library_item_id' | 'goal' | 'speaking_language' | 'title'>;
      analysis_results: Table<AnalysisResultRow, 'session_id' | 'user_id'>;
      analysis_events: Table<AnalysisEventRow, 'session_id' | 'level' | 'step' | 'message'>;
      user_lesson_progress: Table<UserLessonProgressRow, 'user_id' | 'lesson_id'>;
      subscriptions: Table<SubscriptionRow, 'user_id' | 'cycle' | 'current_period_start' | 'current_period_end'>;
      payments: Table<PaymentRow, 'user_id' | 'provider' | 'order_code' | 'amount_vnd' | 'cycle' | 'expires_at'>;
      email_messages: Table<EmailMessageRow, 'to_email' | 'template' | 'subject' | 'provider' | 'status'>;
      teams: Table<TeamRow, 'owner_id' | 'name'>;
      team_members: Table<TeamMemberRow, 'team_id' | 'email'>;
      team_scripts: Table<TeamScriptRow, 'team_id' | 'title' | 'body'>;
    };
    Views: { [_ in never]: never };
    Functions: {
      is_premium: { Args: { p_user: string }; Returns: boolean };
      current_usage_period: { Args: Record<string, never>; Returns: string };
      reserve_analysis_credit: { Args: { p_user: string; p_limit: number }; Returns: boolean };
      refund_analysis_credit: { Args: { p_user: string }; Returns: undefined };
      confirm_payment: { Args: { p_payment: string; p_outcome: string; p_txn: string | null; p_amount: number; p_payload: Json; p_code?: string | null; p_message?: string | null }; Returns: Json };
      expire_billing: { Args: Record<string, never>; Returns: Json };
      usage_key: { Args: { p_user: string }; Returns: { scope: UsageScope; period: string }[] };
      team_invite: { Args: { p_team: string; p_email: string; p_max: number }; Returns: Json };
      team_join: { Args: { p_team: string; p_user: string; p_email: string }; Returns: Json };
      team_remove: { Args: { p_team: string; p_email: string }; Returns: Json };
      team_sync_member: { Args: { p_user: string; p_team: string }; Returns: undefined };
      team_unsync_member: { Args: { p_user: string }; Returns: undefined };
    };
    Enums: {
      goal_type: GoalType; lang_code: LangCode; plan_tier: PlanTier; submission_kind: SubmissionKind; session_status: SessionStatus;
      analysis_status: AnalysisStatus; lesson_skill: LessonSkill; lesson_status: LessonStatus; payment_provider: PaymentProvider;
      payment_status: PaymentStatus; billing_cycle: BillingCycle; subscription_status: SubscriptionStatus; email_status: EmailStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
