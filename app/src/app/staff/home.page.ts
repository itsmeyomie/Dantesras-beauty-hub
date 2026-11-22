import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonRefresher, IonRefresherContent, ViewWillEnter } from '@ionic/angular';
import { DataService } from '../core/data.service';
import { Booking, Debt, Report } from '../core/models';
import { StaffAuthService } from '../core/staff-auth.service';
import { KshPipe, Ui, addDays, dayRange, ksh, startOfDay, ymd } from '../core/ui';
import { StaffHeaderComponent } from './staff-header.component';

interface Need { text: string; url: string; query?: Record<string, string>; action: string; strong?: boolean; }

/** Owner / manager home: money today, live floor, things to act on, the week. */
@Component({
  selector: 'app-staff-home',
  host: { class: 'portal' },
  imports: [DatePipe, RouterLink, KshPipe, IonContent, IonRefresher, IonRefresherContent, StaffHeaderComponent],
  template: `
    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="refresh($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>
      <div class="p-wrap">
        <app-staff-header />
        <p class="p-hey">{{ greeting() }} <b>{{ auth.firstName() }}</b>,</p>
        <h1 class="p-display" data-testid="home-title">{{ owner() ? 'Your' : 'Today at' }} <strong>{{ owner() ? 'business' : 'the salon' }}</strong></h1>
        <div class="p-chips" style="margin-top:14px">
          <a class="p-chip on" routerLink="/dashboard">Today</a>
          <a class="p-chip" routerLink="/bookings">+ Booking</a>
          <a class="p-chip" routerLink="/checkout">Quick sale</a>
          <a class="p-chip" routerLink="/reports">Reports</a>
        </div>

        @if (t(); as r) {
          <section class="p-feature" style="min-height:0;padding:18px 20px" data-testid="money-today">
            <div style="position:relative">
              <div class="p-kicker" style="color:var(--p-gold-soft)">{{ owner() ? 'Money in today' : 'Sales today' }}</div>
              <div style="font:600 2rem 'Playfair Display',serif;color:var(--p-gold-soft);margin:2px 0">{{ (owner() ? r.collected.salon + r.collected.school : r.sales_total) | ksh }}</div>
              <div class="p-small" style="opacity:.88">
                @if (owner()) { Salon {{ r.collected.salon | ksh }} · School fees {{ r.collected.school | ksh }} · }
                {{ deltaText() }}
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
                @for (m of methods(); track m.label) { <span class="p-badge" style="background:rgba(255,255,255,.16);color:#fff">{{ m.label }} {{ m.value | ksh }}</span> }
                @if (owner()) { <span class="p-badge" style="background:rgba(255,255,255,.16);color:#fff">Commission {{ r.commission | ksh }}</span> }
              </div>
            </div>
          </section>
          <div class="p-stats">
            <div class="p-stat"><small>Clients</small><b>{{ r.clients_served }}</b></div>
            <div class="p-stat"><small>Average</small><b>{{ r.avg_ticket | ksh }}</b></div>
            <div class="p-stat"><small>Waiting</small><b>{{ waiting() }}</b></div>
            <div class="p-stat"><small>In chair</small><b>{{ inChair() }}</b></div>
          </div>
        } @else {
          <div class="p-skeleton" style="height:170px;border-radius:26px;margin-top:14px"></div>
        }

        @if (needs().length) {
          <div class="p-card" data-testid="inbox">
            <div class="p-kicker">{{ owner() ? 'Needs the owner' : 'Needs you' }}</div>
            @for (n of needs(); track n.text) {
              <div class="p-list-line" style="align-items:center">
                <span [style.font-weight]="n.strong ? 600 : 400">{{ n.text }}</span>
                <a class="p-btn small" [class.ghost]="!n.strong" [routerLink]="n.url" [queryParams]="n.query ?? null">{{ n.action }}</a>
              </div>
            }
          </div>
        }

        <div class="p-card">
          <div class="p-kicker">Last 7 days</div>
          <div class="p-bars">@for (d of week(); track d.key) { <i [style.height.%]="d.pct" [class.l]="!d.value" [title]="fmt(d.value)"></i> }</div>
          <div class="p-bar-days">@for (d of week(); track d.key) { <span>{{ d.label }}</span> }</div>
        </div>

        <div class="p-h2">Coming up today <a routerLink="/bookings">All bookings</a></div>
        @for (b of upcoming(); track b.id) {
          <div class="p-card p-row">
            <span class="p-t">{{ b.scheduled_at | date: 'HH:mm' }}</span>
            <div class="p-spacer"><b>{{ b.clients?.name ?? b.guest_name }}</b>
              <div class="p-muted p-small">{{ staffNames(b) || 'No stylist yet' }}{{ b.channel === 'home' ? ' · home service' : '' }}</div></div>
            <span class="p-badge {{ b.status === 'booked' ? 'ok' : 'wait' }}">{{ b.status === 'booked' ? 'Booked' : 'No deposit' }}</span>
          </div>
        } @empty { <div class="p-empty">No more bookings today.</div> }
      </div>
    </ion-content>
  `,
})
export class StaffHomePage implements ViewWillEnter {
  private data = inject(DataService);
  readonly auth = inject(StaffAuthService);
  private ui = inject(Ui);
  readonly t = signal<Report | null>(null);
  readonly y = signal<Report | null>(null);
  readonly wk = signal<Report | null>(null);
  readonly active = signal<Booking[]>([]);
  readonly debts = signal<Debt[]>([]);
  readonly requests = signal(0);
  readonly applications = signal(0);
  readonly staffRequests = signal(0);
  readonly owner = computed(() => this.auth.role() === 'owner');
  fmt = ksh;

