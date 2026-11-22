import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonButtons, IonContent, IonHeader, IonMenuButton, IonTitle, IonToolbar, ViewWillEnter } from '@ionic/angular';
import { ChartComponent } from '../core/chart.component';
import { DataService } from '../core/data.service';
import { Booking, Debt, PAY_METHODS, Report } from '../core/models';
import { NotConfiguredComponent } from '../core/not-configured.component';
import { KshPipe, Ui, addDays, dayRange, startOfDay, ymd } from '../core/ui';

/** Owner's live view: today vs yesterday, cash vs M-Pesa, queue, next bookings, alerts. */
@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, RouterLink, KshPipe, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, IonButton, ChartComponent, NotConfiguredComponent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons>
      <ion-title>Dashboard</ion-title>
      <ion-buttons slot="end"><ion-button (click)="load()">Refresh</ion-button></ion-buttons>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="page-wrap">
        <app-not-configured />
        <div class="row" style="margin-bottom:10px">
          <div><div class="muted small">Today</div><strong style="font-size:1.15rem">{{ today | date: 'EEEE d MMMM y' }}</strong></div>
          <span class="spacer"></span>
          <ion-button size="small" routerLink="/bookings">+ Booking</ion-button>
          <ion-button size="small" fill="outline" routerLink="/checkout">Quick sale</ion-button>
        </div>

        @if (requests() || applications()) {
          <div class="inbox" data-testid="inbox">
            @if (requests()) { <a routerLink="/bookings" [queryParams]="{ tab: 'requests' }"><strong>{{ requests() }}</strong> online booking request{{ requests() === 1 ? '' : 's' }} to answer</a> }
            @if (applications()) { <a routerLink="/school" [queryParams]="{ tab: 'applications' }"><strong>{{ applications() }}</strong> school application{{ applications() === 1 ? '' : 's' }} waiting</a> }
          </div>
        }
        @if (t(); as r) {
          <div class="grid">
            <div class="card stat"><div class="label">Sales today</div><div class="value">{{ r.sales_total | ksh }}</div>
              <div class="delta" [class.up]="delta() >= 0" [class.down]="delta() < 0">{{ deltaText() }}</div></div>
            <div class="card stat"><div class="label">Clients served</div><div class="value">{{ r.clients_served }}</div>
              <div class="delta muted">yesterday {{ y()?.clients_served ?? 0 }}</div></div>
            <div class="card stat"><div class="label">Average spend</div><div class="value">{{ r.avg_ticket | ksh }}</div></div>
            <div class="card stat"><div class="label">Money received</div><div class="value">{{ r.collected.salon | ksh }}</div>
              <div class="delta muted">incl. deposits & debt payments</div></div>
          </div>

          <div class="grid-2" style="margin-top:12px">
            <div class="card">
              <h3>Cash vs M-Pesa today</h3>
              <table class="t">
                @for (m of methods; track m.value) {
                  <tr><td>{{ m.label }}</td><td class="num">{{ (r.by_method[m.value] ?? 0) | ksh }}</td></tr>
                }
                <tr><td><strong>School fees</strong></td><td class="num"><strong>{{ r.collected.school | ksh }}</strong></td></tr>
              </table>
            </div>
            <div class="card">
              <h3>Right now</h3>
              <table class="t">
                <tr><td>Walk-ins waiting</td><td class="num"><a routerLink="/bookings">{{ waiting() }}</a></td></tr>
                <tr><td>Being served</td><td class="num">{{ inProgress() }}</td></tr>
                <tr><td>On home service today</td><td class="num">{{ homeToday() }}</td></tr>
                <tr><td>Bookings still to come</td><td class="num">{{ upcoming().length }}</td></tr>
                <tr><td>Debts outstanding</td><td class="num"><a routerLink="/debts">{{ r.debts_outstanding | ksh }}</a></td></tr>
              </table>
            </div>
          </div>

          @if (alerts().length) {
            <div class="card" style="margin-top:12px;border-color:#f0d58a;background:#fffaf0">
              <h3>Alerts</h3>
              @for (a of alerts(); track a) { <div class="small" style="padding:3px 0">• {{ a }}</div> }
            </div>
          }

          <div class="grid-2" style="margin-top:12px">
            <div class="card">
              <h3>Next bookings</h3>
              @for (b of upcoming().slice(0, 6); track b.id) {
                <div class="row small" style="padding:5px 0;border-bottom:1px solid var(--app-border)">
                  <strong class="maroon">{{ b.scheduled_at | date: 'HH:mm' }}</strong>
                  <span>{{ b.clients?.name ?? b.guest_name }}</span>
                  <span class="pill {{ b.channel }}">{{ b.channel }}</span>
                  <span class="spacer"></span><span class="pill {{ b.status }}">{{ b.status }}</span>
                </div>
              } @empty { <div class="muted small">No more bookings today.</div> }
            </div>
            <div class="card">
              <h3>Last 7 days</h3>
              <app-chart type="bar" [labels]="weekLabels()" [values]="weekValues()" ariaLabel="Sales for the last 7 days" [height]="200" />
            </div>
          </div>

          <div class="grid-2" style="margin-top:12px">
            <div class="card">
              <h3>Top services today</h3>
              <table class="t">
                @for (s of r.top_services.slice(0, 5); track s.name) { <tr><td>{{ s.name }} <span class="muted">× {{ s.count }}</span></td><td class="num">{{ s.total | ksh }}</td></tr> }
                @empty { <tr><td class="muted">No sales yet today.</td></tr> }
              </table>
            </div>
            <div class="card">
              <h3>Stylists today</h3>
              <table class="t">
                @for (s of r.by_staff; track s.id) { <tr><td>{{ s.name }} <span class="muted">· {{ s.clients }} clients</span></td><td class="num">{{ s.sales | ksh }}</td></tr> }
                @empty { <tr><td class="muted">No work recorded yet today.</td></tr> }
              </table>
            </div>
          </div>
        }
      </div>
    </ion-content>
  `,
})
export class DashboardPage implements ViewWillEnter {
  private data = inject(DataService);
  private ui = inject(Ui);
  readonly today = new Date();
  readonly methods = PAY_METHODS;
  readonly t = signal<Report | null>(null);
  readonly y = signal<Report | null>(null);
  readonly week = signal<Report | null>(null);
  readonly active = signal<Booking[]>([]);
  readonly debts = signal<Debt[]>([]);
  readonly requests = signal(0);
  readonly applications = signal(0);

  readonly delta = computed(() => Number(this.t()?.sales_total ?? 0) - Number(this.y()?.sales_total ?? 0));
  readonly waiting = computed(() => this.active().filter((b) => b.channel === 'walkin' && b.status === 'waiting').length);
  readonly inProgress = computed(() => this.active().filter((b) => b.status === 'in_progress').length);
  readonly homeToday = computed(() => this.active().filter((b) => b.channel === 'home' && !['cancelled', 'no_show'].includes(b.status)).length);
  readonly upcoming = computed(() =>
    this.active().filter((b) => b.channel !== 'walkin' && ['pending', 'booked'].includes(b.status) && b.scheduled_at && new Date(b.scheduled_at).getTime() > Date.now() - 30 * 60000),
  );
  readonly weekLabels = computed(() => this.days().map((d) => d.toLocaleDateString('en-KE', { weekday: 'short' })));
  readonly weekValues = computed(() => {
    const map = new Map((this.week()?.daily ?? []).map((d) => [d.day, Number(d.total)]));
    return this.days().map((d) => map.get(ymd(d)) ?? 0);
  });
  readonly alerts = computed(() => {
    const out: string[] = [];
    const late = Number(this.data.setting('late_minutes', 20));
    for (const b of this.active()) {
      if (b.scheduled_at && ['pending', 'booked'].includes(b.status) && Date.now() > new Date(b.scheduled_at).getTime() + late * 60000) {
        out.push(`${b.clients?.name ?? b.guest_name} is over ${late} min late – reschedule`);
      }
      if (b.status === 'pending' && b.channel !== 'walkin') out.push(`${b.clients?.name ?? b.guest_name}'s booking has no deposit yet`);
    }
    for (const p of this.data.products()) {
      if (p.status === 'active' && Number(p.stock_qty) <= Number(p.low_stock)) out.push(`Low stock: ${p.name} (${p.stock_qty} left)`);
      if (p.status === 'pending') out.push(`Product waiting for approval: ${p.name}`);
    }
    const old = this.debts().filter((d) => d.days_owed > 30).length;
    if (old) out.push(`${old} debt(s) older than 30 days`);
    return out;
  });

  private days() {
    const s = startOfDay(new Date());
    return Array.from({ length: 7 }, (_, i) => addDays(s, i - 6));
  }
  deltaText() {
    const d = this.delta();
    const y = Number(this.y()?.sales_total ?? 0);
    const pct = y > 0 ? ` (${d >= 0 ? '+' : ''}${Math.round((d / y) * 100)}%)` : '';
    return `${d >= 0 ? '▲' : '▼'} KSh ${Math.abs(Math.round(d)).toLocaleString('en-KE')} vs yesterday${pct}`;
  }

  ionViewWillEnter() {
    this.load();
  }
  async load() {
    if (!this.data.configured) return;
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
      this.requests.set(rq.length);
      this.applications.set(ap.length);
      this.t.set(t);
      this.y.set(y);
      this.week.set(w);
      this.active.set(a);
      this.debts.set(d);
    } catch (e) {
      this.ui.error(e);
    }
  }
}
