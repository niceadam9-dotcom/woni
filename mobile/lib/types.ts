export type InspectionType = '종합' | '최초' | '기타'
export type PlanItemStatus = 'planned' | 'confirmed' | 'completed' | 'cancelled'
export type InspectionStatus = 'scheduled' | 'in_progress' | 'completed' | 'overdue'
export type StepStatus = 'pending' | 'completed' | 'overdue'
export type DefectSeverity = '경미' | '보통' | '중대'

export interface Profile {
  id: string
  employee_id: string
  name: string
  email: string
  role: 'employee' | 'manager' | 'admin'
  position: string | null
}

export interface PlanItem {
  id: string
  plan_id: string
  customer_id: string
  inspection_type: InspectionType
  sequence_num: 1 | 2
  scheduled_date: string | null
  assigned_employee_id: string | null
  status: PlanItemStatus
  inspection_id: string | null
  notes: string | null
  customer_name: string
  customer_code: string
  customer_address: string | null
}

export interface Inspection {
  id: string
  customer_id: string
  assigned_employee_id: string
  inspection_type: InspectionType
  inspection_start_date: string
  year: number
  sequence_num: 1 | 2
  status: InspectionStatus
  notes: string | null
}

export interface InspectionStep {
  id: string
  inspection_id: string
  step_num: number
  name_ko: string
  due_date: string | null
  status: StepStatus
  completed_at: string | null
}

export interface InspectionDefect {
  id: string
  inspection_id: string
  defect_code: string | null
  defect_name: string
  defect_detail: string | null
  photo_url: string | null
  severity: DefectSeverity
  created_at: string
}

export interface ClassifiedDefect {
  defect_name: string
  defect_detail: string | null
  severity: DefectSeverity
}
