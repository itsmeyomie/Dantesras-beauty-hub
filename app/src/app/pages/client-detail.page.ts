import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonModal, IonTitle, IonToolbar, ViewWillEnter,
} from '@ionic/angular';
import { ClientFormComponent } from '../core/client-form.component';
import { DataService } from '../core/data.service';
import { Client, Debt, PaymentInput, channelLabel } from '../core/models';
import { PayDialogComponent } from '../core/pay-dialog.component';
import { KshPipe, Ui, ageFrom } from '../core/ui';

@Component({
  selector: 'app-client-detail',
  imports: [DatePipe, RouterLink, KshPipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonButton, IonModal, ClientFormComponent, PayDialogComponent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-back-button defaultHref="/clients"></ion-back-button></ion-buttons>
      <ion-title>{{ client()?.name ?? 'Client' }}</ion-title>
      <ion-buttons slot="end"><ion-button (click)="editing.set(true)">Edit</ion-button></ion-buttons>
    </ion-toolbar></ion-header>
    <ion-content>
      @if (client(); as c) {
        <div class="page-wrap">
          @if (totalDebt() > 0) {
            <div class="notice" style="border-color:#e3a0a0;background:#fdeeee">
              <strong class="maroon">Owes {{ totalDebt() | ksh }}</strong> – ask the client to clear it.
            </div>
          }
          <div class="grid">
            <div class="card stat"><div class="label">Visits</div><div class="value">{{ visits() }}</div></div>
            <div class="card stat"><div class="label">Total spent</div><div class="value">{{ spent() | ksh }}</div></div>
            <div class="card stat"><div class="label">Last visit</div><div class="value" style="font-size:1.1rem">{{ (history()[0]?.sold_at | date: 'd MMM y') ?? '—' }}</div></div>
          </div>

          <div class="card" style="margin-top:12px">
            <h3>Details</h3>
            <div class="form-grid small">
              <div><span class="muted">Phone</span><br />{{ c.phone }}</div>
              <div><span class="muted">WhatsApp</span><br />{{ c.whatsapp || c.phone }}</div>
              <div><span class="muted">Age</span><br />{{ age() ?? '—' }} {{ (age() ?? 99) <= 12 ? '(kids prices)' : '' }}</div>
              <div><span class="muted">Area</span><br />{{ c.area || '—' }}</div>
              <div><span class="muted">Found us via</span><br />{{ c.source || '—' }}</div>
              <div><span class="muted">Preferred stylist</span><br />{{ stylistName(c.preferred_staff_id) }}</div>
            </div>
            @if (c.notes) { <p class="small"><span class="muted">Notes:</span> {{ c.notes }}</p> }
            <div class="row" style="margin-top:8px">
              <ion-button size="small" routerLink="/bookings" [queryParams]="{ client: c.id }">New booking</ion-button>
              <ion-button size="small" fill="outline" routerLink="/checkout" [queryParams]="{ client: c.id }">Quick sale</ion-button>
            </div>
          </div>

          @if (debts().length) {
            <div class="section-title">Outstanding debts</div>
            <div class="card">
              <table class="t"><tbody>
                @for (d of debts(); track d.sale_id) {
                  <tr>
                    <td>{{ d.sold_at | date: 'd MMM y' }}<br /><span class="muted small">{{ d.days_owed }} days</span></td>
                    <td class="num">{{ d.balance | ksh }}</td>
                    <td class="num"><ion-button size="small" (click)="paying.set(d)">Pay</ion-button></td>
                  </tr>
                }
              </tbody></table>
            </div>
          }

          <div class="section-title">Visit history</div>
          <div class="card">
            @if (!history().length) { <div class="empty">No visits yet.</div> }
            <table class="t"><tbody>
              @for (h of history(); track h.id) {
                <tr>
                  <td style="white-space:nowrap">{{ h.sold_at | date: 'd MMM y' }}<br /><span class="pill {{ h.channel }}">{{ label(h.channel) }}</span></td>
                  <td>{{ itemNames(h.sale_items) }}<br /><span class="muted small">{{ staffNames(h.sale_staff) }}</span>
                    @if (h.status === 'void') { <span class="pill void">void</span> }</td>
                  <td class="num">{{ h.total | ksh }}</td>
                </tr>
              }
            </tbody></table>
          </div>
        </div>
      }

      <ion-modal [isOpen]="editing()" (didDismiss)="editing.set(false)" class="wide">
        <ng-template>
          <ion-header><ion-toolbar><ion-title>Edit client</ion-title></ion-toolbar></ion-header>
          <ion-content class="ion-padding">
            <app-client-form [client]="client()" (saved)="editing.set(false); load()" (cancelled)="editing.set(false)" />
          </ion-content>
        </ng-template>
      </ion-modal>
      <ion-modal [isOpen]="!!paying()" (didDismiss)="paying.set(null)" [initialBreakpoint]="0.92" [breakpoints]="[0, 0.92]">
        <ng-template>
          <ion-content class="ion-padding">
            <h3>Debt payment</h3>
            @if (paying(); as d) {
              <app-pay-dialog [due]="d.balance" [pay]="payDebt" [stk]="{ purpose: 'debt', sale_id: d.sale_id, phone: d.client_phone }" (done)="paying.set(null); load()" (cancelled)="paying.set(null)" />
            }
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
})
export class ClientDetailPage implements ViewWillEnter {
  private data = inject(DataService);
  private ui = inject(Ui);
  readonly id = input.required<string>();
  readonly client = signal<Client | null>(null);
  readonly history = signal<Awaited<ReturnType<DataService['clientHistory']>>>([]);
  readonly debts = signal<Debt[]>([]);
  readonly editing = signal(false);
  readonly paying = signal<Debt | null>(null);
  readonly totalDebt = computed(() => this.debts().reduce((a, d) => a + Number(d.balance), 0));
  readonly visits = computed(() => this.history().filter((h) => h.status === 'completed').length);
  readonly spent = computed(() => this.history().filter((h) => h.status === 'completed').reduce((a, h) => a + Number(h.total), 0));
  readonly age = computed(() => ageFrom(this.client()?.birth_date ?? null));
  readonly label = channelLabel;

  payDebt = (p: PaymentInput) => this.data.payDebt(this.paying()!.sale_id, p);

  ionViewWillEnter() {
    this.load();
  }
  async load() {
    try {
      const [c, h, d] = await Promise.all([this.data.getClient(this.id()), this.data.clientHistory(this.id()), this.data.clientDebt(this.id())]);
      this.client.set(c);
      this.history.set(h);
      this.debts.set(d);
    } catch (e) {
      this.ui.error(e);
    }
  }
  stylistName(id: string | null) {
    return this.data.staff().find((s) => s.id === id)?.name ?? '—';
  }
  itemNames(items: { name: string }[]) {
    return items.map((i) => i.name).join(', ');
  }
  staffNames(s: { staff: { name: string } }[]) {
    return s.map((x) => x.staff?.name).join(' & ');
  }
}