  readonly greeting = computed(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  });
  readonly waiting = computed(() => this.active().filter((b) => b.channel === 'walkin' && b.status === 'waiting').length);
  readonly inChair = computed(() => this.active().filter((b) => b.status === 'in_progress').length);
  readonly upcoming = computed(() => this.active().filter((b) => b.channel !== 'walkin' && ['pending', 'booked'].includes(b.status) && b.scheduled_at
    && new Date(b.scheduled_at).getTime() > Date.now() - 30 * 60000));
  readonly methods = computed(() => {
    const by = this.t()?.by_method ?? {};
    const mpesa = Object.entries(by).filter(([k]) => k.startsWith('mpesa')).reduce((a, [, v]) => a + Number(v), 0);
    const out = [{ label: 'M-Pesa', value: mpesa }, { label: 'Cash', value: Number(by['cash'] ?? 0) }];
    return out.filter((m) => m.value > 0);
  });
  readonly deltaText = computed(() => {
    const d = Number(this.t()?.sales_total ?? 0) - Number(this.y()?.sales_total ?? 0);
    return `${d >= 0 ? '▲' : '▼'} ${ksh(Math.abs(d))} vs yesterday`;
  });
  readonly needs = computed<Need[]>(() => {
    const out: Need[] = [];
    if (this.owner() && this.staffRequests()) out.push({ text: `${this.staffRequests()} staff account request${this.staffRequests() === 1 ? '' : 's'}`, url: '/staff-requests', action: 'Approve', strong: true });
    if (this.requests()) out.push({ text: `${this.requests()} online booking request${this.requests() === 1 ? '' : 's'} to answer`, url: '/bookings', query: { tab: 'requests' }, action: 'Open', strong: true });
    if (this.applications()) out.push({ text: `${this.applications()} school application${this.applications() === 1 ? '' : 's'} waiting`, url: '/school', query: { tab: 'applications' }, action: 'Open' });
    const late = Number(this.data.setting('late_minutes', 20));
    const lateOnes = this.active().filter((b) => b.scheduled_at && ['pending', 'booked'].includes(b.status) && Date.now() > new Date(b.scheduled_at).getTime() + late * 60000);
    if (lateOnes.length) out.push({ text: `${lateOnes.length} client${lateOnes.length === 1 ? '' : 's'} over ${late} min late`, url: '/bookings', action: 'Reschedule' });
    for (const p of this.data.products()) {
      if (p.status === 'active' && Number(p.stock_qty) <= Number(p.low_stock)) out.push({ text: `Low stock: ${p.name} (${p.stock_qty})`, url: '/products', action: 'Stock' });
      if (p.status === 'pending') out.push({ text: `Product to approve: ${p.name}`, url: '/products', action: 'Review' });
    }
    const old = this.debts().filter((d) => d.days_owed > 30).length;
    if (old) out.push({ text: `${old} debt${old === 1 ? '' : 's'} older than 30 days`, url: '/debts', action: 'Collect' });
    return out.slice(0, 7);
  });
  readonly week = computed(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(startOfDay(new Date()), i - 6));
    const map = new Map((this.wk()?.daily ?? []).map((d) => [d.day, Number(d.total)]));
    const vals = days.map((d) => map.get(ymd(d)) ?? 0);
    const max = Math.max(1, ...vals);
    return days.map((d, i) => ({ key: ymd(d), value: vals[i], pct: Math.max(8, Math.round((vals[i] / max) * 100)),
      label: i === 6 ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short' }) }));
  });

  staffNames(b: Booking) {
    return (b.booking_staff ?? []).map((s) => s.staff?.name).filter(Boolean).join(' & ');
  }
  ionViewWillEnter() {
    void this.load();
  }
  async refresh(ev: CustomEvent) {
    await this.load();
    (ev.target as HTMLIonRefresherElement).complete();
  }
  async load() {
    const today = startOfDay(new Date());
    const [from, to] = dayRange(today);
    try {
      const [t, y, w, a, d, rq, ap] = await Promise.all([
        this.data.report(ymd(today), ymd(today)),
        this.data.report(ymd(addDays(today, -1)), ymd(addDays(today, -1))),
        this.data.report(ymd(addDays(today, -6)), ymd(today)),
        this.data.activeToday(from, to),
        this.data.debts(),
        this.data.onlineRequests(),
        this.data.courseApplications(),
      ]);
      this.t.set(t); this.y.set(y); this.wk.set(w); this.active.set(a); this.debts.set(d);
      this.requests.set(rq.length);
      this.applications.set(ap.length);
      if (this.owner()) this.staffRequests.set((await this.auth.requests()).filter((s) => s.account_status === 'pending').length);
    } catch (e) {
      this.ui.error(e);
    }
  }
}

