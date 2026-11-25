import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { DataService } from '../core/data.service';
import { NotifyService } from '../core/notify.service';

export type OtpChannel = 'sms' | 'whatsapp' | 'email';
/** Where Google sends the client back in the Android app (also listed in AndroidManifest.xml and Supabase → Auth → URL configuration). */
export const APP_AUTH_CALLBACK = 'ke.dantesras.app://auth-callback';
const RETURN_KEY = 'dbh.signin.return';
/** Which sign-in page started Google ('client' | 'staff') – the Android app link returns there. */
export const GOOGLE_FOR_KEY = 'dbh.google.for';

export interface PVariant { id: string; name: string; price: number; }
export interface PService { id: string; name: string; price: number; price_type: 'fixed' | 'range' | 'from'; max_price: number | null; variants: PVariant[]; }
export interface PCategory { id: string; name: string; client_type: 'kids' | 'adult' | 'any'; services: PService[]; }
export interface PCourse { id: string; name: string; fee: number; fee_type: 'total' | 'monthly'; duration_value: number; duration_unit: 'weeks' | 'months'; }
export interface Catalog {
  categories: PCategory[];
  stylists: { id: string; name: string; photo?: string | null; specialty?: string | null }[];
  courses: PCourse[];
  settings: Record<string, unknown>;
}
export interface Me { id: string; name: string; phone: string | null; whatsapp: string | null; email: string | null; birth_date: string | null; area: string | null; balance: number; }
export interface CartItem { service_id: string; variant_id: string | null; name: string; price: number; approx: boolean; }
export interface Draft {
  items: CartItem[];
  channel: 'salon' | 'home';
  address: string;
  staff_id: string | null;
  date: string | null;
  time: string | null;
  notes: string;
}
export interface MyBooking {
  id: string; channel: 'salon' | 'home'; status: string; scheduled_at: string; address: string | null; notes: string | null;
  response_note: string | null; online: boolean; services: { name: string; price: number }[]; stylists: string[];
  total: number; paid: number;
}
export interface SchoolInfo {
  applications: { id: string; course: string; name: string; status: string; preferred_start: string | null; response_note: string | null; created_at: string; total: number }[];
  enrolments: { id: string; name: string; course: string; start_date: string; status: string; total_fee: number; paid: number; balance: number; phone: string | null }[];
}
export interface Slot { time: string; free: boolean; }

const TOKEN_KEY = 'dbh.portal.token';
const DRAFT_KEY = 'dbh.portal.draft';
const emptyDraft = (): Draft => ({ items: [], channel: 'salon', address: '', staff_id: null, date: null, time: null, notes: '' });

