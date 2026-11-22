import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { IonContent, ViewWillEnter } from '@ionic/angular';
import { DataService } from '../core/data.service';
import { StaffAuthService } from '../core/staff-auth.service';
import { KshPipe, Ui, addDays, startOfDay, ymd } from '../core/ui';
import { StaffHeaderComponent } from './staff-header.component';

type Range = 'today' | 'week' | 'month';
type Earning = Awaited<ReturnType<DataService['staffEarnings']>>[number];
type Payout = Awaited<ReturnType<DataService['staffPayouts']>>[number];

/** Stylist: commission, transport fees, payouts and what is still owed. */
@Component({
  selector: 'app-my-earnings',
  host: { class: 'portal' },
  imports: [DatePipe, KshPipe, IonContent, StaffHeaderComponent],
  template: `
    <ion-content>
      <div class="p-wrap">
        <app-staff-header />
        <h1 class="p-display" style="margin-top:14px">My <strong>earnings</strong></h1>
        <div class="p-chips" style="margin-top:14px">
          <button class="p-chip" [class.on]="range() === 'today'" (click)="setRange('today')">Today</button>
          <button class="p-chip" [class.on]="range() === 'week'" (click)="setRange('week')">This week</button>
          <button class="p-chip" [class.on]="range() === 'month'" (click)="setRange('month')">This month</button>
        </div>
        <section class="p-feature" style="min-height:0;padding:18px 20px" data-testid="earnings-hero">
          <div style="position:relative">
            <div class="p-kicker" style="color:var(--p-gold-soft)">Commission {{ rangeLabel() }}</div>
            <div style="font:600 2rem 'Playfair Display',serif;color:var(--p-gold-soft);margin:2px 0" data-testid="commission">{{ commission() | ksh }}</div>
            <div class="p-small" style="opacity:.88">{{ clients() }} client{{ clients() === 1 ? '' : 's' }} · {{ services() | ksh }} in services</div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:14px">
              <div style="flex:1"><div class="p-small" style="opacity:.75">Unpaid balance</div>
                <b style="font:600 1.1rem 'Playfair Display',serif" data-testid="unpaid">{{ unpaid() | ksh }}</b></div>
              <span class="p-pill-white">{{ schedule() }} payout</span>
            </div>
          </div>
        </section>
        <div class="p-card">
          <div class="p-kicker">Last 7 days</div>
          <div class="p-bars">@for (d of week(); track d.key) { <i [style.height.%]="d.pct" [class.l]="!d.value" [title]="(d.value | ksh)"></i> }</div>
          <div class="p-bar-days">@for (d of week(); track d.key) { <span>{{ d.label }}</span> }</div>
        </div>
        <div class="p-card">
          <div class="p-list-line"><span>Commission</span><b>{{ commission() | ksh }}</b></div>
          <div class="p-list-line"><span>Transport (home jobs)</span><b>{{ transport() | ksh }}</b></div>
          <div class="p-list-line"><span>Paid to you {{ rangeLabel() }}</span><b>− {{ paidOut() | ksh }}</b></div>
          <div class="p-list-line total"><span>Still to be paid (all time)</span><span style="color:var(--p-maroon)">{{ unpaid() | ksh }}</span></div>
        </div>
        <div class="p-h2">Payouts</div>
        @for (p of payouts().slice(0, 6); track p.id) {
          <div class="p-card p-row"><div class="p-spacer"><b>{{ p.kind === 'advance' ? 'Advance' : p.kind === 'bonus' ? 'Bonus' : 'Payout' }}</b>
            <div class="p-muted p-small">{{ p.paid_at | date: 'EEE d MMM' }} · {{ p.method }}{{ p.note ? ' · ' + p.note : '' }}</div></div>
            <b>{{ p.amount | ksh }}</b></div>
        } @empty { <div class="p-empty">No payouts yet.</div> }
      </div>
    </ion-content>
  `,
})
export class MyEarningsPage implements ViewWillEnter {
  private data = inject(DataService);
  private auth = inject(StaffAuthService);
  private ui = inject(Ui);
  readonly range = signal<Range>('week');
  readonly rows = signal<Earning[]>([]);
  readonly last7 = signal<Earning[]>([]);
  readonly payouts = signal<Payout[]>([]);
  readonly unpaid = signal(0);
  readonly schedule = signal('Weekly');

  readonly rangeLabel = computed(() => ({ today: 'today', week: 'this week', month: 'this month' })[this.range()]);
  readonly commission = computed(() => this.rows().filter((r) => r.kind === 'commission').reduce((a, r) => a + Number(r.amount), 0));
  readonly transport = computed(() => this.rows().filter((r) => r.kind === 'transport').reduce((a, r) => a + Number(r.amount), 0));
  readonly clients = computed(() => new Set(this.rows().filter((r) => r.kind === 'commission').map((r) => r.sales?.sold_at + (r.sales?.client_id ?? r.sales?.guest_name ?? ''))).size);
  readonly services = computed(() => [...new Map(this.rows().filter((r) => r.kind === 'commission').map((r) => [r.sales?.sold_at, Number(r.sales?.total ?? 0)])).values()].reduce((a, v) => a + v, 0));
  readonly paidOut = computed(() => {
    const [from] = this.bounds();
    return this.payouts().filter((p) => p.paid_at >= from && p.kind !== 'bonus').reduce((a, p) => a + Number(p.amount), 0);
  });
  readonly week = computed(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(startOfDay(new Date()), i - 6));
    const totals = days.map((d) => this.last7().filter((r) => r.kind === 'commission' && ymd(new Date(r.created_at)) === ymd(d)).reduce((a, r) => a + Number(r.amount), 0));
    const max = Math.max(1, ...totals);
    return days.map((d, i) => ({ key: ymd(d), value: totals[i], pct: Math.max(8, Math.round((totals[i] / max) * 100)),
      label: i === 6 ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short' }) }));
  });

  private bounds(): [string, string] {
    const today = startOfDay(new Date());
    const from = this.range() === 'today' ? today
      : this.range() === 'week' ? addDays(today, -((today.getDay() + 6) % 7))
      : new Date(today.getFullYear(), today.getMonth(), 1);
    return [from.toISOString(), addDays(today, 1).toISOString()];
  }
  ionViewWillEnter() {
    void this.load();
  }
  setRange(r: Range) {
    this.range.set(r);
    void this.load();
  }
  async load() {
    const id = this.auth.me()?.id;
    if (!id) return;
    try {
      const [from, to] = this.bounds();
      const weekFrom = addDays(startOfDay(new Date()), -6).toISOString();
      const [rows, last7, payouts, balances] = await Promise.all([
        this.data.staffEarnings(id, from, to), this.data.staffEarnings(id, weekFrom, to),
        this.data.staffPayouts(id), this.data.staffBalances(),
      ]);
      this.rows.set(rows);
      this.last7.set(last7);
      this.payouts.set(payouts);
      const me = balances.find((b) => b.staff_id === id);
      this.unpaid.set(Number(me?.unpaid ?? 0));
      this.schedule.set(({ daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly' } as Record<string, string>)[me?.payout_schedule ?? 'weekly'] ?? 'Weekly');
    } catch (e) {
      this.ui.error(e);
    }
  }
}
