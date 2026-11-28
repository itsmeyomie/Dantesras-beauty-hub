import { Injectable, inject } from '@angular/core';
import { DataService } from './data.service';

/** Expense module. Everything goes through database functions (exp_*): staff see only their own, the owner everything. */
export type ExpSource = 'STAFF_PERSONAL' | 'SALON_FUNDS';
export type ExpApproval = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ReimbStatus = 'PENDING' | 'PARTIALLY_REIMBURSED' | 'FULLY_REIMBURSED';

export interface ExpCategory { id: string; name: string; active: boolean; sort: number; }
export interface ReimbPayment {
  id: string; reimbursement_id: string; expense_id: string; staff_id: string | null; amount: number;
  method: 'cash' | 'mpesa' | 'bank' | 'other'; reference: string | null; paid_on: string; notes: string | null;
  recorded_by_name: string | null; created_at: string;
}
export interface Reimbursement {
  id: string; expense_id: string; staff_id: string | null; staff_name: string; amount_owed: number; amount_paid: number;
  outstanding: number; status: ReimbStatus; last_paid_at: string | null; created_at: string; payments: ReimbPayment[];
}
export interface Expense {
  id: string; description: string; amount: number; category_id: string; category_name: string; expense_date: string;
  notes: string | null; paid_by_staff: string | null; paid_by_name: string; payment_source: ExpSource; salon_method: string | null;
  approval_status: ExpApproval; created_at: string; approved_at: string | null; approved_by_name: string | null;
  rejection_reason: string | null; outside_buy_id: string | null; reimbursement: Reimbursement | null;
}
export interface MySummary { submitted: number; pending: number; approved: number; rejected: number; owed: number; reimbursed: number; outstanding: number; }
export interface AuditRow { id: string; action: string; performed_by_name: string | null; at: string; previous_value: unknown; new_value: unknown; notes: string | null; }

export interface ExpInput { description: string; amount: number; category_id: string; expense_date: string; notes?: string | null; }
export interface OwnerExpInput extends ExpInput { payment_source: ExpSource; paid_by_staff?: string | null; salon_method?: string | null; }
export interface PayInput { reimbursement_id: string; amount: number; method: string; reference?: string | null; paid_on: string; notes?: string | null; request_key: string; }

@Injectable({ providedIn: 'root' })
export class ExpensesService {
  private data = inject(DataService);

  categories() { return this.data.rpc<ExpCategory[]>('exp_categories', {}); }
  saveCategory(c: Partial<ExpCategory>) { return this.data.rpc<string>('exp_category_save', { p: c }); }
  // staff
  submit(p: ExpInput) { return this.data.rpc<Expense>('exp_submit', { p }); }
  mine() { return this.data.rpc<{ expenses: Expense[]; summary: MySummary }>('exp_mine', {}); }
  // owner
  add(p: OwnerExpInput) { return this.data.rpc<Expense>('exp_add', { p }); }
  all() { return this.data.rpc<{ expenses: Expense[]; payments: ReimbPayment[] }>('exp_all', {}); }
  audit(id: string) { return this.data.rpc<AuditRow[]>('exp_audit', { p_expense: id }); }
  decide(id: string, approve: boolean, reason: string | null = null) {
    return this.data.rpc<Expense>('exp_decide', { p_id: id, p_approve: approve, p_reason: reason });
  }
  edit(p: Partial<Expense>) { return this.data.rpc<Expense>('exp_edit', { p }); }
  reimburse(p: PayInput) { return this.data.rpc<Expense>('exp_reimburse', { p }); }
}

// ---------- labels and sums shared by the screens ----------
export const METHODS: { value: string; label: string }[] = [
  { value: 'cash', label: 'Cash' }, { value: 'mpesa', label: 'M-Pesa' }, { value: 'bank', label: 'Bank' }, { value: 'other', label: 'Other' },
];
export const methodLabel = (m: string | null) => METHODS.find((x) => x.value === m)?.label ?? (m === 'card' ? 'Card' : m ?? '');

