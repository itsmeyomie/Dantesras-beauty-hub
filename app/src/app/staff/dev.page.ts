import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonContent, IonRefresher, IonRefresherContent, ViewWillEnter } from '@ionic/angular';
import { AppControlService, AppStatus } from '../core/app-control.service';
import { StaffAuthService } from '../core/staff-auth.service';
import { Ui } from '../core/ui';
import { StaffHeaderComponent } from './staff-header.component';

interface Control extends AppStatus { updated_at: string; updated_by: string | null; }
interface DevStaff { id: string; name: string; email: string | null; roles: string[]; account_status: string; active: boolean; last_login: string | null; developer: boolean; sessions: number; }
interface DevClient { id: string; name: string; email: string | null; phone: string | null; last_seen: string | null; sessions: number; }
interface Overview {
  control: Control;
  counts: Record<string, number | string>;
  errors: { id: number; at: string; app: string | null; version: string | null; url: string | null; message: string; detail: string | null }[];
  push_failures: { at: string; title: string; error: string }[];
  mpesa_failures: { at: string; purpose: string; amount: number; status: string; reason: string | null }[];
  staff: DevStaff[];
}

const COUNTS: [string, string][] = [
  ['staff', 'Staff (active)'], ['staff_pending', 'Staff waiting'], ['clients', 'Clients'], ['bookings_today', 'Bookings today'],
  ['bookings_7d', 'Bookings · 7 days'], ['sales_7d', 'Sales · 7 days'], ['staff_sessions', 'Staff signed in'], ['client_sessions', 'Clients signed in'],
  ['phones', 'Phones (push)'], ['errors_24h', 'App errors · 24 h'], ['push_failed_7d', 'Push failed · 7 days'], ['push_waiting', 'Push stuck'],
  ['mpesa_failed_7d', 'M-Pesa failed · 7 days'], ['db_size', 'Database size'],
];
const BAD = ['errors_24h', 'push_failed_7d', 'push_waiting', 'mpesa_failed_7d'];

