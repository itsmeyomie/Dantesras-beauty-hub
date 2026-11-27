import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonMenuButton, IonModal, IonTitle, IonToolbar, ViewWillEnter,
} from '@ionic/angular';
import { DataService } from '../core/data.service';
import { Debt, PaymentInput, Student } from '../core/models';
import { NotConfiguredComponent } from '../core/not-configured.component';
import { PayDialogComponent } from '../core/pay-dialog.component';
import { KshPipe, Ui } from '../core/ui';

@Component({
  selector: 'app-debts',
  imports: [DatePipe, RouterLink, KshPipe, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, IonButton, IonModal, NotConfiguredComponent, PayDialogComponent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons>
      <ion-title>Debts</ion-title>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="page-wrap">
        <app-not-configured />
        <div class="grid">
          <div class="card stat"><div class="label">Salon clients owe</div><div class="value maroon">{{ clientTotal() | ksh }}</div></div>
          <div class="card stat"><div class="label">Under 7 days</div><div class="value">{{ bucket(0, 6) | ksh }}</div></div>
          <div class="card stat"><div class="label">7–30 days</div><div class="value">{{ bucket(7, 30) | ksh }}</div></div>
          <div class="card stat"><div class="label">Over 30 days</div><div class="value down">{{ bucket(31, 99999) | ksh }}</div></div>
          <div class="card stat"><div class="label">School fee balances</div><div class="value">{{ studentTotal() | ksh }}</div></div>
        </div>

        <div class="section-title">Salon clients</div>
        <div class="card">
          <table class="t">
            <tbody>
              @for (d of debts(); track d.sale_id) {
                <tr>
                  <td><a [routerLink]="['/clients', d.client_id]"><strong>{{ d.client_name }}</strong></a><br /><span class="muted small">{{ d.client_phone }}</span></td>
                  <td class="small">{{ d.sold_at | date: 'd MMM y' }}<br /><span [class.down]="d.days_owed > 30">{{ d.days_owed }} days</span></td>
                  <td class="num">{{ d.balance | ksh }}<br /><span class="muted small">of {{ d.total | ksh }}</span></td>
                  <td class="num"><ion-button size="small" (click)="paying.set(d)">Pay</ion-button></td>
                </tr>
              } @empty { <tr><td class="empty">No client debts. 🎉</td></tr> }
            </tbody>
          </table>
        </div>

        <div class="section-title">Students with fee balances</div>
        <div class="card">
          <table class="t"><tbody>
            @for (s of students(); track s.id) {
              <tr><td><strong>{{ s.name }}</strong><br /><span class="muted small">{{ s.course_name }} · {{ s.phone }}</span></td>
                <td class="num">{{ s.balance | ksh }}</td>
                <td class="num"><ion-button size="small" fill="outline" routerLink="/school">Open</ion-button></td></tr>
            } @empty { <tr><td class="empty">No fee balances.</td></tr> }
          </tbody></table>
        </div>
      </div>

      <ion-modal [isOpen]="!!paying()" (didDismiss)="paying.set(null)" [initialBreakpoint]="0.92" [breakpoints]="[0, 0.92]">
        <ng-template>
          <ion-content class="ion-padding">
            <h3>{{ paying()?.client_name }} – debt payment</h3>
            @if (paying(); as d) {
              <app-pay-dialog [due]="d.balance" [pay]="payDebt" [stk]="{ purpose: 'debt', sale_id: d.sale_id, phone: d.client_phone, saved: true }" (done)="paying.set(null); load()" (cancelled)="paying.set(null)" />
            }
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
})
export class DebtsPage implements ViewWillEnter {
  private data = inject(DataService);
  private ui = inject(Ui);
  readonly debts = signal<Debt[]>([]);
  readonly students = signal<Student[]>([]);
  readonly paying = signal<Debt | null>(null);
  readonly clientTotal = computed(() => this.debts().reduce((a, d) => a + Number(d.balance), 0));
  readonly studentTotal = computed(() => this.students().reduce((a, s) => a + Number(s.balance), 0));

  payDebt = (p: PaymentInput) => this.data.payDebt(this.paying()!.sale_id, p);

  ionViewWillEnter() {
    this.load();
  }
  async load() {
    if (!this.data.configured) return;
    try {
      const [d, s] = await Promise.all([this.data.debts(), this.data.students()]);
      this.debts.set(d);
      this.students.set(s.filter((x) => x.status === 'active' && Number(x.balance) > 0));
    } catch (e) {
      this.ui.error(e);
    }
  }
  bucket(min: number, max: number) {
    return this.debts().filter((d) => d.days_owed >= min && d.days_owed <= max).reduce((a, d) => a + Number(d.balance), 0);
  }
}
