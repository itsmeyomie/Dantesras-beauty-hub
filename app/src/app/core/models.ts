export type Channel = 'salon' | 'home' | 'walkin';
export type BookingStatus = 'requested' | 'pending' | 'booked' | 'waiting' | 'in_progress' | 'completed' | 'cancelled' | 'no_show' | 'declined';
export type PayMethod = 'cash' | 'mpesa_till' | 'mpesa_paybill' | 'mpesa_send';

export const PAY_METHODS: { value: PayMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'mpesa_till', label: 'M-Pesa Till' },
  { value: 'mpesa_paybill', label: 'M-Pesa Paybill' },
  { value: 'mpesa_send', label: 'M-Pesa Send Money' },
];
export const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'salon', label: 'Salon booking' },
  { value: 'home', label: 'Home service' },
  { value: 'walkin', label: 'Walk-in' },
];
export const SOURCES = ['Call', 'WhatsApp', 'Instagram', 'Facebook', 'TikTok', 'In person', 'Referral'];

export interface Staff {
  id: string; name: string; phone: string | null; roles: string[];
  basic_salary: number; payout_schedule: 'daily' | 'weekly' | 'biweekly' | 'monthly'; active: boolean;
  photo?: string | null; specialty?: string | null;
}
/** A job / role. The owner creates them and picks the screens each one can open. */
export interface StaffRoleDef {
  key: string; name: string; areas: string[]; serves: boolean; finishes: boolean; built_in: boolean; sort: number;
}
export interface Client {
  id: string; name: string; phone: string | null; whatsapp: string | null; birth_date: string | null;
  gender: string | null; area: string | null; source: string | null; notes: string | null;
  parent_id: string | null; preferred_staff_id: string | null; created_at: string;
}
export interface Category { id: string; name: string; client_type: 'kids' | 'adult' | 'any'; sort: number; }
export interface Variant { id: string; service_id: string; name: string; price: number; sort: number; }
export interface Service {
  id: string; category_id: string; name: string; price: number; price_type: 'fixed' | 'range' | 'from';
  max_price: number | null; commission_pct: number; active: boolean; sort: number;
  service_variants?: Variant[];
}
export interface Product {
  id: string; name: string; category: string | null; unit: string; price: number; cost: number;
  stock_qty: number; low_stock: number; commission_pct: number; status: 'active' | 'pending' | 'inactive';
}
export interface BookingService { id?: string; service_id: string | null; variant_id: string | null; name: string; price: number; }
export interface Booking {
  id: string; client_id: string | null; guest_name: string | null; channel: Channel; source: string | null;
  status: BookingStatus; scheduled_at: string | null; duration_min: number | null; address: string | null;
  stylists_needed: number; transport_fee: number; notes: string | null; created_at: string;
  started_at: string | null; completed_at: string | null; cancel_reason: string | null;
  online?: boolean; response_note?: string | null;
  /** client served before the booked day: why, and the day they had booked */
  early_reason?: string | null; original_scheduled_at?: string | null;
  clients?: { name: string; phone: string | null } | null;
  booking_services?: BookingService[];
  booking_staff?: { staff_id: string; part?: 'main' | 'finisher'; staff?: { name: string } }[];
  payments?: { amount: number; kind: string }[];
}
export interface Course {
  id: string; name: string; fee: number; fee_type: 'total' | 'monthly';
  duration_value: number; duration_unit: 'weeks' | 'months'; active: boolean;
}
export interface Student {
  id: string; name: string; phone: string | null; guardian_name: string | null; guardian_phone: string | null;
  course_id: string; course_name?: string; start_date: string; status: 'active' | 'completed' | 'dropped';
  total_fee: number; paid?: number; balance?: number; notes: string | null;
}
export interface Debt {
  sale_id: string; sold_at: string; total: number; paid: number; balance: number;
  client_id: string; client_name: string; client_phone: string | null; days_owed: number;
}
export interface StaffBalance {
  staff_id: string; name: string; active: boolean; payout_schedule: string; basic_salary: number;
  commission_total: number; transport_total: number; paid_out: number; unpaid: number;
}
export interface PaymentInput { method: PayMethod; amount: number | null; mpesa_ref?: string; mpesa_time?: string; }

export interface Report {
  from: string; to: string; sales_total: number; sales_count: number; clients_served: number; avg_ticket: number;
  services_total: number; products_total: number; discounts: number; transport_fees: number; debt_created: number;
  commission: number; product_cost: number; voids: number;
  collected: { salon: number; school: number };
  by_method: Record<string, number>; school_by_method: Record<string, number>;
  by_channel: { channel: Channel; count: number; total: number }[];
  top_services: { name: string; count: number; total: number }[];
  top_products: { name: string; count: number; total: number }[];
  by_category: { name: string; total: number }[];
  by_staff: { id: string; name: string; clients: number; sales: number; commission: number }[];
  by_source: { source: string; count: number; total: number }[];
  by_hour: { hour: number; count: number; total: number }[];
  by_weekday: { dow: number; count: number; total: number }[];
  daily: { day: string; count: number; total: number }[];
  no_shows: number; forfeited_deposits: number; debts_outstanding: number; school_balances: number;
}

export function methodLabel(m: string): string {
  return PAY_METHODS.find((p) => p.value === m)?.label ?? m;
}
export function channelLabel(c: string): string {
  return CHANNELS.find((p) => p.value === c)?.label ?? c;
}