function readStore(key: string, session = false): string | null {
  try {
    return (session ? sessionStorage : localStorage).getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string | null, session = false) {
  try {
    const s = session ? sessionStorage : localStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch { /* private mode – keep in memory only */ }
}

/** Everything the client app needs: session, menu, booking draft and the portal_* database functions. */
@Injectable({ providedIn: 'root' })
export class PortalService {
  private data = inject(DataService);
  private notify = inject(NotifyService);
  private router = inject(Router);
  readonly simulation = environment.simulate;
  /** test mode for client sign-in: code on screen, simulated Google */
  readonly simulatedSignIn = environment.simulateSignIn;

  readonly token = signal<string | null>(readStore(TOKEN_KEY));
  readonly me = signal<Me | null>(null);
  readonly catalog = signal<Catalog | null>(null);
  readonly draft = signal<Draft>(this.loadDraft());
  readonly signedIn = computed(() => !!this.token());

  readonly depositMin = computed(() => Number(this.catalog()?.settings['deposit_min'] ?? 500));
  readonly cartTotal = computed(() => this.draft().items.reduce((a, i) => a + Number(i.price), 0));
  readonly firstName = computed(() => (this.me()?.name ?? '').split(' ')[0]);

  // ---------- helpers ----------
  private async call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    try {
      return await this.data.rpc<T>(fn, args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('SESSION_EXPIRED')) {
        this.clearSession();
        void this.router.navigate(['/portal/sign-in'], { queryParams: { returnUrl: this.router.url } });
        throw new Error('Please sign in again');
      }
      throw e;
    }
  }
  private authed<T>(fn: string, args: Record<string, unknown> = {}) {
    return this.call<T>(fn, { p_token: this.token(), ...args });
  }
  private clearSession() {
    this.token.set(null);
    this.me.set(null);
    writeStore(TOKEN_KEY, null);
  }

  // ---------- menu ----------
  async loadCatalog(force = false): Promise<Catalog> {
    if (this.catalog() && !force) return this.catalog()!;
    const c = await this.call<Catalog>('portal_catalog', {});
    this.catalog.set(c);
    return c;
  }
  setting<T>(key: string, fallback: T): T {
    const v = this.catalog()?.settings[key];
    return v === undefined || v === null || v === '' ? fallback : (v as T);
  }

  // ---------- sign-in (free: email code or Google – no SMS) ----------
  /** Send a 6-digit code by email. Test mode: the code comes back to show on screen. */
  async requestEmailCode(email: string): Promise<{ to: string; dev_code?: string }> {
    const address = email.trim().toLowerCase();
    if (this.simulatedSignIn) return this.call<{ to: string; dev_code?: string }>('portal_test_code', { p_channel: 'email', p_address: address });
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(address)) throw new Error('Enter a valid email address');
    await this.data.authEmailCode(address);
    return { to: address };
  }
  async verifyEmailCode(email: string, code: string): Promise<{ is_new: boolean }> {
    const address = email.trim().toLowerCase();
    const r = this.simulatedSignIn
      ? await this.call<{ token: string; is_new: boolean }>('portal_verify_code', { p_channel: 'email', p_address: address, p_code: code })
      : await this.data.authVerifyEmail(address, code);
    return this.startSession(r);
  }
  /** Test mode only: "Google" without a Google account. */
  async testGoogle(email: string, name: string) {
    return this.startSession(await this.call<{ token: string; is_new: boolean }>('portal_test_google', { p_email: email.trim(), p_name: name.trim() }));
  }
  /** Go to Google. Web: this page is left and Google comes back to /portal/sign-in?code=…; Android: opens Google in the browser. */
  async googleStart(returnUrl: string | undefined) {
    writeStore(RETURN_KEY, returnUrl || '/portal', true);
    writeStore(GOOGLE_FOR_KEY, 'client');
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const url = await this.data.authGoogleUrl(APP_AUTH_CALLBACK);
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
    } else {
      location.href = await this.data.authGoogleUrl(new URL('portal/sign-in', document.baseURI).href);
    }
  }
  /** Back from Google with a code. Returns where to go next. */
  async googleFinish(code: string): Promise<{ is_new: boolean; returnUrl: string }> {
    const r = await this.startSession(await this.data.authFinishGoogle(code));
    const returnUrl = readStore(RETURN_KEY, true) || '/portal';
    writeStore(RETURN_KEY, null, true);
    return { ...r, returnUrl };
  }
  private async startSession(r: { token: string; is_new: boolean }): Promise<{ is_new: boolean }> {
    this.token.set(r.token);
    writeStore(TOKEN_KEY, r.token);
    await this.loadMe();
    return { is_new: r.is_new };
  }
  async loadMe(): Promise<Me | null> {
    if (!this.token()) return null;
    const me = await this.authed<Me>('portal_me');
    this.me.set(me);
    void this.notify.register('client', this.token()!);
    return me;
  }
  async updateProfile(p: Partial<Me>) {
    this.me.set(await this.authed<Me>('portal_update_profile', { p }));
  }
  async signOut() {
    await this.notify.unregister('client');
    const t = this.token();
    this.clearSession();
    if (t) await this.data.rpc('portal_sign_out', { p_token: t }).catch(() => undefined);
  }

  // ---------- booking draft ----------
  private loadDraft(): Draft {
    try {
      return { ...emptyDraft(), ...JSON.parse(readStore(DRAFT_KEY, true) ?? '{}') };
    } catch {
      return emptyDraft();
    }
  }
  updateDraft(fn: (d: Draft) => Draft) {
    this.draft.update((d) => fn({ ...d }));
    writeStore(DRAFT_KEY, JSON.stringify(this.draft()), true);
  }
  resetDraft() {
    this.draft.set(emptyDraft());
    writeStore(DRAFT_KEY, null, true);
  }

  // ---------- bookings ----------
  slots(date: string, staffId: string | null) {
    return this.call<Slot[]>('portal_slots', { p_date: date, p_staff: staffId });
  }
  /** Is this exact time possible? If not: why, and the nearest free times. */
  checkTime(date: string, time: string, staffId: string | null) {
    return this.call<{ ok: boolean; reason?: string; suggestions?: string[] }>('portal_check_time', { p_date: date, p_time: time, p_staff: staffId });
  }
  /** Availability of each day in a month: open / full / closed / none */
  month(first: string, staffId: string | null) {
    return this.call<Record<string, 'open' | 'full' | 'closed' | 'none'>>('portal_month', { p_first: first, p_staff: staffId });
  }
  /** Each stylist, free or busy at this exact time */
  stylistsAt(date: string, time: string) {
    return this.call<{ id: string; name: string; free: boolean; photo?: string | null; specialty?: string | null }[]>('portal_stylists_at', { p_date: date, p_time: time });
  }
  requestBooking(d: Draft) {
    return this.authed<{ id: string; total: number; deposit: number }>('portal_request_booking', {
      p: {
        channel: d.channel, date: d.date, time: d.time, staff_id: d.staff_id, address: d.address, notes: d.notes,
        services: d.items.map((i) => ({ service_id: i.service_id, variant_id: i.variant_id })),
      },
    });
  }
  bookings() {
    return this.authed<MyBooking[]>('portal_bookings');
  }
  cancelBooking(id: string, reason?: string) {
    return this.authed<void>('portal_cancel_booking', { p_id: id, p_reason: reason ?? null });
  }

  // ---------- school ----------
  school() {
    return this.authed<SchoolInfo>('portal_school');
  }
  apply(p: Record<string, unknown>) {
    return this.authed<string>('portal_apply_course', { p });
  }
  withdraw(id: string) {
    return this.authed<void>('portal_withdraw_application', { p_id: id });
  }
}

export function courseTotal(c: PCourse): number {
  if (c.fee_type !== 'monthly') return Number(c.fee);
  const months = c.duration_unit === 'months' ? Number(c.duration_value) : Math.ceil(Number(c.duration_value) / 4.33);
  return Number(c.fee) * months;
}

export function priceText(s: PService, ksh: (n: number) => string): string {
  if (s.price_type === 'range' && s.max_price) return `${ksh(s.price)} – ${ksh(s.max_price).replace('KSh ', '')}`;
  if (s.price_type === 'from') return `from ${ksh(s.price)}`;
  return ksh(s.price);
}

/** Booking status in the client's words */
export const STATUS_TEXT: Record<string, { label: string; tone: 'wait' | 'ok' | 'bad' | 'info' | 'done' }> = {
  requested: { label: 'Waiting for the salon to confirm', tone: 'wait' },
  pending: { label: 'Confirmed · pay deposit to hold your slot', tone: 'wait' },
  booked: { label: 'Confirmed', tone: 'ok' },
  waiting: { label: 'In the queue', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Done – thank you!', tone: 'done' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
  declined: { label: 'Not available', tone: 'bad' },
  no_show: { label: 'Missed', tone: 'bad' },
};
