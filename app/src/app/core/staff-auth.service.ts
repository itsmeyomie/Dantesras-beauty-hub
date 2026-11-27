import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { DataService } from './data.service';
import { NotifyService } from './notify.service';
import { environment } from '../../environments/environment';

/** Built-in roles; the owner can also create others (e.g. finisher). */
export type StaffRole = string;
export interface StaffMe {
  id: string; name: string; email: string | null; phone: string | null; roles: string[]; photo: string | null;
  specialty: string | null; account_status: 'none' | 'pending' | 'approved' | 'declined'; wanted_role: string | null;
  active: boolean; requested_at: string | null; decline_reason: string | null;
  /** screens this person can open (from all their roles) */
  areas?: string[];
}
/** Screens everyone signed in can open. */
const ALWAYS = ['me', 'more'];
/** Screens only the owner can open. */
const OWNER_ONLY = ['settings', 'staff-requests', 'roles'];

/** Starting screens of the built-in roles (the owner can change them under Roles). Used if the server sends no list. */
export const ACCESS: Record<string, StaffRole[]> = {
  dashboard: ['owner', 'manager'],
  bookings: ['owner', 'manager', 'receptionist', 'stylist'],
  checkout: ['owner', 'manager', 'receptionist', 'stylist'],
  sales: ['owner', 'manager', 'receptionist'],
  clients: ['owner', 'manager', 'receptionist'],
  debts: ['owner', 'manager', 'receptionist'],
  outside: ['owner', 'manager'],
  services: ['owner', 'manager'],
  products: ['owner', 'manager'],
  team: ['owner', 'manager'],
  school: ['owner', 'manager', 'receptionist'],
  reports: ['owner', 'manager'],
  settings: ['owner'],
  'staff-requests': ['owner'],
  desk: ['owner', 'manager', 'receptionist'],
  'my-day': ['stylist'],
  me: ['owner', 'manager', 'receptionist', 'stylist'],
  more: ['owner', 'manager', 'receptionist', 'stylist'],
};

