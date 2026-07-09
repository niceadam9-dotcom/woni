// ============================================================
// Application types
// ============================================================
export type UserRole = 'employee' | 'manager' | 'admin'
export type DocumentStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'recalled'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export type LeaveType = 'annual' | 'half_am' | 'half_pm' | 'sick' | 'special'
export type LeaveStatus = 'pending' | 'manager_approved' | 'approved' | 'rejected'
export type NotificationType =
  | 'approval_request' | 'approved' | 'rejected' | 'recalled'
  | 'leave_request' | 'leave_approved' | 'leave_rejected'
  | 'inspection_assigned' | 'inspection_step_due'
  | 'inspection_step_overdue' | 'inspection_completed'

// Fire Safety Inspection types
export type InspectionType     = '종합' | '작동' | '일반관리'
export type InspectionCategory = '소방안전관리' | '일반관리'
export type InspectionSubType  = '종합' | '작동'
export type PlanType           = 'special_종합' | 'special_작동' | 'monthly' | 'event'

// 화면 표시 표준 용어 통일: 종합 / 작동 / 정기 / 일반 — DB 저장값은 불변, 표시만 변환
export const inspectionTypeLabel = (t: string | null | undefined): string =>
  t === '일반관리' ? '일반' : (t ?? '—')
export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  'special_종합': '종합', 'special_작동': '작동', monthly: '정기', event: '일반',
}
export type InspectionStatus   = 'scheduled' | 'in_progress' | 'completed' | 'overdue'
export type StepStatus         = 'pending' | 'completed' | 'overdue'
export type ReportType         = 'fire_station' | 'stakeholder' | 'completion'
export type ContactRole        = '대표' | '직원1' | '직원2'

// Inspection Plan types (Victory4.md)
export type PlanStatus     = 'draft' | 'confirmed' | 'cancelled'
export type PlanItemStatus = 'planned' | 'confirmed' | 'completed' | 'cancelled'

export interface Profile {
  id: string; employee_id: string; name: string; email: string
  role: UserRole; department_id: string | null; position: string | null
  hire_date: string | null; is_active: boolean; failed_logins: number
  is_system: boolean // 시스템(개발·운영지원) 계정 — 업무 화면 직원 목록에서 제외 (047)
  locked_until: string | null; created_at: string; updated_at: string
}
export interface Department {
  id: string; name: string; manager_id: string | null
  created_at: string; updated_at: string
}
export interface Document {
  id: string; title: string; content: string; template_type: string
  author_id: string; status: DocumentStatus; submitted_at: string | null
  created_at: string; updated_at: string
}
export interface DocumentApprover {
  id: string; document_id: string; approver_id: string; order_num: number
  status: ApprovalStatus; comment: string | null; processed_at: string | null
  created_at: string
}
export interface DocumentAttachment {
  id: string; document_id: string; file_name: string; file_path: string
  file_size: number | null; mime_type: string | null; created_at: string
}
export interface Leave {
  id: string; employee_id: string; leave_type: LeaveType
  start_date: string; end_date: string; days_count: number
  reason: string | null; status: LeaveStatus
  manager_id: string | null; admin_id: string | null
  manager_comment: string | null; admin_comment: string | null
  created_at: string; updated_at: string
}
export interface LeaveBalance {
  id: string; employee_id: string; year: number; total_days: number; used_days: number
}
export interface Notification {
  id: string; recipient_id: string; title: string; message: string
  type: NotificationType; reference_id: string | null
  reference_type: 'document' | 'leave' | 'inspection' | null; is_read: boolean; created_at: string
}

// Fire Safety Inspection interfaces
export interface Holiday {
  id: string; date: string; name: string; is_national: boolean; year: number; created_at: string
}
export interface Customer {
  id: string; customer_code: string; customer_name: string; contract_date: string
  use_approval_date: string | null
  zipcode: string | null
  region_si: string | null; region_myeon: string | null; region_ri: string | null
  inspection_type: InspectionType
  inspection_category: InspectionCategory | null
  inspection_sub_type: InspectionSubType | null
  address: string | null; notes: string | null
  is_active: boolean; assigned_employee_id: string | null
  created_by: string; created_at: string; updated_at: string
}

