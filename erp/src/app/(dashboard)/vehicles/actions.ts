'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole, getProfile } from '@/lib/auth'

export type CreateVehicleInput = {
  vehicle_number: string
  vehicle_name: string
  vehicle_type?: string
  maker?: string
  model_year?: number
  color?: string
  fuel_type?: string
  insurance_expiry?: string
  inspection_expiry?: string
  notes?: string
}

export async function createVehicleAction(input: CreateVehicleInput): Promise<{ error?: string; vehicleId?: string }> {
  const profile = await requireRole(['manager', 'admin'])
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('vehicles')
    .insert({
      vehicle_number: input.vehicle_number,
      vehicle_name: input.vehicle_name,
      vehicle_type: input.vehicle_type || null,
      maker: input.maker || null,
      model_year: input.model_year || null,
      color: input.color || null,
      fuel_type: input.fuel_type || null,
      insurance_expiry: input.insurance_expiry || null,
      inspection_expiry: input.inspection_expiry || null,
      notes: input.notes || null,
      is_active: true,
      created_by: profile.id,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/vehicles')
  return { vehicleId: (data as { id: string }).id }
}

export async function updateVehicleAction(id: string, input: Partial<CreateVehicleInput> & { is_active?: boolean }): Promise<{ error?: string }> {
  await requireRole(['manager', 'admin'])
  const admin = createAdminClient()

  const { error } = await admin
    .from('vehicles')
    .update({
      ...input,
      vehicle_type: input.vehicle_type || null,
      maker: input.maker || null,
      model_year: input.model_year || null,
      color: input.color || null,
      fuel_type: input.fuel_type || null,
      insurance_expiry: input.insurance_expiry || null,
      inspection_expiry: input.inspection_expiry || null,
      notes: input.notes || null,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/vehicles')
  revalidatePath(`/vehicles/${id}`)
  return {}
}

// 차량운행일지
export type CreateVehicleLogInput = {
  vehicle_id: string
  log_date: string
  departure_time?: string
  arrival_time?: string
  departure_location?: string
  destination?: string
  purpose?: string
  start_mileage?: number
  end_mileage?: number
  fuel_cost?: number
  toll_cost?: number
  notes?: string
}

export async function createVehicleLogAction(input: CreateVehicleLogInput): Promise<{ error?: string; logId?: string }> {
  const profile = await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const distance = (input.end_mileage && input.start_mileage)
    ? input.end_mileage - input.start_mileage
    : null

  const { data, error } = await admin
    .from('vehicle_logs')
    .insert({
      vehicle_id: input.vehicle_id,
      driver_id: profile.id,
      log_date: input.log_date,
      departure_time: input.departure_time || null,
      arrival_time: input.arrival_time || null,
      departure_location: input.departure_location || null,
      destination: input.destination || null,
      purpose: input.purpose || null,
      start_mileage: input.start_mileage ?? null,
      end_mileage: input.end_mileage ?? null,
      distance,
      fuel_cost: input.fuel_cost ?? null,
      toll_cost: input.toll_cost ?? null,
      notes: input.notes || null,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/vehicles/log')
  return { logId: (data as { id: string }).id }
}