const TOKEN_KEY = 'dbh.staff.token';
type LoginResult = { status: 'approved' | 'pending'; token?: string; staff: StaffMe };
const read = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const write = (v: string | null) => { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

/** Staff sign-in, session and role checks. */
@Injectable({ providedIn: 'root' })
export class StaffAuthService {
  private data = inject(DataService);
  private notify = inject(NotifyService);
  readonly token = signal<string | null>(read());
  readonly me = signal<StaffMe | null>(null);
  readonly signedIn = computed(() => !!this.token());
  /** only the owner sees client numbers */
  private readonly ownerSync = effect(() => {
    const own = !!this.me()?.roles.includes('owner');
    if (own !== this.data.owner()) { this.data.owner.set(own); this.data.contacts.set({}); }
  });

  /** Main role: owner > manager > receptionist > stylist > any other role */
  readonly role = computed<StaffRole | null>(() => {
    const r = this.me()?.roles ?? [];
    return ['owner', 'manager', 'receptionist', 'stylist'].find((k) => r.includes(k)) ?? r.find((k) => k !== 'tutor') ?? r[0] ?? null;
  });
  readonly firstName = computed(() => (this.me()?.name ?? '').split(' ')[0]);
  readonly roleLabel = computed(() => this.data.roleName(this.role()) || 'Staff');

  /** May the signed-in person open this area? */
  can(area: string): boolean {
    const me = this.me();
    if (!me) return false;
    if (area === 'dev') return this.isDev();
    if (me.roles.includes('owner') || ALWAYS.includes(area)) return true;
    if (OWNER_ONLY.includes(area)) return false;
    if (me.areas) return me.areas.includes(area);
    const allowed = ACCESS[area];
    if (!allowed) return true;
    return allowed.some((r) => me.roles.includes(r));
  }
  /** Where a person lands after signing in: their main screen */
  home(): string {
    if (this.can('dashboard')) return '/dashboard';
    if (this.can('desk')) return '/desk';
    if (this.can('my-day')) return '/my-day';
    const first = ['bookings', 'checkout', 'clients', 'sales', 'school', 'reports'].find((a) => this.can(a));
    return first ? '/' + first : '/me';
  }

  private call<T>(fn: string, args: Record<string, unknown>) {
    return this.data.rpc<T>(fn, args);
  }
  private async authed<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    try {
      return await this.call<T>(fn, { p_token: this.token(), ...args });
    } catch (e) {
      if (String(e instanceof Error ? e.message : e).includes('STAFF_SESSION')) this.clear();
      throw new Error(String(e instanceof Error ? e.message : e).replace(/^STAFF_SESSION:\s*/, ''));
    }
  }
  private clear() {
    this.token.set(null);
    this.me.set(null);
    this.isDev.set(false);
    write(null);
  }

  async login(email: string, password: string): Promise<'approved' | 'pending'> {
    return this.applyLogin(await this.call<LoginResult>('staff_login', { p_email: email, p_password: password }));
  }

  // ---------- Continue with Google (staff accounts that use that Google email) ----------
  /** Go to Google. Web: comes back to /staff/sign-in?code=…; Android: opens Google in the browser. */
  async googleStart() {
    try { localStorage.setItem('dbh.google.for', 'staff'); } catch { /* private mode */ }
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const url = await this.data.authGoogleUrl('ke.dantesras.app://auth-callback');
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
    } else {
      location.href = await this.data.authGoogleUrl(new URL('staff/sign-in', document.baseURI).href);
    }
  }
  async googleFinish(code: string) {
    try { localStorage.removeItem('dbh.google.for'); } catch { /* private mode */ }
    return this.applyLogin(await this.data.authFinishGoogleStaff<LoginResult>(code));
  }
  /** Test mode only: "Google" without a Google account. */
  async testGoogle(email: string) {
    return this.applyLogin(await this.call<LoginResult>('staff_test_google', { p_email: email.trim() }));
  }
  private applyLogin(r: LoginResult): 'approved' | 'pending' {
    this.me.set(r.staff);
    if (r.status === 'approved' && r.token) {
      this.token.set(r.token);
      write(r.token);
      void this.notify.register('staff', r.token);
      void this.data.loadReference().catch(() => undefined); // the app opened signed out: load the team now
      void this.checkDev();
    }
    return r.status;
  }
  signup(p: { name: string; email: string; phone: string; password: string; role: string; specialty: string; photo: string | null }) {
    return this.call<StaffMe>('staff_signup', { p });
  }
  // ---------- forgot password (code by email) ----------
  /** Email a 6-digit code. Test mode: the code comes back to show on screen. */
  async resetCode(email: string): Promise<{ to: string; dev_code?: string }> {
    const address = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(address)) throw new Error('Enter a valid email address');
    if (environment.simulateSignIn) return this.call<{ to: string; dev_code?: string }>('staff_reset_test_code', { p_email: address });
    await this.data.authEmailCode(address);
    return { to: address };
  }
  /** Set a new password with the emailed code. Signs out this person everywhere. */
  resetPassword(email: string, code: string, password: string) {
    const address = email.trim().toLowerCase();
    return environment.simulateSignIn
      ? this.call<{ ok: boolean; name: string }>('staff_reset_with_test_code', { p_email: address, p_code: code, p_password: password })
      : this.data.authStaffReset(address, code, password);
  }
  setupNeeded() {
    return this.call<boolean>('staff_setup_needed', {});
  }
  async ownerSetup(p: { name: string; email: string; password: string }) {
    const r = await this.call<{ token: string; staff: StaffMe }>('staff_owner_setup', { p });
    this.token.set(r.token);
    write(r.token);
    this.me.set(r.staff);
  }
  /** Loads the profile; false if there is no valid session. */
  async ensureMe(): Promise<boolean> {
    if (!this.token()) return false;
    if (this.me()?.account_status === 'approved') return true;
    this.pausedOut = false;
    try {
      this.me.set(await this.authed<StaffMe>('staff_me'));
      void this.notify.register('staff', this.token()!);
      void this.checkDev();
      return true;
    } catch (e) {
      // paused by the developer: stay signed in, so Resume brings everyone straight back
      this.pausedOut = String(e instanceof Error ? e.message : e).includes('SERVICE_PAUSED');
      if (!this.pausedOut) this.clear();
      return false;
    }
  }
  async update(p: Partial<StaffMe> & { password?: string }) {
    this.me.set(await this.authed<StaffMe>('staff_update_me', { p }));
  }
  async logout() {
    await this.notify.unregister('staff');
    const t = this.token();
    this.clear();
    if (t) await this.call('staff_logout', { p_token: t }).catch(() => undefined);
  }

  /** The last sign-in check was refused because the developer paused the service (still signed in). */
  pausedOut = false;

  // ---------- developer (/dev) ----------
  /** The signed-in person is a developer (checked by the database, never by the app). */
  readonly isDev = signal(false);
  async checkDev(): Promise<boolean> {
    const t = this.token();
    const yes = !!t && (await this.call<boolean>('dev_check', { p_token: t }).catch(() => false));
    this.isDev.set(yes);
    return yes;
  }
  dev<T>(fn: string, args: Record<string, unknown> = {}) {
    return this.authed<T>(fn, args);
  }

  // ---------- owner ----------
  requests() {
    return this.authed<StaffMe[]>('staff_requests');
  }
  approve(id: string, role: string) {
    return this.authed<StaffMe>('staff_approve', { p_id: id, p_role: role });
  }
  decline(id: string, reason: string) {
    return this.authed<void>('staff_decline', { p_id: id, p_reason: reason });
  }
  async saveRole(p: { key?: string; name: string; areas: string[]; serves: boolean; finishes: boolean }) {
    const r = await this.authed<unknown>('staff_role_save', { p });
    await this.data.refreshRoles();
    return r;
  }
  async deleteRole(key: string) {
    await this.authed<void>('staff_role_delete', { p_key: key });
    await this.data.refreshRoles();
  }
}

/** Shrinks a picked photo to a small square-ish JPEG (data URL) before upload. */
export function resizePhoto(file: File, max = 360): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Choose a photo (JPG or PNG)'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('Could not read that photo'));
    img.src = url;
  });
}