/** Developer panel: only people in the private developers list (checked by the database). */
@Component({
  selector: 'app-dev',
  host: { class: 'portal' },
  imports: [DatePipe, FormsModule, IonContent, IonRefresher, IonRefresherContent, StaffHeaderComponent],
  template: `
    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="refresh($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>
      <div class="p-wrap">
        <app-staff-header />
        <h1 class="p-display" style="margin:14px 0 4px"><strong>Developer</strong> panel</h1>
        <p class="p-muted p-small" style="margin:0 0 14px">Only you can see this. Changes take effect on every phone within a minute.</p>

        @if (o(); as o) {
          <!-- ---------- service switch ---------- -->
          <section class="p-card dv" data-testid="dev-service">
            <div class="p-row" style="align-items:center">
              <div class="p-spacer"><div class="p-kicker">Service</div>
                <b style="font-size:1.15rem">{{ o.control.paused ? 'Paused for everyone' : 'Running' }}</b></div>
              <span class="p-badge {{ o.control.paused ? 'bad' : 'ok' }}" data-testid="dev-service-state">{{ o.control.paused ? 'PAUSED' : 'ON' }}</span>
            </div>
            <label class="dv-l">Message people see while paused
              <textarea class="p-input" rows="2" [(ngModel)]="pauseMsg" data-testid="dev-pause-msg"></textarea></label>
            @if (o.control.paused) {
              <button class="p-btn block" (click)="setPaused(false)" [disabled]="busy()" data-testid="dev-resume">Resume service</button>
            } @else {
              <button class="p-btn block dv-danger" (click)="setPaused(true)" [disabled]="busy()" data-testid="dev-pause">Pause service</button>
            }
            <p class="p-muted p-small" style="margin:8px 0 0">Pausing blocks every staff member and client (also old app versions). Nothing is deleted; Resume brings everything back.
              @if (o.control.updated_by) { Last change {{ o.control.updated_at | date: 'd MMM HH:mm' }} by {{ o.control.updated_by }}. }</p>
          </section>

          <!-- ---------- maintenance, banner, version ---------- -->
          <section class="p-card dv" data-testid="dev-messages">
            <div class="p-kicker">Messages & updates</div>
            <label class="p-check"><input type="checkbox" [(ngModel)]="maint" data-testid="dev-maint" />
              <span><b>Maintenance screen</b><small>Everyone except you sees a "we are updating" screen (nothing is blocked in the database)</small></span></label>
            <textarea class="p-input" rows="2" [(ngModel)]="maintMsg" data-testid="dev-maint-msg"></textarea>
            <label class="dv-l">Banner at the top of the app (empty = none)
              <input class="p-input" [(ngModel)]="banner" placeholder="e.g. Closed on Monday 1 Dec" data-testid="dev-banner" /></label>
            <label class="dv-l">Minimum Android version (versionCode) – older apps must update
              <input class="p-input" type="number" min="0" [(ngModel)]="minVersion" data-testid="dev-min-version" /></label>
            <p class="p-muted p-small" style="margin:0 0 10px">This phone: {{ ctl.version() }}. 0 = no forced update.</p>
            <button class="p-btn block" (click)="saveMessages()" [disabled]="busy()" data-testid="dev-save-messages">Save</button>
          </section>

          <!-- ---------- health ---------- -->
          <div class="p-h2" style="margin-top:20px">Health <a (click)="load()">Refresh</a></div>
          <div class="dv-grid" data-testid="dev-counts">
            @for (c of counts; track c[0]) {
              <div class="p-card dv-n" [class.dv-bad]="isBad(c[0])"><small>{{ c[1] }}</small><b>{{ o.counts[c[0]] }}</b></div>
            }
          </div>

          <div class="p-h2">App errors <a (click)="clearErrors()" data-testid="dev-clear-errors">Clear</a></div>
          <div class="p-card" style="padding:6px 14px" data-testid="dev-errors">
            @for (e of o.errors; track e.id) {
              <div class="dv-item"><b>{{ e.message }}</b>
                <div class="p-muted p-small">{{ e.at | date: 'd MMM HH:mm' }} · {{ e.app ?? '?' }} · {{ e.version ?? '' }} · {{ e.url ?? '' }}</div></div>
            } @empty { <div class="p-empty">No errors reported.</div> }
          </div>

          @if (o.push_failures.length) {
            <div class="p-h2">Push notifications that failed</div>
            <div class="p-card" style="padding:6px 14px">
              @for (p of o.push_failures; track $index) {
                <div class="dv-item"><b>{{ p.title }}</b><div class="p-muted p-small">{{ p.at | date: 'd MMM HH:mm' }} · {{ p.error }}</div></div>
              }
            </div>
          }
          @if (o.mpesa_failures.length) {
            <div class="p-h2">M-Pesa prompts that failed</div>
            <div class="p-card" style="padding:6px 14px">
              @for (m of o.mpesa_failures; track $index) {
                <div class="dv-item"><b>{{ m.purpose }} · KSh {{ m.amount }} · {{ m.status }}</b><div class="p-muted p-small">{{ m.at | date: 'd MMM HH:mm' }} · {{ m.reason ?? '' }}</div></div>
              }
            </div>
          }

          <!-- ---------- users ---------- -->
          <div class="p-h2">Staff accounts</div>
          <div class="p-card" style="padding:6px 14px" data-testid="dev-staff">
            @for (s of o.staff; track s.id) {
              <div class="dv-item" data-testid="dev-staff-row" [style.opacity]="s.active ? 1 : 0.5">
                <div class="p-row" style="align-items:flex-start;gap:8px">
                  <div class="p-spacer" style="min-width:0"><b>{{ s.name }}</b> @if (s.developer) { <span class="p-badge info">dev</span> }
                    <div class="p-muted p-small dv-wrap">{{ s.email ?? 'no email' }} · {{ s.roles.join(', ') }} · {{ s.account_status }}</div>
                    <div class="p-muted p-small">Last sign-in {{ s.last_login ? (s.last_login | date: 'd MMM HH:mm') : 'never' }} · {{ s.sessions }} signed-in device{{ s.sessions === 1 ? '' : 's' }}</div></div>
                </div>
                <div class="p-row" style="gap:14px;margin-top:6px">
                  <button class="p-link" (click)="signOutStaff(s)" [disabled]="!s.sessions" data-testid="dev-staff-signout">Sign out everywhere</button>
                  @if (!s.developer) {
                    <button class="p-link" [style.color]="s.active ? '#9b1c1c' : null" (click)="toggleStaff(s)" data-testid="dev-staff-toggle">{{ s.active ? 'Switch off' : 'Switch on' }}</button>
                  }
                </div>
              </div>
            }
          </div>

          <div class="p-h2">Clients</div>
          <input class="p-input" placeholder="Search name, email or phone" [(ngModel)]="q" (ngModelChange)="searchClients()" data-testid="dev-client-search" />
          <div class="p-card" style="padding:6px 14px;margin-top:8px" data-testid="dev-clients">
            @for (c of clients(); track c.id) {
              <div class="dv-item p-row" style="align-items:center;gap:8px" data-testid="dev-client-row">
                <div class="p-spacer" style="min-width:0"><b>{{ c.name }}</b>
                  <div class="p-muted p-small dv-wrap">{{ c.email ?? c.phone ?? '' }} · last seen {{ c.last_seen ? (c.last_seen | date: 'd MMM HH:mm') : 'never' }}</div></div>
                <button class="p-link" (click)="signOutClient(c)" [disabled]="!c.sessions" data-testid="dev-client-signout">Sign out</button>
              </div>
            } @empty { <div class="p-empty">No clients found.</div> }
          </div>
        } @else if (denied()) {
          <div class="p-empty" data-testid="dev-denied">{{ denied() }}</div>
        } @else {
          @for (i of [1, 2, 3]; track i) { <div class="p-skeleton" style="height:90px;margin-bottom:10px"></div> }
        }
      </div>
    </ion-content>
  `,
  styles: `
    .dv { padding: 16px; margin-bottom: 12px; }
    .dv-l { display: block; font-size: .8rem; color: #8a7f78; margin: 10px 0; }
    .dv-l .p-input, .dv textarea { margin-top: 4px; width: 100%; box-sizing: border-box; }
    .dv textarea { font: inherit; resize: vertical; margin-bottom: 10px; }
    .dv-danger { background: #9b1c1c !important; color: #fff !important; }
    .dv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
    .dv-n { padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
    .dv-n small { color: #8a7f78; font-size: .72rem; }
    .dv-n b { font-size: 1.2rem; }
    .dv-bad b { color: #9b1c1c; }
    .dv-item { padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,.06); overflow-wrap: anywhere; }
    .dv-item:last-child { border-bottom: 0; }
    .dv-wrap { overflow-wrap: anywhere; }
  `,
})
export class DevPage implements ViewWillEnter {
  private auth = inject(StaffAuthService);
  private ui = inject(Ui);
  readonly ctl = inject(AppControlService);
  readonly o = signal<Overview | null>(null);
  readonly clients = signal<DevClient[]>([]);
  readonly denied = signal('');
  readonly busy = signal(false);
  readonly counts = COUNTS;
  pauseMsg = '';
  maint = false;
  maintMsg = '';
  banner = '';
  minVersion = 0;
  q = '';
  private searchTimer?: ReturnType<typeof setTimeout>;
  readonly isPaused = computed(() => !!this.o()?.control.paused);