export interface CompanyProfile {
  id: string
  company_name: string
  representative: string | null
  business_number: string | null
  phone: string | null
  email: string | null
  address: string | null
  logo_url: string | null
  mark_url: string | null
  default_region_si: string
  default_region_myeon: string
  updated_at: string
  updated_by: string | null
}
export interface CustomerContact {
  id: string; customer_id: string; role: ContactRole; name: string
  phone: string | null; email: string | null; created_at: string; updated_at: string
}
export interface Building {
  id: string; customer_id: string; building_name: string; zipcode: string | null; address: string | null
  total_area: number | null; floors_above: number | null; floors_below: number | null
  purpose: string | null; year_built: number | null; notes: string | null
  is_active: boolean; created_by: string; created_at: string; updated_at: string
}
export interface Inspection {
  id: string; customer_id: string; contact_id: string | null; assigned_employee_id: string
  inspection_type: InspectionType; inspection_start_date: string; notification_date: string | null
  year: number; sequence_num: 1 | 2; status: InspectionStatus; notes: string | null
  created_by: string; created_at: string; updated_at: string
}
export interface InspectionStep {
  id: string; inspection_id: string; step_num: number; name_ko: string
  due_days: number | null; is_working_days: boolean | null; due_date: string | null
  status: StepStatus; completed_at: string | null; completed_by: string | null
  notes: string | null; created_at: string; updated_at: string
}
export interface InspectionReport {
  id: string; inspection_id: string; report_type: ReportType
  customer_code: string; customer_name: string
  submitted_at: string | null; submitted_by: string | null
  file_name: string | null; file_path: string | null
  file_size: number | null; mime_type: string | null; notes: string | null
  created_at: string; updated_at: string
}
export interface InspectionSheet {
  id: string; sheet_code: string; sheet_name: string; version: string
  inspection_type: InspectionType | null; description: string | null
  is_active: boolean; created_by: string; created_at: string; updated_at: string
}
export interface InspectionSheetItem {
  id: string; sheet_id: string; item_code: string; item_name: string
  facility_type: string | null; inspection_method: string | null
  judgment_criteria: string | null; order_num: number; is_active: boolean
  created_at: string
}

// Inspection Plan interfaces
export interface InspectionPlan {
  id: string; year: number; month: number; status: PlanStatus
  auto_generated: boolean; ref_plan_id: string | null; notes: string | null
  confirmed_at: string | null; created_by: string; created_at: string; updated_at: string
}
export interface InspectionPlanItem {
  id: string; plan_id: string; customer_id: string
  inspection_type: InspectionType; sequence_num: 1 | 2
  inspection_category: InspectionCategory | null
  inspection_sub_type: InspectionSubType | null
  plan_type: PlanType | null
  planned_date: string | null
  scheduled_date: string | null; assigned_employee_id: string | null
  contact_id: string | null; status: PlanItemStatus
  step1_date: string | null; step2_date: string | null
  step3_date: string | null; step4_date: string | null
  step5_date: string | null; step6_date: string | null
  inspection_id: string | null; notes: string | null
  created_at: string; updated_at: string
}
// 목록 조회용 join 타입
export interface InspectionPlanItemView extends InspectionPlanItem {
  customer_name: string
  customer_code: string
  assigned_employee_name: string | null
}

// Monitoring types (Victory4.md §9, §10)
export interface InspectionStatusLog {
  id: string; plan_item_id: string
  inspection_date: string | null; report_submitted_at: string | null
  sent_at: string | null; filed_at: string | null
  sms_confirmed: boolean; sms_sent_at: string | null; sms_content: string | null
  updated_by: string | null; created_at: string; updated_at: string
}
export interface InspectionReportStatus {
  id: string; plan_item_id: string
  inspection_completed_at: string | null
  notification_date: string | null
  notification_due_date: string | null
  submission_deadline: string | null
  sent_at: string | null; received_at: string | null; returned_at: string | null
  fire_station_submitted: boolean; fee_billed: boolean
  updated_by: string | null; created_at: string; updated_at: string
}

// Vehicle types
export type FuelType = 'gasoline' | 'diesel' | 'lpg' | 'electric' | 'hybrid'

