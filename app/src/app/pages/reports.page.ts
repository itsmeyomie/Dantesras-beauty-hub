import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem, IonMenuButton, IonSelect, IonSelectOption, IonTitle,
  IonToolbar, ViewWillEnter,
} from '@ionic/angular';
import { ChartComponent } from '../core/chart.component';
import { DataService } from '../core/data.service';
import { PAY_METHODS, Report, channelLabel } from '../core/models';
import { NotConfiguredComponent } from '../core/not-configured.component';
import { KshPipe, Ui, addDays, startOfDay, ymd } from '../core/ui';

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'custom';
const DOW = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

@Component({
  selector: 'app-reports',
  imports: [FormsModule, DatePipe, KshPipe, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, IonButton, IonItem, IonSelect, IonSelectOption, IonInput, ChartComponent, NotConfiguredComponent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons>
      <ion-title>Reports</ion-title>
      <ion-buttons slot="end"><ion-button (click)="print()">Print / PDF</ion-button></ion-buttons>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="page-wrap">
        <app-not-configured />
        <div class="row">
          <ion-item lines="none" class="field" style="min-width:180px">
            <ion-select label="Period" labelPlacement="stacked" interface="popover" [(ngModel)]="preset" (ionChange)="applyPreset()">
              <ion-select-option value="today">Today</ion-select-option>
              <ion-select-option value="yesterday">Yesterday</ion-select-option>
              <ion-select-option value="week">Last 7 days</ion-select-option>
              <ion-select-option value="month">This month</ion-select-option>
              <ion-select-option value="last_month">Last month</ion-select-option>
              <ion-select-option value="custom">Custom dates</ion-select-option>
            </ion-select>
          </ion-item>
          @if (preset === 'custom') {
            <ion-item lines="none" class="field"><ion-input label="From" labelPlacement="stacked" type="date" [(ngModel)]="from"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-input label="To" labelPlacement="stacked" type="date" [(ngModel)]="to"></ion-input></ion-item>
            <ion-button (click)="load()">Show</ion-button>
          }
        </div>

        @if (r(); as r) {
          <p class="muted small">{{ r.from | date: 'd MMM y' }} – {{ r.to | date: 'd MMM y' }}, compared with the {{ days() }} day(s) before.</p>

          <div class="grid">
            <div class="card stat"><div class="label">Sales</div><div class="value">{{ r.sales_total | ksh }}</div><div class="delta" [class.up]="cmp('sales_total') >= 0" [class.down]="cmp('sales_total') < 0">{{ cmpText('sales_total') }}</div></div>
            <div class="card stat"><div class="label">Clients served</div><div class="value">{{ r.clients_served }}</div><div class="delta" [class.up]="cmp('clients_served') >= 0" [class.down]="cmp('clients_served') < 0">{{ cmpText('clients_served', false) }}</div></div>
            <div class="card stat"><div class="label">Average spend</div><div class="value">{{ r.avg_ticket | ksh }}</div></div>
            <div class="card stat"><div class="label">Services / products</div><div class="value" style="font-size:1.05rem">{{ r.services_total | ksh }}<br />{{ r.products_total | ksh }}</div></div>
          </div>

          <div class="card" style="margin-top:12px">
            <h3>Sales trend</h3>
            <app-chart type="line" [labels]="dailyLabels()" [values]="dailyValues()" ariaLabel="Daily sales trend" />
          </div>

          <div class="grid-2" style="margin-top:12px">
            <div class="card">
              <h3>What the salon keeps (profit view)</h3>
              <table class="t">
                <tr><td>Sales (after discounts)</td><td class="num">{{ r.sales_total | ksh }}</td></tr>
                <tr><td>− Product cost</td><td class="num">{{ r.product_cost | ksh }}</td></tr>
                <tr><td>− Commission</td><td class="num">{{ r.commission | ksh }}</td></tr>
                <tr><td><strong>Salon keeps</strong></td><td class="num"><strong class="maroon">{{ r.sales_total - r.product_cost - r.commission | ksh }}</strong></td></tr>
              </table>
              <p class="muted small">Transport fees ({{ r.transport_fees | ksh }}) go to the stylists and are not counted as sales. Rent and other expenses can be added later.</p>
            </div>
            <div class="card">
              <h3>Money received by method</h3>
              <table class="t">
                @for (m of methods; track m.value) { <tr><td>{{ m.label }}</td><td class="num">{{ (r.by_method[m.value] ?? 0) | ksh }}</td></tr> }
                <tr><td><strong>Salon total</strong></td><td class="num"><strong>{{ r.collected.salon | ksh }}</strong></td></tr>
                <tr><td>School fees</td><td class="num">{{ r.collected.school | ksh }}</td></tr>
              </table>
            </div>
          </div>

          <div class="grid-2" style="margin-top:12px">
            <div class="card">
              <h3>By category</h3>
              <app-chart type="doughnut" [labels]="names(r.by_category)" [values]="totals(r.by_category)" ariaLabel="Sales by category" />
            </div>
            <div class="card">
              <h3>Salon vs home vs walk-in</h3>
              <table class="t">
                @for (c of r.by_channel; track c.channel) { <tr><td>{{ chLabel(c.channel) }} <span class="muted">· {{ c.count }}</span></td><td class="num">{{ c.total | ksh }}</td></tr> }
                @empty { <tr><td class="muted">No sales.</td></tr> }
              </table>
              <h3 style="margin-top:14px">Where clients came from</h3>
              <table class="t">
                @for (s of r.by_source; track s.source) { <tr><td>{{ s.source }} <span class="muted">· {{ s.count }}</span></td><td class="num">{{ s.total | ksh }}</td></tr> }
              </table>
            </div>
          </div>

          <div class="grid-2" style="margin-top:12px">
            <div class="card">
              <h3>Top services</h3>
              <table class="t">
                @for (s of r.top_services; track s.name) { <tr><td>{{ s.name }} <span class="muted">× {{ s.count }}</span></td><td class="num">{{ s.total | ksh }}</td></tr> }
                @empty { <tr><td class="muted">No services sold.</td></tr> }
              </table>
            </div>
            <div class="card">
              <h3>Top products</h3>
              <table class="t">
                @for (s of r.top_products; track s.name) { <tr><td>{{ s.name }} <span class="muted">× {{ s.count }}</span></td><td class="num">{{ s.total | ksh }}</td></tr> }
                @empty { <tr><td class="muted">No products sold.</td></tr> }
              </table>
            </div>
          </div>

          <div class="card" style="margin-top:12px">
            <h3>Staff ranking (owner only)</h3>
            <table class="t">
              <thead><tr><th>#</th><th>Stylist</th><th class="num">Clients</th><th class="num">Sales</th><th class="num">Commission</th></tr></thead>
              @for (s of r.by_staff; track s.id; let i = $index) {
                <tr><td>{{ i + 1 }}</td><td>{{ s.name }}</td><td class="num">{{ s.clients }}</td><td class="num">{{ s.sales | ksh }}</td><td class="num">{{ s.commission | ksh }}</td></tr>
              } @empty { <tr><td colspan="5" class="muted">No work recorded.</td></tr> }
            </table>
          </div>

          <div class="grid-2" style="margin-top:12px">
            <div class="card">
              <h3>Busiest hours</h3>
              <app-chart type="bar" [labels]="hourLabels()" [values]="hourValues()" ariaLabel="Sales by hour of day" />
            </div>
            <div class="card">
              <h3>Busiest days</h3>
              <app-chart type="bar" [labels]="dowLabels()" [values]="dowValues()" ariaLabel="Sales by day of week" />
            </div>
          </div>

          <div class="grid" style="margin-top:12px">
            <div class="card stat"><div class="label">Discounts given</div><div class="value">{{ r.discounts | ksh }}</div></div>
            <div class="card stat"><div class="label">New debt</div><div class="value">{{ r.debt_created | ksh }}</div></div>
            <div class="card stat"><div class="label">Debts outstanding</div><div class="value maroon">{{ r.debts_outstanding | ksh }}</div></div>
            <div class="card stat"><div class="label">No-shows</div><div class="value">{{ r.no_shows }}</div><div class="delta muted">kept deposits {{ r.forfeited_deposits | ksh }}</div></div>
            <div class="card stat"><div class="label">Voided sales</div><div class="value">{{ r.voids }}</div></div>
            <div class="card stat"><div class="label">School balances</div><div class="value">{{ r.school_balances | ksh }}</div></div>
          </div>
        }
      </div>
    </ion-content>
  `,
})
export class ReportsPage implements ViewWillEnter {
  private data = inject(DataService);
  private ui = inject(Ui);
  readonly methods = PAY_METHODS;
  readonly chLabel = channelLabel;
  readonly r = signal<Report | null>(null);
  readonly prev = signal<Report | null>(null);
  preset: Preset = 'week';
  from = '';
  to = '';

  readonly days = computed(() => {
    const r = this.r();
    if (!r) return 0;
    return Math.round((new Date(r.to).getTime() - new Date(r.from).getTime()) / 86400000) + 1;
  });
  readonly dailyLabels = computed(() => this.dateList().map((d) => d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })));
  readonly dailyValues = computed(() => {
    const m = new Map((this.r()?.daily ?? []).map((d) => [d.day, Number(d.total)]));
    return this.dateList().map((d) => m.get(ymd(d)) ?? 0);
  });
  readonly hourLabels = computed(() => (this.r()?.by_hour ?? []).map((h) => `${h.hour}:00`));
  readonly hourValues = computed(() => (this.r()?.by_hour ?? []).map((h) => Number(h.total)));
  readonly dowLabels = computed(() => (this.r()?.by_weekday ?? []).map((h) => DOW[h.dow]));
  readonly dowValues = computed(() => (this.r()?.by_weekday ?? []).map((h) => Number(h.total)));

  ionViewWillEnter() {
    this.applyPreset();
  }
  private dateList(): Date[] {
    const r = this.r();
    if (!r) return [];
    const out: Date[] = [];
    for (let d = new Date(r.from + 'T00:00:00'); ymd(d) <= r.to && out.length < 400; d = addDays(d, 1)) out.push(d);
    return out;
  }
  applyPreset() {
    const today = startOfDay(new Date());
    const set = (a: Date, b: Date) => { this.from = ymd(a); this.to = ymd(b); };
    switch (this.preset) {
      case 'today': set(today, today); break;
      case 'yesterday': set(addDays(today, -1), addDays(today, -1)); break;
      case 'week': set(addDays(today, -6), today); break;
      case 'month': set(new Date(today.getFullYear(), today.getMonth(), 1), today); break;
      case 'last_month': set(new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)); break;
      case 'custom': return;
    }
    this.load();
  }
  async load() {
    if (!this.data.configured || !this.from || !this.to) return;
    if (this.from > this.to) return this.ui.toast('"From" must be before "To"', 'danger');
    const f = new Date(this.from + 'T00:00:00');
    const t = new Date(this.to + 'T00:00:00');
    const len = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
    try {
      const [r, p] = await Promise.all([
        this.data.report(this.from, this.to),
        this.data.report(ymd(addDays(f, -len)), ymd(addDays(f, -1))),
      ]);
      this.r.set(r);
      this.prev.set(p);
    } catch (e) {
      this.ui.error(e);
    }
  }
  cmp(key: 'sales_total' | 'clients_served') {
    return Number(this.r()?.[key] ?? 0) - Number(this.prev()?.[key] ?? 0);
  }
  cmpText(key: 'sales_total' | 'clients_served', money = true) {
    const d = this.cmp(key);
    const p = Number(this.prev()?.[key] ?? 0);
    const pct = p > 0 ? ` (${d >= 0 ? '+' : ''}${Math.round((d / p) * 100)}%)` : '';
    const v = Math.abs(Math.round(d)).toLocaleString('en-KE');
    return `${d >= 0 ? '▲' : '▼'} ${money ? 'KSh ' : ''}${v} vs previous${pct}`;
  }
  names(rows: { name: string }[]) {
    return rows.map((r) => r.name);
  }
  totals(rows: { total: number }[]) {
    return rows.map((r) => Number(r.total));
  }
  print() {
    window.print();
  }
}
