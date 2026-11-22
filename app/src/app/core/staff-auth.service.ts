import { Injectable, computed, inject, signal } from '@angular/core';
import { DataService } from './data.service';

export type StaffRole = 'owner' | 'manager' | 'receptionist' | 'stylist';
export interface StaffMe {
  id: string; name: string; email: string | null; phone: string | null; roles: string[]; photo: string | null;
  specialty: string | null; account_status: 'none' | 'pending' | 'approved' | 'declined'; wanted_role: string | null;
  active: boolean; requested_at: string | null; decline_reason: string | null;
}

/** Which roles may open each staff area (route `data.area`). Owner can open everything. */
export const ACCESS: Record<string, StaffRole[]> = {
  dashboard: ['owner', 'manager'],
  bookings: ['owner', 'manager', 'receptionist', 'stylist'],
  checkout: ['owner', 'manager', 'receptionist', 'stylist'],
  sales: ['owner', 'manager', 'receptionist'],
  clients: ['owner', 'manager', 'receptionist'],
  debts: ['owner', 'manager', 'receptionist'],
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
const read = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const write = (v: string | null) => { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

/** Staff sign-in, session and role checks. */
@Injectable({ providedIn: 'root' })
export class StaffAuthService {
  private data = inject(DataService);
  readonly token = signal<string | null>(read());
  readonly me = signal<StaffMe | null>(null);
  readonly signedIn = computed(() => !!this.token());

  /** Main role: owner > manager > receptionist > stylist */
  readonly role = computed<StaffRole | null>(() => {
    const r = this.me()?.roles ?? [];
    return r.includes('owner') ? 'owner' : r.includes('manager') ? 'manager' : r.includes('receptionist') ? 'receptionist' : r.includes('stylist') ? 'stylist' : null;
  });
  readonly firstName = computed(() => (this.me()?.name ?? '').split(' ')[0]);
  readonly roleLabel = computed(() => ({ owner: 'Owner', manager: 'Manager', receptionist: 'Receptionist', stylist: 'Stylist' })[this.role() ?? 'stylist']);

  /** May the signed-in person open this area? */
  can(area: string): boolean {
    const me = this.me();
    if (!me) return false;
    if (me.roles.includes('owner')) return true;
    const allowed = ACCESS[area];
    if (!allowed) return true;
    return allowed.some((r) => me.roles.includes(r));
  }
  /** Where each role lands after signing in */
  home(): string {
    switch (this.role()) {
      case 'owner': case 'manager': return '/dashboard';
      case 'receptionist': return '/desk';
      default: return '/my-day';
    }
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
    write(null);
  }

  async login(email: string, password: string): Promise<'approved' | 'pending'> {
    const r = await this.call<{ status: 'approved' | 'pending'; token?: string; staff: StaffMe }>('staff_login', { p_email: email, p_password: password });
    this.me.set(r.staff);
    if (r.status === 'approved' && r.token) {
      this.token.set(r.token);
      write(r.token);
    }
    return r.status;
  }
  signup(p: { name: string; email: string; phone: string; password: string; role: string; specialty: string; photo: string | null }) {
    return this.call<StaffMe>('staff_signup', { p });
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
    try {
      this.me.set(await this.authed<StaffMe>('staff_me'));
      return true;
    } catch {
      this.clear();
      return false;
    }
  }
  async update(p: Partial<StaffMe> & { password?: string }) {
    this.me.set(await this.authed<StaffMe>('staff_update_me', { p }));
  }
  async logout() {
    const t = this.token();
    this.clear();
    if (t) await this.call('staff_logout', { p_token: t }).catch(() => undefined);
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