export interface Vehicle {
  id: string; vehicle_number: string; vehicle_name: string; vehicle_type: string | null
  maker: string | null; model_year: number | null; color: string | null
  fuel_type: FuelType | null; insurance_expiry: string | null; inspection_expiry: string | null
  notes: string | null; is_active: boolean; created_by: string; created_at: string; updated_at: string
}
export interface VehicleLog {
  id: string; vehicle_id: string; driver_id: string
  log_date: string; departure_time: string | null; arrival_time: string | null
  departure_location: string | null; destination: string | null; purpose: string | null
  start_mileage: number | null; end_mileage: number | null; distance: number | null
  fuel_cost: number | null; toll_cost: number | null; notes: string | null; created_at: string
}

export interface ActivityLog {
  id: string; actor_id: string | null; action: string; entity_type: string
  entity_id: string | null; metadata: Record<string, unknown> | null
  ip_address: string | null; created_at: string
}

// ============================================================
// Supabase Database type — Supabase CLI로 자동 생성 가능
// ============================================================
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: {
          id: string; employee_id: string; name: string; email: string
          role?: string; department_id?: string | null; position?: string | null
          hire_date?: string | null; is_active?: boolean; failed_logins?: number
          locked_until?: string | null; created_at?: string; updated_at?: string
        }
        Update: Partial<{
          employee_id: string; name: string; email: string; role: string
          department_id: string | null; position: string | null; hire_date: string | null
          is_active: boolean; failed_logins: number; locked_until: string | null
          updated_at: string
        }>
        Relationships: never[]
      }
      departments: {
        Row: Department
        Insert: { name: string; id?: string; manager_id?: string | null; created_at?: string; updated_at?: string }
        Update: Partial<{ name: string; manager_id: string | null; updated_at: string }>
        Relationships: never[]
      }
      documents: {
        Row: Document
        Insert: {
          author_id: string; title: string; content?: string; template_type?: string
          id?: string; status?: string; submitted_at?: string | null; created_at?: string; updated_at?: string
        }
        Update: Partial<{ title: string; content: string; status: string; submitted_at: string | null; updated_at: string }>
        Relationships: never[]
      }
      document_approvers: {
        Row: DocumentApprover
        Insert: {
          document_id: string; approver_id: string; order_num: number
          id?: string; status?: string; comment?: string | null; processed_at?: string | null; created_at?: string
        }
        Update: Partial<{ status: string; comment: string | null; processed_at: string | null }>
        Relationships: never[]
      }
      document_attachments: {
        Row: DocumentAttachment
        Insert: {
          document_id: string; file_name: string; file_path: string
          id?: string; file_size?: number | null; mime_type?: string | null; created_at?: string
        }
        Update: Partial<{ file_name: string; file_path: string }>
        Relationships: never[]
      }
      leaves: {
        Row: Leave
        Insert: {
          employee_id: string; leave_type: string; start_date: string; end_date: string; days_count: number
          id?: string; reason?: string | null; status?: string; manager_id?: string | null; admin_id?: string | null
          manager_comment?: string | null; admin_comment?: string | null; created_at?: string; updated_at?: string
        }
        Update: Partial<{
          status: string; manager_id: string | null; admin_id: string | null
          manager_comment: string | null; admin_comment: string | null; updated_at: string
        }>
        Relationships: never[]
      }
      leave_balances: {
        Row: LeaveBalance
        Insert: { employee_id: string; year: number; total_days: number; id?: string; used_days?: number }
        Update: Partial<{ total_days: number; used_days: number }>
        Relationships: never[]
      }
      notifications: {
        Row: Notification
        Insert: {
          recipient_id: string; title: string; message: string; type: string
          id?: string; reference_id?: string | null; reference_type?: string | null; is_read?: boolean; created_at?: string
        }
        Update: Partial<{ is_read: boolean }>
        Relationships: never[]
      }
      push_subscriptions: {
        Row: { id: string; user_id: string; endpoint: string; p256dh_key: string; auth_key: string; created_at: string }
        Insert: { user_id: string; endpoint: string; p256dh_key: string; auth_key: string; id?: string; created_at?: string }
        Update: Partial<{ endpoint: string; p256dh_key: string; auth_key: string }>
        Relationships: never[]
      }
      activity_logs: {
        Row: ActivityLog
        Insert: {
          action: string; entity_type: string
          id?: string; actor_id?: string | null; entity_id?: string | null
          metadata?: Record<string, unknown> | null; ip_address?: string | null; created_at?: string
        }
        Update: Record<string, never>
        Relationships: never[]
      }
      holidays: {
        Row: Holiday
        Insert: { date: string; name: string; id?: string; is_national?: boolean; created_at?: string }
        Update: Partial<{ name: string; is_national: boolean }>
        Relationships: never[]
      }
      customers: {
        Row: Customer
        Insert: {
          customer_code: string; customer_name: string; contract_date: string
          inspection_type: string; created_by: string
          id?: string; use_approval_date?: string | null
          region_si?: string | null; region_myeon?: string | null; region_ri?: string | null
          address?: string | null; notes?: string | null; is_active?: boolean
          assigned_employee_id?: string | null; created_at?: string; updated_at?: string
        }
        Update: Partial<{
          customer_name: string; contract_date: string; use_approval_date: string | null
          region_si: string | null; region_myeon: string | null; region_ri: string | null
          inspection_type: string; address: string | null; notes: string | null; is_active: boolean
          assigned_employee_id: string | null; updated_at: string
        }>
        Relationships: never[]
      }
      customer_contacts: {
        Row: CustomerContact
        Insert: {
          customer_id: string; role: string; name: string
          id?: string; phone?: string | null; email?: string | null; created_at?: string; updated_at?: string
        }
        Update: Partial<{ name: string; phone: string | null; email: string | null; updated_at: string }>
        Relationships: never[]
      }
      buildings: {
        Row: Building
        Insert: {
          customer_id: string; building_name: string; created_by: string
          id?: string; address?: string | null; total_area?: number | null
          floors_above?: number | null; floors_below?: number | null; purpose?: string | null
          year_built?: number | null; notes?: string | null; is_active?: boolean
          created_at?: string; updated_at?: string
        }
        Update: Partial<{
          building_name: string; address: string | null; total_area: number | null
          floors_above: number | null; floors_below: number | null; purpose: string | null
          year_built: number | null; notes: string | null; is_active: boolean; updated_at: string
        }>
        Relationships: never[]
      }
      inspections: {
        Row: Inspection
        Insert: {
          customer_id: string; assigned_employee_id: string; inspection_type: string
          inspection_start_date: string; created_by: string
          id?: string; contact_id?: string | null; notification_date?: string | null
          sequence_num?: number; status?: string; notes?: string | null; created_at?: string; updated_at?: string
        }
        Update: Partial<{
          contact_id: string | null; assigned_employee_id: string; inspection_type: string
          inspection_start_date: string; notification_date: string | null
          sequence_num: number; status: string; notes: string | null; updated_at: string
        }>
        Relationships: never[]
      }
      inspection_steps: {
        Row: InspectionStep
        Insert: {
          inspection_id: string; step_num: number; name_ko: string
          id?: string; due_days?: number | null; is_working_days?: boolean | null; due_date?: string | null
          status?: string; completed_at?: string | null; completed_by?: string | null; notes?: string | null
          created_at?: string; updated_at?: string
        }
        Update: Partial<{
          status: string; completed_at: string | null; completed_by: string | null; notes: string | null; updated_at: string
        }>
        Relationships: never[]
      }
      inspection_reports: {
        Row: InspectionReport
        Insert: {
          inspection_id: string; report_type: string; customer_code: string; customer_name: string
          id?: string; submitted_at?: string | null; submitted_by?: string | null
          file_name?: string | null; file_path?: string | null; file_size?: number | null; mime_type?: string | null
          notes?: string | null; created_at?: string; updated_at?: string
        }
        Update: Partial<{
          submitted_at: string | null; submitted_by: string | null
          file_name: string | null; file_path: string | null; file_size: number | null; mime_type: string | null
          notes: string | null; updated_at: string
        }>
        Relationships: never[]
      }
    }
    Views: Record<string, { Row: Record<string, unknown>; Relationships: never[] }>
    Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>
    Enums: Record<string, string[]>
    CompositeTypes: Record<string, Record<string, unknown>>
  }
}
