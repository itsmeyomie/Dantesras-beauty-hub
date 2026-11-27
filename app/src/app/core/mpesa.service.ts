import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { DataService } from './data.service';

export type StkPurpose = 'deposit' | 'debt' | 'school_fee';
export type StkState = 'pending' | 'success' | 'failed' | 'cancelled' | 'timeout';

export interface StkRequest {
  purpose: StkPurpose;
  phone: string | null;
  amount: number;
  booking_id?: string;
  sale_id?: string;
  student_id?: string;
}
export interface StkStarted { id: string; checkout_request_id: string; phone: string; amount: number; simulated: boolean; customer_message: string; }
export interface StkStatus {
  id: string; status: StkState; amount: number; phone: string; receipt: string | null;
  result_desc: string | null; needs_attention: string | null; simulated: boolean; checkout_request_id: string | null;
}
export type SimOutcome = 'pay' | 'cancel' | 'insufficient' | 'timeout' | 'wrong_pin';

/**
 * M-Pesa STK push ("enter your PIN" prompt on the client's phone).
 * Live: Supabase Edge Function `mpesa-stk` calls Safaricom Daraja; Safaricom calls `mpesa-callback`.
 * Simulation (no Daraja keys yet): same calls, the prompt is shown on screen and answered there.
 */
@Injectable({ providedIn: 'root' })
export class MpesaService {
  private data = inject(DataService);
  readonly simulation = environment.simulate;

  start(r: StkRequest) {
    // test mode: simulated prompt straight from the database; live: the mpesa-stk function calls Safaricom
    if (this.simulation) {
      return this.data.rpc<StkStarted>('stk_test_start', {
        p_purpose: r.purpose, p_phone: r.phone, p_amount: r.amount,
        p_booking_id: r.booking_id ?? null, p_sale_id: r.sale_id ?? null, p_student_id: r.student_id ?? null,
      });
    }
    return this.data.invoke<StkStarted>('mpesa-stk', { ...r });
  }
  status(id: string) {
    return this.data.rpc<StkStatus>('stk_status', { p_id: id });
  }
  /** Simulation only: answer the prompt as if on the phone. */
  simulate(checkoutRequestId: string, outcome: SimOutcome) {
    return this.data.rpc<{ status: StkState }>('stk_test_answer', { p_checkout_request_id: checkoutRequestId, p_outcome: outcome });
  }

  /** Poll until the request is answered (or the timeout passes). */
  async wait(id: string, onTick?: (s: StkStatus) => void, signal?: { stop: boolean }): Promise<StkStatus> {
    const until = Date.now() + 150_000;
    for (;;) {
      const s = await this.status(id);
      onTick?.(s);
      if (s.status !== 'pending' || Date.now() > until || signal?.stop) return s;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** 07XX XXX XXX → valid? (Safaricom / Kenyan mobile) */
export function validPhone(p: string | null | undefined): boolean {
  const d = (p ?? '').replace(/\D/g, '');
  return /^(254|0)?[17]\d{8}$/.test(d);
}

export function stkMessage(s: StkStatus): string {
  switch (s.status) {
    case 'success': return s.needs_attention ? `Paid (${s.receipt}), but the owner must apply it: ${s.needs_attention}` : `Paid – M-Pesa code ${s.receipt}`;
    case 'cancelled': return 'The prompt was cancelled on the phone.';
    case 'timeout': return 'No answer from the phone. Make sure it is on and unlocked, then try again.';
    case 'failed': return s.result_desc || 'The payment did not go through.';
    default: return 'Waiting for the PIN…';
  }
}
