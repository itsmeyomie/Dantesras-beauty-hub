import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonMenuButton, IonTitle, IonToolbar, ViewWillEnter,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';
import { DataService } from '../core/data.service';
import { channelLabel, methodLabel } from '../core/models';
import { NotConfiguredComponent } from '../core/not-configured.component';
import { KshPipe, Ui, addDays, dayRange, startOfDay } from '../core/ui';

type Sale = Awaited<ReturnType<DataService['salesBetween']>>[number];

/** Daily list of every sale with who entered it – for the owner's daily check. */
@Component({
  selector: 'app-sales',
  imports: [DatePipe, KshPipe, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, IonButton, IonIcon, NotConfiguredComponent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons>
      <ion-title>Sales</ion-title>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="page-wrap">
        <app-not-configured />
        <div class="row" style="margin-bottom:12px">
          <ion-button fill="clear" (click)="shift(-1)" aria-label="Previous day"><ion-icon slot="icon-only" name="chevron-back-outline"></ion-icon></ion-button>
          <strong>{{ day() | date: 'EEEE d MMM y' }}</strong>
          <ion-button fill="clear" (click)="shift(1)" aria-label="Next day"><ion-icon slot="icon-only" name="chevron-forward-outline"></ion-icon></ion-button>
          <span class="spacer"></span>
          <strong>{{ total() | ksh }}</strong>&nbsp;<span class="muted small">from {{ completed().length }} sales</span>
        </div>
        <div class="card">
          <table class="t">
            <thead><tr><th>Time</th><th>Client / items</th><th>Stylist · entered by</th><th>Paid via</th><th class="num">Total</th><th></th></tr></thead>
            <tbody>
              @for (s of sales(); track s.id) {
                <tr [style.opacity]="s.status === 'void' ? 0.5 : 1">
                  <td>{{ s.sold_at | date: 'HH:mm' }}<br /><span class="pill {{ s.channel }}">{{ chLabel(s.channel) }}</span></td>
                  <td><strong>{{ s.clients?.name ?? s.guest_name ?? 'Guest' }}</strong><br /><span class="small muted">{{ items(s) }}</span>
                    @if (s.status === 'void') { <br /><span class="pill void">void: {{ s.void_reason }}</span> }</td>
                  <td class="small">{{ stylists(s) }}<br /><span class="muted">entered by {{ s.entered?.name ?? '—' }}</span></td>
                  <td class="small">{{ pays(s) }}</td>
                  <td class="num">{{ s.total | ksh }}@if (s.balance > 0) { <br /><span class="maroon small">owes {{ s.balance | ksh }}</span> }</td>
                  <td class="num">@if (s.status === 'completed') { <ion-button size="small" fill="clear" color="danger" (click)="voidSale(s)">Void</ion-button> }</td>
                </tr>
              } @empty { <tr><td colspan="6" class="empty">No sales on this day.</td></tr> }
            </tbody>
          </table>
        </div>
        <p class="muted small">Sales are never deleted. Voiding (owner only once login is added) keeps the record, reverses commission and returns products to stock.</p>
      </div>
    </ion-content>
  `,
})
export class SalesPage implements ViewWillEnter {
  private data = inject(DataService);
  private ui = inject(Ui);
  readonly day = signal(startOfDay(new Date()));
  readonly sales = signal<Sale[]>([]);
  readonly completed = computed(() => this.sales().filter((s) => s.status === 'completed'));
  readonly total = computed(() => this.completed().reduce((a, s) => a + Number(s.total), 0));
  readonly chLabel = channelLabel;

  constructor() {
    addIcons({ chevronBackOutline, chevronForwardOutline });
  }
  ionViewWillEnter() {
    this.load();
  }
  async load() {
    if (!this.data.configured) return;
    try {
      const [f, t] = dayRange(this.day());
      this.sales.set(await this.data.salesBetween(f, t));
    } catch (e) {
      this.ui.error(e);
    }
  }
  shift(n: number) {
    this.day.set(addDays(this.day(), n));
    this.load();
  }
  items(s: Sale) {
    return s.sale_items.map((i) => i.name).join(', ');
  }
  stylists(s: Sale) {
    return s.sale_staff.map((x) => x.staff?.name).join(' & ');
  }
  pays(s: Sale) {
    return s.payments.map((p) => `${methodLabel(p.method)} ${Number(p.amount).toLocaleString('en-KE')}${p.mpesa_ref ? ' (…' + p.mpesa_ref + ')' : ''}`).join(', ');
  }
  async voidSale(s: Sale) {
    const reason = await this.ui.prompt('Void this sale?', 'Reason (required)');
    if (!reason) return;
    try {
      await this.data.voidSale(s.id, reason);
      this.ui.toast('Sale voided');
      this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }
}
