import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonMenuButton, IonModal, IonSegment,
  IonSegmentButton, IonLabel, IonSelect, IonSelectOption, IonTitle, IonToggle, IonToolbar, ViewWillEnter,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline } from 'ionicons/icons';
import { DataService } from '../core/data.service';
import { PAY_METHODS, Staff, StaffBalance, methodLabel } from '../core/models';
import { NotConfiguredComponent } from '../core/not-configured.component';
import { KshPipe, Ui, addDays, startOfDay } from '../core/ui';

type Period = 'today' | 'week' | 'biweek' | 'month';

@Component({
  selector: 'app-staff',
  imports: [FormsModule, DatePipe, KshPipe, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, IonButton, IonIcon, IonModal, IonItem, IonInput, IonSelect, IonSelectOption, IonToggle, IonSegment, IonSegmentButton, IonLabel, NotConfiguredComponent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons>
      <ion-title>Staff & commission</ion-title>
      <ion-buttons slot="end"><ion-button (click)="editStaff(null)"><ion-icon slot="start" name="add-outline"></ion-icon>Staff</ion-button></ion-buttons>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="page-wrap">
        <app-not-configured />
        <p class="muted small">Commission is worked out automatically at checkout (on the price after discount, split on joint work). Transport fees go to the stylists who travelled.</p>
        <div class="card">
          @if (!balances().length) { <div class="empty">No staff yet.</div> }
          <table class="t">
            @if (balances().length) {
              <thead><tr><th>Staff</th><th class="num">Commission</th><th class="num">Transport</th><th class="num">Paid out</th><th class="num">Unpaid</th></tr></thead>
            }
            <tbody>
              @for (b of balances(); track b.staff_id) {
                <tr (click)="open(b)" style="cursor:pointer" [style.opacity]="b.active ? 1 : 0.45">
                  <td><strong>{{ b.name }}</strong><br /><span class="muted small">Paid {{ b.payout_schedule }}</span></td>
                  <td class="num">{{ b.commission_total | ksh }}</td>
                  <td class="num">{{ b.transport_total | ksh }}</td>
                  <td class="num">{{ b.paid_out | ksh }}</td>
                  <td class="num"><strong [class.maroon]="b.unpaid > 0">{{ b.unpaid | ksh }}</strong></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- add / edit staff -->
      <ion-modal [isOpen]="!!form()" (didDismiss)="form.set(null)" class="wide">
        <ng-template>
          <ion-header><ion-toolbar><ion-title>{{ form()?.id ? 'Edit staff' : 'New staff' }}</ion-title></ion-toolbar></ion-header>
          <ion-content class="ion-padding">
            @if (form(); as f) {
              <div class="form-grid">
                <ion-item lines="none" class="field"><ion-input label="Name" labelPlacement="stacked" [(ngModel)]="f.name"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Phone" labelPlacement="stacked" type="tel" [(ngModel)]="f.phone"></ion-input></ion-item>
                <ion-item lines="none" class="field">
                  <ion-select label="Roles" labelPlacement="stacked" [multiple]="true" [(ngModel)]="f.roles">
                    @for (r of data.roles(); track r.key) { <ion-select-option [value]="r.key">{{ r.name }}</ion-select-option> }
                  </ion-select>
                </ion-item>
                <ion-item lines="none" class="field">
                  <ion-select label="Payout schedule" labelPlacement="stacked" interface="popover" [(ngModel)]="f.payout_schedule">
                    <ion-select-option value="daily">Daily</ion-select-option>
                    <ion-select-option value="weekly">Weekly</ion-select-option>
                    <ion-select-option value="biweekly">Every 2 weeks</ion-select-option>
                    <ion-select-option value="monthly">Monthly</ion-select-option>
                  </ion-select>
                </ion-item>
                <ion-item lines="none" class="field"><ion-input label="Basic salary per period (optional)" labelPlacement="stacked" type="number" [(ngModel)]="f.basic_salary"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-toggle [(ngModel)]="f.active">Active</ion-toggle></ion-item>
              </div>
              <div class="row" style="margin-top:12px">
                <span class="spacer"></span>
                <ion-button fill="clear" color="medium" (click)="form.set(null)">Cancel</ion-button>
                <ion-button (click)="saveStaff(f)">Save</ion-button>
              </div>
            }
          </ion-content>
        </ng-template>
      </ion-modal>

      <!-- earnings statement -->
      <ion-modal [isOpen]="!!selected()" (didDismiss)="selected.set(null)" class="wide">
        <ng-template>
          <ion-header><ion-toolbar>
            <ion-title>{{ selected()?.name }}</ion-title>
            <ion-buttons slot="end"><ion-button (click)="editFromSelected()">Edit</ion-button><ion-button (click)="selected.set(null)">Close</ion-button></ion-buttons>
          </ion-toolbar></ion-header>
          <ion-content class="ion-padding">
            <ion-segment [(ngModel)]="period" (ionChange)="loadEarnings()">
              <ion-segment-button value="today"><ion-label>Today</ion-label></ion-segment-button>
              <ion-segment-button value="week"><ion-label>7 days</ion-label></ion-segment-button>
              <ion-segment-button value="biweek"><ion-label>14 days</ion-label></ion-segment-button>
              <ion-segment-button value="month"><ion-label>30 days</ion-label></ion-segment-button>
            </ion-segment>
            <div class="grid" style="margin-top:12px">
              <div class="card stat"><div class="label">Commission</div><div class="value">{{ sum('commission') | ksh }}</div></div>
              <div class="card stat"><div class="label">Transport</div><div class="value">{{ sum('transport') | ksh }}</div></div>
              <div class="card stat"><div class="label">Jobs</div><div class="value">{{ jobs() }}</div></div>
              <div class="card stat"><div class="label">Unpaid (all time)</div><div class="value maroon">{{ selected()?.unpaid | ksh }}</div></div>
            </div>
            <div class="section-title">Record payout / advance</div>
            <div class="row">
              <ion-item lines="none" class="field" style="flex:1 1 120px">
                <ion-select label="Type" labelPlacement="stacked" interface="popover" [(ngModel)]="payout.kind">
                  <ion-select-option value="payout">Payout</ion-select-option>
                  <ion-select-option value="advance">Advance</ion-select-option>
                  <ion-select-option value="bonus">Bonus (record only)</ion-select-option>
                </ion-select>
              </ion-item>
              <ion-item lines="none" class="field" style="flex:1 1 120px"><ion-input label="Amount" labelPlacement="stacked" type="number" [(ngModel)]="payout.amount"></ion-input></ion-item>
              <ion-item lines="none" class="field" style="flex:1 1 140px">
                <ion-select label="Method" labelPlacement="stacked" interface="popover" [(ngModel)]="payout.method">
                  @for (m of methods; track m.value) { <ion-select-option [value]="m.value">{{ m.label }}</ion-select-option> }
                </ion-select>
              </ion-item>
              <ion-button (click)="recordPayout()">Save</ion-button>
            </div>
            <div class="section-title">Earnings</div>
            <table class="t"><tbody>
              @for (e of earnings(); track e.id) {
                <tr><td>{{ e.created_at | date: 'd MMM, HH:mm' }}</td><td>{{ e.sales.clients?.name ?? e.sales.guest_name ?? 'Guest' }}</td>
                  <td>{{ e.kind }}</td><td class="num">{{ e.amount | ksh }}</td></tr>
              } @empty { <tr><td class="muted">No earnings in this period.</td></tr> }
            </tbody></table>
            <div class="section-title">Payouts</div>
            <table class="t"><tbody>
              @for (p of payouts(); track p.id) {
                <tr><td>{{ p.paid_at | date: 'd MMM y' }}</td><td>{{ p.kind }}</td><td>{{ label(p.method) }}</td><td class="num">{{ p.amount | ksh }}</td></tr>
              } @empty { <tr><td class="muted">No payouts yet.</td></tr> }
            </tbody></table>
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
})
export class StaffPage implements ViewWillEnter {
  readonly data = inject(DataService);
  private ui = inject(Ui);
  readonly balances = signal<StaffBalance[]>([]);
  readonly form = signal<Partial<Staff> | null>(null);
  readonly selected = signal<StaffBalance | null>(null);
  readonly earnings = signal<Awaited<ReturnType<DataService['staffEarnings']>>>([]);
  readonly payouts = signal<Awaited<ReturnType<DataService['staffPayouts']>>>([]);
  readonly methods = PAY_METHODS;
  readonly label = methodLabel;
  period: Period = 'week';
  payout = { kind: 'payout', amount: null as number | null, method: 'cash' };

  constructor() {
    addIcons({ addOutline });
  }
  ionViewWillEnter() {
    this.load();
  }
  async load() {
    if (!this.data.configured) return;
    try {
      this.balances.set(await this.data.staffBalances());
    } catch (e) {
      this.ui.error(e);
    }
  }
  editStaff(s: Staff | null) {
    this.form.set(s ? { ...s } : { roles: ['stylist'], payout_schedule: 'weekly', basic_salary: 0, active: true });
  }
  editFromSelected() {
    const s = this.data.staff().find((x) => x.id === this.selected()?.staff_id);
    this.selected.set(null);
    if (s) this.editStaff(s);
  }
  async saveStaff(f: Partial<Staff>) {
    if (!f.name?.trim()) return this.ui.toast('Enter a name', 'danger');
    try {
      await this.data.saveStaff({ ...f, name: f.name.trim(), basic_salary: Number(f.basic_salary ?? 0) });
      this.form.set(null);
      this.ui.toast('Staff saved');
      this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }
  open(b: StaffBalance) {
    this.selected.set(b);
    this.period = ({ daily: 'today', weekly: 'week', biweekly: 'biweek', monthly: 'month' } as Record<string, Period>)[b.payout_schedule] ?? 'week';
    this.loadEarnings();
  }
  async loadEarnings() {
    const s = this.selected();
    if (!s) return;
    const days = { today: 0, week: 6, biweek: 13, month: 29 }[this.period];
    const from = addDays(startOfDay(new Date()), -days).toISOString();
    const to = addDays(startOfDay(new Date()), 1).toISOString();
    try {
      const [e, p] = await Promise.all([this.data.staffEarnings(s.staff_id, from, to), this.data.staffPayouts(s.staff_id)]);
      this.earnings.set(e);
      this.payouts.set(p);
    } catch (err) {
      this.ui.error(err);
    }
  }
  sum(kind: string) {
    return this.earnings().filter((e) => e.kind === kind).reduce((a, e) => a + Number(e.amount), 0);
  }
  jobs() {
    return new Set(this.earnings().map((e) => e.sales.sold_at)).size;
  }
  async recordPayout() {
    const s = this.selected();
    if (!s || !this.payout.amount || this.payout.amount <= 0) return this.ui.toast('Enter an amount', 'danger');
    try {
      await this.data.addPayout({ staff_id: s.staff_id, kind: this.payout.kind, amount: Number(this.payout.amount), method: this.payout.method });
      this.ui.toast('Saved');
      this.payout = { kind: 'payout', amount: null, method: 'cash' };
      await this.load();
      this.selected.set(this.balances().find((b) => b.staff_id === s.staff_id) ?? null);
      this.loadEarnings();
    } catch (e) {
      this.ui.error(e);
    }
  }
}