/** what the staff member / owner sees as the state of one expense */
export function expState(e: Expense): { label: string; cls: string } {
  if (e.approval_status === 'PENDING') return { label: 'Pending approval', cls: 'pending' };
  if (e.approval_status === 'REJECTED') return { label: 'Rejected', cls: 'cancelled' };
  const r = e.reimbursement;
  if (!r) return { label: 'Approved', cls: 'booked' };
  if (r.status === 'FULLY_REIMBURSED') return { label: 'Fully reimbursed', cls: 'completed' };
  if (r.status === 'PARTIALLY_REIMBURSED') return { label: 'Partially reimbursed', cls: 'waiting' };
  return { label: 'Approved · to reimburse', cls: 'booked' };
}
export const reimbLabel = (s: ReimbStatus | undefined) =>
  s === 'FULLY_REIMBURSED' ? 'Fully reimbursed' : s === 'PARTIALLY_REIMBURSED' ? 'Partially reimbursed' : s === 'PENDING' ? 'Not yet paid' : '—';

/**
 * The owner's figures for a period (by expense date; reimbursement payments by payment date).
 * Reimbursements are settlement of what is owed – never added to salon expenses.
 */
export function expTotals(expenses: Expense[], payments: ReimbPayment[], from: string, to: string) {
  const inRange = (d: string) => d >= from && d <= to;
  const approved = expenses.filter((e) => e.approval_status === 'APPROVED' && inRange(e.expense_date));
  const sum = (l: { amount: number }[]) => l.reduce((a, x) => a + Number(x.amount), 0);
  const reimbs = expenses.map((e) => e.reimbursement).filter((r): r is Reimbursement => !!r);
  const pending = expenses.filter((e) => e.approval_status === 'PENDING');
  return {
    total: sum(approved),
    staffPaid: sum(approved.filter((e) => e.payment_source === 'STAFF_PERSONAL')),
    salonPaid: sum(approved.filter((e) => e.payment_source === 'SALON_FUNDS')),
    reimbursedInPeriod: sum(payments.filter((p) => inRange(p.paid_on))),
    // all time: what the salon still owes its staff
    outstanding: reimbs.reduce((a, r) => a + Number(r.amount_owed) - Number(r.amount_paid), 0),
    owedAllTime: reimbs.reduce((a, r) => a + Number(r.amount_owed), 0),
    reimbursedAllTime: reimbs.reduce((a, r) => a + Number(r.amount_paid), 0),
    pendingCount: pending.length,
    pendingSum: sum(pending),
    approved,
  };
}

/** today / this week … as yyyy-mm-dd (Kenyan days) */
export type Period = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'all' | 'custom';
export const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' }, { value: 'last_month', label: 'Previous month' }, { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];
export const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function periodRange(p: Period, from = '', to = ''): [string, string] {
  const now = new Date();
  const d = (y: number, m: number, day: number) => ymdOf(new Date(y, m, day));
  const y = now.getFullYear(), m = now.getMonth(), t = now.getDate();
  switch (p) {
    case 'today': return [ymdOf(now), ymdOf(now)];
    case 'yesterday': return [d(y, m, t - 1), d(y, m, t - 1)];
    case 'week': { const back = (now.getDay() + 6) % 7; return [d(y, m, t - back), ymdOf(now)]; } // Monday–today
    case 'month': return [d(y, m, 1), ymdOf(now)];
    case 'last_month': return [d(y, m - 1, 1), d(y, m, 0)];
    case 'custom': return [from || '2000-01-01', to || ymdOf(now)];
    default: return ['2000-01-01', '2999-12-31'];
  }
}
/** Monday of the week of a yyyy-mm-dd */
export function weekOf(day: string) {
  const dt = new Date(day + 'T00:00:00');
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return ymdOf(dt);
}
