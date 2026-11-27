import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonMenuButton, IonModal,
  IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonTextarea, IonTitle, IonToggle, IonToolbar, ViewWillEnter,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { createOutline, trashOutline } from 'ionicons/icons';
import { DataService } from '../core/data.service';
import { Booking, OutsideBuy } from '../core/models';
import { NotConfiguredComponent } from '../core/not-configured.component';
import { KshPipe, Ui, addDays, startOfDay } from '../core/ui';

interface BuyForm {
  id?: string; shop: string; item: string; qty: number | null; cost: number | null;
  booking_id: string | null; on_bill: boolean; bill_price: number | null; notes: string; billed: boolean;
}
interface ShopGroup { shop: string; rows: OutsideBuy[]; total: number; }

/** Owner / manager: things bought from outside shops (e.g. braids we don't have) and paying the shops in the evening. */
@Component({
  selector: 'app-outside',
  imports: [
    DatePipe, FormsModule, KshPipe, NotConfiguredComponent, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent,
    IonButton, IonIcon, IonModal, IonItem, IonInput, IonTextarea, IonSelect, IonSelectOption, IonToggle, IonSegment, IonSegmentButton, IonLabel,
  ],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons>
      <ion-title>Bought outside</ion-title>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="page-wrap">
        <app-not-configured />
        <p class="muted small" style="margin-top:0">Things bought from another shop for a client (e.g. braids we don't have). Pay the shops in the evening and mark them paid here.</p>
        <div class="grid">
          <div class="card stat"><div class="label">Still to pay the shops</div><div class="value maroon" data-testid="owed-total">{{ owedTotal() | ksh }}</div></div>
          <div class="card stat"><div class="label">Shops to pay</div><div class="value">{{ groups().length }}</div></div>
          <div class="card stat"><div class="label">Paid today</div><div class="value">{{ paidToday() | ksh }}</div></div>
        </div>
        <ion-button (click)="newBuy()" data-testid="outside-new">+ Record something bought outside</ion-button>

        <div class="section-title">Still to pay</div>
        @for (g of groups(); track g.shop) {
          <div class="card shop" data-testid="shop-card">
            <div class="row"><strong>{{ g.shop }}</strong><span class="spacer"></span><strong class="maroon" data-testid="shop-total">{{ g.total | ksh }}</strong></div>
            <table class="t" style="margin-top:6px"><tbody>
              @for (o of g.rows; track o.id) {
                <tr data-testid="outside-row">
                  <td>{{ o.item }} @if (o.qty !== 1) { × {{ o.qty }} }<br />
                    <span class="muted small">{{ o.bought_at | date: 'EEE d MMM, HH:mm' }}@if (who(o)) { · for {{ who(o) }} }</span><br />
                    <span class="small" [class.maroon]="billState(o) === 'missed'" data-testid="bill-state">{{ billLabel(o) }}</span></td>
                  <td class="num">{{ o.cost | ksh }}</td>
                  <td class="num" style="white-space:nowrap">
                    <ion-button size="small" fill="clear" (click)="edit(o)" aria-label="Change"><ion-icon slot="icon-only" name="create-outline"></ion-icon></ion-button>
                    @if (!o.sale_id) { <ion-button size="small" fill="clear" color="danger" (click)="remove(o)" aria-label="Delete"><ion-icon slot="icon-only" name="trash-outline"></ion-icon></ion-button> }
                  </td>
                </tr>
              }
            </tbody></table>
            <ion-button size="small" (click)="openPay(g)" data-testid="shop-pay">Mark {{ g.shop }} paid ({{ g.total | ksh }})</ion-button>
          </div>
        } @empty { <div class="card"><div class="empty">Nothing owed to shops. 🎉</div></div> }

        <div class="section-title">Paid in the last 7 days</div>
        <div class="card">
          <table class="t"><tbody>
            @for (o of paid(); track o.id) {
              <tr data-testid="paid-row"><td><strong>{{ o.shop }}</strong> · {{ o.item }} @if (o.qty !== 1) { × {{ o.qty }} }<br />
                <span class="muted small">Paid {{ o.paid_at | date: 'EEE d MMM, HH:mm' }} · {{ o.paid_method === 'mpesa' ? 'M-Pesa' : 'Cash' }}@if (o.paid_ref) { {{ o.paid_ref }} }</span></td>
                <td class="num">{{ o.cost | ksh }}</td></tr>
            } @empty { <tr><td class="empty">Nothing paid yet.</td></tr> }
          </tbody></table>
        </div>
      </div>

      <!-- record / change -->
      <ion-modal [isOpen]="!!form()" (didDismiss)="form.set(null)" [initialBreakpoint]="0.95" [breakpoints]="[0, 0.95]">
        <ng-template>
          <ion-content class="ion-padding">
            @if (form(); as f) {
              <h3>{{ f.id ? 'Change' : 'Bought outside' }}</h3>
              <div class="form-grid">
                <ion-item lines="none" class="field"><ion-input label="Shop" labelPlacement="stacked" [(ngModel)]="f.shop" placeholder="e.g. Mama Njeri, Kamakis" data-testid="o-shop"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Item" labelPlacement="stacked" [(ngModel)]="f.item" placeholder="e.g. Braids 1B" data-testid="o-item"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="How many" labelPlacement="stacked" type="number" min="1" [(ngModel)]="f.qty"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="We owe the shop (KSh, all)" labelPlacement="stacked" type="number" min="0" [(ngModel)]="f.cost"></ion-input></ion-item>
              </div>
              @if (shops().length) {
                <div class="row small" style="flex-wrap:wrap;gap:6px;margin:2px 0 8px">
                  @for (s of shops(); track s) { <button class="chip" type="button" (click)="f.shop = s">{{ s }}</button> }
                </div>
              }
              <ion-item lines="none" class="field">
                <ion-select label="For which client (optional)" labelPlacement="stacked" interface="popover" [disabled]="f.billed"
                  [(ngModel)]="f.booking_id" (ionChange)="f.on_bill = !!f.booking_id && f.on_bill" placeholder="Not for one client" data-testid="o-booking">
                  <ion-select-option [value]="null">Not for one client</ion-select-option>
                  @for (b of open(); track b.id) { <ion-select-option [value]="b.id">{{ bookingLabel(b) }}</ion-select-option> }
                </ion-select>
              </ion-item>
              @if (f.booking_id) {
                <ion-item lines="none" class="field">
                  <ion-toggle [(ngModel)]="f.on_bill" [disabled]="f.billed" data-testid="o-on-bill">Client pays for it on her bill</ion-toggle>
                </ion-item>
                @if (f.on_bill) {
                  <ion-item lines="none" class="field"><ion-input label="Charge the client (KSh, all)" labelPlacement="stacked" type="number" min="0" [disabled]="f.billed" [(ngModel)]="f.bill_price" data-testid="o-bill-price"></ion-input></ion-item>
                  <p class="muted small" style="margin:2px 0 8px">It is added to her bill at checkout.</p>
                }
              }
              @if (f.billed) { <p class="small">Already on the client's bill.</p> }
              <ion-item lines="none" class="field"><ion-textarea label="Notes" labelPlacement="stacked" autoGrow="true" [(ngModel)]="f.notes"></ion-textarea></ion-item>
              <div class="row" style="margin-top:12px">
                <ion-button fill="clear" color="medium" (click)="form.set(null)">Cancel</ion-button>
                <span class="spacer"></span>
                <ion-button (click)="save(f)" [disabled]="saving()" data-testid="o-save">Save</ion-button>
              </div>
            }
          </ion-content>
        </ng-template>
      </ion-modal>

      <!-- pay a shop -->
      <ion-modal [isOpen]="!!paying()" (didDismiss)="paying.set(null)" [initialBreakpoint]="0.7" [breakpoints]="[0, 0.7]">
        <ng-template>
          <ion-content class="ion-padding">
            @if (paying(); as g) {
              <h3>Pay {{ g.shop }}</h3>
              <p>{{ g.rows.length }} item{{ g.rows.length === 1 ? '' : 's' }} · <strong>{{ g.total | ksh }}</strong></p>
              <ion-segment [value]="payMethod" (ionChange)="payMethod = $any($event.detail.value)" data-testid="pay-method">
                <ion-segment-button value="cash"><ion-label>Cash</ion-label></ion-segment-button>
                <ion-segment-button value="mpesa"><ion-label>M-Pesa</ion-label></ion-segment-button>
              </ion-segment>
              @if (payMethod === 'mpesa') {
                <ion-item lines="none" class="field" style="margin-top:8px"><ion-input label="M-Pesa code (optional)" labelPlacement="stacked" [(ngModel)]="payRef"></ion-input></ion-item>
              }
              <div class="row" style="margin-top:14px">
                <ion-button fill="clear" color="medium" (click)="paying.set(null)">Cancel</ion-button>
                <span class="spacer"></span>
                <ion-button (click)="pay(g)" [disabled]="saving()" data-testid="pay-confirm">Paid {{ g.total | ksh }}</ion-button>
              </div>
            }
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
  styles: [`
    .card.shop { margin-bottom: 10px; }
    .chip { border: 1px solid var(--line, #ddd); background: transparent; border-radius: 999px; padding: 4px 10px; font: inherit; color: inherit; cursor: pointer; }
  `],
})
export class OutsidePage implements ViewWillEnter {
  private data = inject(DataService);
  private ui = inject(Ui);
  readonly rows = signal<OutsideBuy[]>([]);
  readonly open = signal<Booking[]>([]);
  readonly form = signal<BuyForm | null>(null);
  readonly paying = signal<ShopGroup | null>(null);
  readonly saving = signal(false);
  payMethod: 'cash' | 'mpesa' = 'cash';
  payRef = '';

  readonly owed = computed(() => this.rows().filter((o) => !o.paid_at));
  readonly owedTotal = computed(() => this.owed().reduce((a, o) => a + Number(o.cost), 0));
  readonly paid = computed(() => this.rows().filter((o) => !!o.paid_at).sort((a, b) => (b.paid_at ?? '').localeCompare(a.paid_at ?? '')));
  readonly paidToday = computed(() => {
    const t = startOfDay(new Date()).getTime();
    return this.paid().filter((o) => new Date(o.paid_at!).getTime() >= t).reduce((a, o) => a + Number(o.cost), 0);
  });
  readonly groups = computed<ShopGroup[]>(() => {
    const m = new Map<string, ShopGroup>();
    for (const o of this.owed()) {
      const key = o.shop.trim().toLowerCase();
      const g = m.get(key) ?? { shop: o.shop.trim(), rows: [], total: 0 };
      g.rows.push(o);
      g.total += Number(o.cost);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => a.shop.localeCompare(b.shop));
  });
  /** shops used before, to pick with one tap */
  readonly shops = computed(() => [...new Set(this.rows().map((o) => o.shop.trim()))].slice(0, 8));

  constructor() {
    addIcons({ createOutline, trashOutline });
  }

  ionViewWillEnter() {
    void this.load();
  }

  async load() {
    try {
      const [rows, open] = await Promise.all([
        this.data.outsideBuys(addDays(startOfDay(new Date()), -7).toISOString()),
        this.data.openBookings(),
      ]);
      this.rows.set(rows);
      this.open.set(open);
    } catch (e) {
      this.ui.error(e);
    }
  }

  who(o: OutsideBuy) {
    return o.bookings ? (o.bookings.clients?.name ?? o.bookings.guest_name ?? 'client') : '';
  }
  billState(o: OutsideBuy): 'none' | 'billed' | 'waiting' | 'missed' {
    if (!o.on_bill) return 'none';
    if (o.sale_id) return 'billed';
    return o.bookings && ['completed', 'cancelled', 'declined', 'no_show'].includes(o.bookings.status) ? 'missed' : 'waiting';
  }
  billLabel(o: OutsideBuy) {
    switch (this.billState(o)) {
      case 'billed': return `On her bill (${this.ksh(o.bill_price)})`;
      case 'waiting': return `Goes on her bill at checkout (${this.ksh(o.bill_price)})`;
      case 'missed': return 'Not charged – her visit closed without it';
      default: return 'Salon cost (not on a bill)';
    }
  }
  private ksh(n: number | null) {
    return 'KSh ' + Number(n ?? 0).toLocaleString('en-KE');
  }
  bookingLabel(b: Booking) {
    const name = b.clients?.name ?? b.guest_name ?? 'Client';
    const when = b.status === 'in_progress' ? 'in the chair' : b.status === 'waiting' ? 'walk-in queue'
      : b.scheduled_at ? new Date(b.scheduled_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    return `${name}${when ? ' · ' + when : ''}${b.channel === 'home' ? ' · home' : ''}`;
  }

  newBuy() {
    this.form.set({ shop: '', item: '', qty: 1, cost: null, booking_id: null, on_bill: false, bill_price: null, notes: '', billed: false });
  }
  edit(o: OutsideBuy) {
    // a booking that is no longer open still shows in the list
    if (o.booking_id && !this.open().some((b) => b.id === o.booking_id)) {
      this.open.update((l) => [{ id: o.booking_id!, guest_name: o.bookings?.guest_name ?? null, clients: o.bookings?.clients ?? null, status: o.bookings?.status ?? 'completed', channel: 'salon', scheduled_at: null } as Booking, ...l]);
    }
    this.form.set({
      id: o.id, shop: o.shop, item: o.item, qty: Number(o.qty), cost: Number(o.cost), booking_id: o.booking_id,
      on_bill: o.on_bill, bill_price: o.bill_price === null ? null : Number(o.bill_price), notes: o.notes ?? '', billed: !!o.sale_id,
    });
  }

  async save(f: BuyForm) {
    const qty = Number(f.qty), cost = Number(f.cost);
    if (!f.shop.trim()) return this.ui.toast('Enter the shop', 'danger');
    if (!f.item.trim()) return this.ui.toast('Enter what was bought', 'danger');
    if (!(qty > 0)) return this.ui.toast('Enter how many', 'danger');
    if (f.cost === null || `${f.cost}` === '' || !(cost >= 0)) return this.ui.toast('Enter what we owe the shop', 'danger');
    const onBill = !!f.booking_id && f.on_bill;
    if (onBill && (f.bill_price === null || `${f.bill_price}` === '' || !(Number(f.bill_price) >= 0))) {
      return this.ui.toast('Enter what to charge the client', 'danger');
    }
    this.saving.set(true);
    try {
      const row: Partial<OutsideBuy> = { shop: f.shop.trim(), item: f.item.trim(), qty, cost, notes: f.notes.trim() || null };
      if (!f.billed) Object.assign(row, { booking_id: f.booking_id, on_bill: onBill, bill_price: onBill ? Number(f.bill_price) : null });
      await this.data.saveOutsideBuy({ ...(f.id ? { id: f.id } : {}), ...row });
      this.ui.toast(f.id ? 'Saved' : `Recorded – we owe ${f.shop.trim()} ${this.ksh(cost)}`);
      this.form.set(null);
      await this.load();
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  async remove(o: OutsideBuy) {
    if (!(await this.ui.confirm('Delete?', `${o.item} from ${o.shop} (${this.ksh(o.cost)}) will be removed.`, 'Delete'))) return;
    try {
      await this.data.deleteOutsideBuy(o.id);
      this.ui.toast('Deleted');
      await this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }

  openPay(g: ShopGroup) {
    this.payMethod = 'cash';
    this.payRef = '';
    this.paying.set(g);
  }
  async pay(g: ShopGroup) {
    this.saving.set(true);
    try {
      await this.data.payOutside(g.rows.map((o) => o.id), this.payMethod, this.payMethod === 'mpesa' ? this.payRef.trim() || null : null);
      this.ui.toast(`${g.shop} paid ${this.ksh(g.total)}`);
      this.paying.set(null);
      await this.load();
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.saving.set(false);
    }
  }
}
