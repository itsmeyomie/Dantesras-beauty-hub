import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonButton, IonButtons, IonCheckbox, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonMenuButton, IonSelect,
  IonSelectOption, IonTitle, IonToolbar, ViewWillEnter,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { trashOutline } from 'ionicons/icons';
import { DataService } from '../core/data.service';
import { Booking, CHANNELS, Channel, PaymentInput } from '../core/models';
import { NotConfiguredComponent } from '../core/not-configured.component';
import { PaymentEntryComponent, paymentError } from '../core/payment-entry.component';
import { ClientChoice, ClientPickerComponent, PickedService, ServicePickerComponent } from '../core/pickers.component';
import { KshPipe, Ui, ageFrom } from '../core/ui';

interface Line { kind: 'service' | 'product'; service_id: string | null; variant_id: string | null; product_id: string | null; name: string; qty: number; unit_price: number; }
interface Share { staff_id: string; share_pct: number; }

@Component({
  selector: 'app-checkout',
  imports: [
    FormsModule, KshPipe, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, IonButton, IonIcon, IonItem,
    IonInput, IonSelect, IonSelectOption, IonCheckbox, NotConfiguredComponent, ClientPickerComponent, ServicePickerComponent, PaymentEntryComponent,
  ],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons>
      <ion-title>Checkout</ion-title>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="page-wrap">
        <app-not-configured />
        @if (done(); as d) {
          <div class="card" style="text-align:center;padding:28px">
            <h2 class="maroon" style="margin-top:0">Sale recorded</h2>
            <p>Total {{ d.total | ksh }} · Paid {{ d.paid | ksh }}
              @if (d.balance > 0) { · <strong class="maroon">Debt {{ d.balance | ksh }}</strong> }</p>
            <ion-button (click)="reset()">New sale</ion-button>
            <ion-button fill="outline" (click)="router.navigate(['/bookings'])">Back to bookings</ion-button>
          </div>
        } @else {
          <div class="grid-2">
            <div>
              <div class="card">
                <h3>{{ booking() ? 'Booking checkout' : 'Quick sale' }}</h3>
                <ion-item lines="none" class="field">
                  <ion-select label="Type" labelPlacement="stacked" interface="popover" [(ngModel)]="channel">
                    @for (c of channels; track c.value) { <ion-select-option [value]="c.value">{{ c.label }}</ion-select-option> }
                  </ion-select>
                </ion-item>
                <app-client-picker [(choice)]="who" />
              </div>

              <div class="card" style="margin-top:12px">
                <h3>Services</h3>
                <app-service-picker [clientType]="clientType()" (picked)="addService($event)" />
                <h3 style="margin-top:14px">Products (e.g. extension hair bought here)</h3>
                <div class="row">
                  <ion-item lines="none" class="field" style="flex:2 1 200px">
                    <ion-select label="Product" labelPlacement="stacked" interface="action-sheet" [(ngModel)]="productId">
                      @for (p of products(); track p.id) { <ion-select-option [value]="p.id">{{ p.name }} – {{ p.price | ksh }} ({{ p.stock_qty }} left)</ion-select-option> }
                    </ion-select>
                  </ion-item>
                  <ion-item lines="none" class="field" style="flex:0 1 90px"><ion-input label="Qty" labelPlacement="stacked" type="number" min="1" [(ngModel)]="productQty"></ion-input></ion-item>
                  <ion-button (click)="addProduct()" [disabled]="!productId">Add</ion-button>
                </div>
                <p class="muted small">Client brought their own hair? Don't add it – extension hair is not included in service prices.</p>
              </div>

              <div class="card" style="margin-top:12px">
                <h3>Who did the work</h3>
                <ion-item lines="none" class="field">
                  <ion-select label="Stylist(s)" labelPlacement="stacked" [multiple]="true" [ngModel]="shareIds()" (ngModelChange)="setStaff($event)">
                    @for (s of activeStaff(); track s.id) { <ion-select-option [value]="s.id">{{ s.name }}</ion-select-option> }
                  </ion-select>
                </ion-item>
                @if (shares().length > 1) {
                  <p class="muted small">Joint work – commission is split by these shares (must total 100%).</p>
                  @for (sh of shares(); track sh.staff_id) {
                    <div class="row"><span style="flex:1">{{ staffName(sh.staff_id) }}</span>
                      <ion-item lines="none" class="field" style="width:110px"><ion-input type="number" [(ngModel)]="sh.share_pct" aria-label="Share percent"></ion-input></ion-item><span>%</span></div>
                  }
                  @if (shareTotal() !== 100) { <p class="down small">Shares add up to {{ shareTotal() }}%</p> }
                }
              </div>
            </div>

            <div>
              <div class="card">
                <h3>Bill</h3>
                <table class="t"><tbody>
                  @for (l of lines(); track $index) {
                    <tr><td>{{ l.name }} @if (l.qty > 1) { × {{ l.qty }} }</td><td class="num">{{ l.unit_price * l.qty | ksh }}</td>
                      <td class="num" style="width:40px"><ion-button fill="clear" size="small" color="medium" (click)="removeLine($index)" aria-label="Remove"><ion-icon slot="icon-only" name="trash-outline"></ion-icon></ion-button></td></tr>
                  } @empty { <tr><td class="muted">Nothing added yet.</td></tr> }
                </tbody></table>

                <div class="form-grid" style="margin-top:10px">
                  <ion-item lines="none" class="field"><ion-input label="Discount (KSh)" labelPlacement="stacked" type="number" min="0" [(ngModel)]="discount"></ion-input></ion-item>
                  @if (discount > 0) {
                    <ion-item lines="none" class="field"><ion-input label="Reason for discount" labelPlacement="stacked" [(ngModel)]="discountReason"></ion-input></ion-item>
                  }
                  @if (channel === 'home') {
                    <ion-item lines="none" class="field"><ion-input label="Transport fee" labelPlacement="stacked" type="number" min="0" [(ngModel)]="transport"></ion-input></ion-item>
                  }
                </div>
                @if (discountTooHigh()) {
                  <ion-item lines="none"><ion-checkbox [(ngModel)]="ownerApproved" labelPlacement="end">Owner approved a discount above {{ maxDiscount() }}%</ion-checkbox></ion-item>
                }

                <table class="t totals">
                  <tr><td>Subtotal</td><td class="num">{{ subtotal() | ksh }}</td></tr>
                  @if (discount > 0) { <tr><td>Discount</td><td class="num">− {{ discount | ksh }}</td></tr> }
                  @if (channel === 'home' && transport > 0) { <tr><td>Transport</td><td class="num">{{ transport | ksh }}</td></tr> }
                  <tr><td><strong>Total</strong></td><td class="num"><strong>{{ total() | ksh }}</strong></td></tr>
                  @if (deposits() > 0) { <tr><td>Already paid (booking)</td><td class="num">− {{ deposits() | ksh }}</td></tr> }
                  <tr><td><strong>To pay now</strong></td><td class="num"><strong class="maroon">{{ due() | ksh }}</strong></td></tr>
                </table>
              </div>

              <div class="card" style="margin-top:12px">
                <h3>Payment</h3>
                @for (p of payments(); track $index) {
                  <app-payment-entry [p]="p" [removable]="payments().length > 1" (changed)="tick()" (remove)="removePayment($index)" />
                }
                <ion-button size="small" fill="outline" (click)="addPayment()">+ Split payment</ion-button>
                <div class="row" style="margin-top:10px">
                  <span>Paying {{ paying() | ksh }}</span><span class="spacer"></span>
                  @if (balance() > 0) { <strong class="maroon">Debt {{ balance() | ksh }}</strong> }
                </div>
                <ion-button expand="block" style="margin-top:12px" (click)="submit()" [disabled]="busy()">Complete sale</ion-button>
              </div>
            </div>
          </div>
        }
      </div>
    </ion-content>
  `,
  styles: `.totals td { border: 0; padding: 4px; }`,
})
export class CheckoutPage implements ViewWillEnter {
  readonly data = inject(DataService);
  readonly router = inject(Router);
  private ui = inject(Ui);
  readonly booking = input<string>();
  readonly client = input<string>();

  readonly channels = CHANNELS;
  readonly lines = signal<Line[]>([]);
  readonly shares = signal<Share[]>([]);
  readonly payments = signal<PaymentInput[]>([{ method: 'cash', amount: null }]);
  readonly loadedBooking = signal<Booking | null>(null);
  readonly busy = signal(false);
  readonly done = signal<{ total: number; paid: number; balance: number } | null>(null);
  readonly version = signal(0); // bumps when plain fields change, so computed totals refresh

  readonly activeStaff = computed(() => this.data.staff().filter((s) => s.active));
  readonly products = computed(() => this.data.products().filter((p) => p.status === 'active'));
  readonly maxDiscount = computed(() => Number(this.data.setting('max_discount_pct', 10)));
  readonly shareIds = computed(() => this.shares().map((s) => s.staff_id));

  who: ClientChoice = { client: null, guestName: '' };
  channel: Channel = 'salon';
  discount = 0;
  discountReason = '';
  transport = 0;
  ownerApproved = false;
  productId: string | null = null;
  productQty = 1;

  constructor() {
    addIcons({ trashOutline });
  }

  async ionViewWillEnter() {
    this.reset();
    const bid = this.booking();
    const cid = this.client();
    try {
      if (bid) {
        const b = await this.data.getBooking(bid);
        this.loadedBooking.set(b);
        this.channel = b.channel;
        this.transport = Number(b.transport_fee ?? 0);
        this.who = b.client_id
          ? { client: (await this.data.getClient(b.client_id)), guestName: '' }
          : { client: null, guestName: b.guest_name ?? '' };
        this.lines.set((b.booking_services ?? []).map((s) => ({ kind: 'service', service_id: s.service_id, variant_id: s.variant_id, product_id: null, name: s.name, qty: 1, unit_price: Number(s.price) })));
        this.setStaff((b.booking_staff ?? []).map((s) => s.staff_id));
      } else if (cid) {
        this.who = { client: await this.data.getClient(cid), guestName: '' };
      }
    } catch (e) {
      this.ui.error(e);
    }
  }

  reset() {
    this.done.set(null);
    this.loadedBooking.set(null);
    this.lines.set([]);
    this.shares.set([]);
    this.payments.set([{ method: 'cash', amount: null }]);
    this.who = { client: null, guestName: '' };
    this.channel = 'salon';
    this.discount = 0;
    this.discountReason = '';
    this.transport = 0;
    this.ownerApproved = false;
  }

  // ----- totals (methods so they re-read plain fields on every render) -----
  subtotal() {
    return this.lines().reduce((a, l) => a + l.unit_price * l.qty, 0);
  }
  total() {
    return this.subtotal() - Number(this.discount || 0) + (this.channel === 'home' ? Number(this.transport || 0) : 0);
  }
  deposits() {
    return (this.loadedBooking()?.payments ?? []).filter((p) => p.kind === 'deposit').reduce((a, p) => a + Number(p.amount), 0);
  }
  due() {
    return Math.max(0, this.total() - this.deposits());
  }
  paying() {
    this.version();
    return this.payments().reduce((a, p) => a + Number(p.amount || 0), 0);
  }
  balance() {
    return Math.max(0, this.due() - this.paying());
  }
  shareTotal() {
    return Math.round(this.shares().reduce((a, s) => a + Number(s.share_pct || 0), 0) * 100) / 100;
  }
  discountTooHigh() {
    const sub = this.subtotal();
    return sub > 0 && (Number(this.discount || 0) / sub) * 100 > this.maxDiscount();
  }
  clientType(): 'kids' | 'adult' | null {
    const a = ageFrom(this.who.client?.birth_date ?? null);
    return a === null ? null : a <= Number(this.data.setting('kids_max_age', 12)) ? 'kids' : 'adult';
  }
  tick() {
    this.version.update((v) => v + 1);
  }

  // ----- editing -----
  addService(s: PickedService) {
    this.lines.update((l) => [...l, { kind: 'service', service_id: s.service_id, variant_id: s.variant_id, product_id: null, name: s.name, qty: 1, unit_price: s.price }]);
  }
  addProduct() {
    const p = this.data.products().find((x) => x.id === this.productId);
    if (!p) return;
    const qty = Math.max(1, Number(this.productQty) || 1);
    this.lines.update((l) => [...l, { kind: 'product', service_id: null, variant_id: null, product_id: p.id, name: p.name, qty, unit_price: Number(p.price) }]);
    this.productId = null;
    this.productQty = 1;
  }
  removeLine(i: number) {
    this.lines.update((l) => l.filter((_, j) => j !== i));
  }
  setStaff(ids: string[]) {
    const n = ids.length;
    const base = n ? Math.floor((100 / n) * 100) / 100 : 0;
    this.shares.set(ids.map((id, i) => ({ staff_id: id, share_pct: i === 0 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base })));
  }
  staffName(id: string) {
    return this.data.staff().find((s) => s.id === id)?.name ?? '';
  }
  addPayment() {
    this.payments.update((p) => [...p, { method: 'mpesa_till', amount: null }]);
  }
  removePayment(i: number) {
    this.payments.update((p) => p.filter((_, j) => j !== i));
  }

  async submit() {
    if (!this.who.client && !this.who.guestName.trim()) return this.ui.toast('Choose a client or enter a guest name', 'danger');
    if (!this.lines().length) return this.ui.toast('Add at least one service or product', 'danger');
    if (!this.shares().length) return this.ui.toast('Choose the stylist(s) who did the work', 'danger');
    if (this.shareTotal() !== 100) return this.ui.toast('Stylist shares must add up to 100%', 'danger');
    if (Number(this.discount) > 0 && !this.discountReason.trim()) return this.ui.toast('Give a reason for the discount', 'danger');
    if (this.discountTooHigh() && !this.ownerApproved) return this.ui.toast(`Discounts above ${this.maxDiscount()}% need the owner`, 'danger');
    for (const p of this.payments()) {
      const err = paymentError(p);
      if (err) return this.ui.toast(err, 'danger');
    }
    if (this.paying() > this.due() + 0.001) return this.ui.toast('Payment is more than the amount due – enter what was actually received', 'danger');
    if (this.balance() > 0 && !this.who.client) return this.ui.toast('Guests must pay in full (no debt for guests)', 'danger');
    if (this.balance() > 0 && !(await this.ui.confirm('Record a debt?', `${this.who.client?.name} will owe KSh ${this.balance().toLocaleString('en-KE')}.`, 'Record debt'))) return;

    this.busy.set(true);
    try {
      const total = this.total();
      await this.data.checkout({
        booking_id: this.loadedBooking()?.id ?? null,
        client_id: this.who.client?.id ?? null,
        guest_name: this.who.client ? null : this.who.guestName.trim(),
        channel: this.channel,
        discount: Number(this.discount || 0),
        discount_reason: this.discountReason || null,
        owner_approved: this.ownerApproved,
        transport_fee: this.channel === 'home' ? Number(this.transport || 0) : 0,
        items: this.lines(),
        staff: this.shares().map((s) => ({ staff_id: s.staff_id, share_pct: Number(s.share_pct) })),
        payments: this.payments().filter((p) => Number(p.amount) > 0).map((p) => ({
          method: p.method, amount: Number(p.amount), mpesa_ref: p.mpesa_ref ?? null,
          mpesa_at: p.mpesa_time ? todayAt(p.mpesa_time) : null,
        })),
      });
      const paid = this.paying() + this.deposits();
      this.done.set({ total, paid, balance: Math.max(0, total - paid) });
      this.ui.toast('Sale completed');
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}

function todayAt(time: string) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