  ionViewWillEnter() {
    void this.load();
    void this.loadClients();
  }
  async refresh(ev: CustomEvent) {
    await Promise.all([this.load(), this.loadClients()]);
    (ev.target as HTMLIonRefresherElement).complete();
  }
  async load() {
    try {
      const o = await this.auth.dev<Overview>('dev_overview');
      this.o.set(o);
      const c = o.control;
      this.pauseMsg = c.pause_message;
      this.maint = c.maintenance;
      this.maintMsg = c.maintenance_message;
      this.banner = c.banner ?? '';
      this.minVersion = c.min_version_code;
    } catch (e) {
      this.denied.set(e instanceof Error ? e.message : String(e));
    }
  }
  async loadClients() {
    try {
      this.clients.set(await this.auth.dev<DevClient[]>('dev_clients', { p_q: this.q }));
    } catch { /* shown by load() */ }
  }
  searchClients() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.loadClients(), 300);
  }
  isBad(k: string) {
    const v = this.o()?.counts[k];
    return BAD.includes(k) && Number(v) > 0;
  }
  private async control(p: Record<string, unknown>, done: string) {
    this.busy.set(true);
    try {
      await this.auth.dev('dev_set_control', { p });
      this.ui.toast(done);
      await Promise.all([this.load(), this.ctl.refresh()]);
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.busy.set(false);
    }
  }
  async setPaused(on: boolean) {
    if (on && !(await this.ui.confirm('Pause the service?', 'Every staff member and client is blocked until you press Resume. Nothing is deleted.', 'Pause'))) return;
    await this.control({ paused: on, pause_message: this.pauseMsg }, on ? 'Service paused' : 'Service running again');
  }
  async saveMessages() {
    await this.control({ maintenance: this.maint, maintenance_message: this.maintMsg, banner: this.banner, min_version_code: Number(this.minVersion) || 0 }, 'Saved');
  }
  async clearErrors() {
    if (!(await this.ui.confirm('Clear app errors?', 'The list of reported errors is emptied.', 'Clear'))) return;
    try { await this.auth.dev('dev_clear_errors'); await this.load(); } catch (e) { this.ui.error(e); }
  }
  async signOutStaff(s: DevStaff) {
    if (!(await this.ui.confirm(`Sign out ${s.name}?`, 'They are signed out on every phone and must sign in again.', 'Sign out'))) return;
    try {
      const n = await this.auth.dev<number>('dev_staff_sign_out', { p_id: s.id });
      this.ui.toast(`${s.name} signed out (${n})`);
      await this.load();
    } catch (e) { this.ui.error(e); }
  }
  async toggleStaff(s: DevStaff) {
    if (s.active && !(await this.ui.confirm(`Switch off ${s.name}?`, 'They are signed out and cannot sign in until switched on again.', 'Switch off'))) return;
    try {
      await this.auth.dev('dev_staff_active', { p_id: s.id, p_active: !s.active });
      this.ui.toast(s.active ? `${s.name} switched off` : `${s.name} switched on`);
      await this.load();
    } catch (e) { this.ui.error(e); }
  }
  async signOutClient(c: DevClient) {
    try {
      await this.auth.dev<number>('dev_client_sign_out', { p_id: c.id });
      this.ui.toast(`${c.name} signed out`);
      await this.loadClients();
    } catch (e) { this.ui.error(e); }
  }
}
