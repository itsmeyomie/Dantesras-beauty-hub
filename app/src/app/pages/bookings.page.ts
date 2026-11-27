import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonMenuButton, IonModal,
  IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonTextarea, IonTitle, IonToolbar, ViewWillEnter,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, chevronBackOutline, chevronForwardOutline, trashOutline } from 'ionicons/icons';
import { DataService } from '../core/data.service';
import { Booking, BookingService, CHANNELS, Client, Channel, HairItem, PaymentInput, SOURCES, channelLabel } from '../core/models';
import { bookingValue, hairNote } from '../staff/my-day.page';
import { MonthCalendarComponent } from '../core/month-calendar.component';
import { AssignSheetComponent } from '../staff/assign-sheet.component';
import { crewNames, mainIds } from '../core/team';
import { checkIn } from '../core/checkin';
import { NotConfiguredComponent } from '../core/not-configured.component';
import { PayDialogComponent } from '../core/pay-dialog.component';
import { PaymentEntryComponent, paymentError } from '../core/payment-entry.component';
import { ClientChoice, ClientPickerComponent, PickedService, ServicePickerComponent } from '../core/pickers.component';
import { KshPipe, Ui, addDays, ageFrom, dayRange, startOfDay, ymd } from '../core/ui';

interface BookingForm {
  id?: string; channel: Channel; source: string | null; date: string; time: string; duration_min: number;
  address: string; stylists_needed: number; transport_fee: number; notes: string;
  hair_source: 'salon' | 'client' | null; hair: HairItem[];
}

@Component({
  selector: 'app-bookings',
  imports: [
    FormsModule, DatePipe, KshPipe, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, IonButton, IonIcon,
    IonSegment, IonSegmentButton, IonLabel, IonModal, IonItem, IonInput, IonSelect, IonSelectOption, IonTextarea,
    NotConfiguredComponent, MonthCalendarComponent, ClientPickerComponent, ServicePickerComponent, PaymentEntryComponent, PayDialogComponent,
    AssignSheetComponent,
  ],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons>
      <ion-title>Bookings & queue</ion-title>
      <ion-buttons slot="end"><ion-button (click)="newBooking(tab() === 'queue' ? 'walkin' : 'salon')"><ion-icon slot="start" name="add-outline"></ion-icon>New</ion-button></ion-buttons>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="page-wrap">
        <app-not-configured />
        <ion-segment [scrollable]="true" [value]="tab()" (ionChange)="tab.set($any($event.detail.value))">
          <ion-segment-button value="day"><ion-label>Bookings</ion-label></ion-segment-button>
          <ion-segment-button value="queue"><ion-label>Walk-ins ({{ queue().length }})</ion-label></ion-segment-button>
          <ion-segment-button value="requests"><ion-label>Online ({{ requests().length }})</ion-label></ion-segment-button>
        </ion-segment>

        @if (tab() === 'requests') {
          <p class="muted small" style="margin-top:12px">Booked by clients in the app. Confirm, suggest another time (edit), or decline with a reason – the client sees your answer.</p>
          @for (b of requests(); track b.id) {
            <div class="card booking request" data-testid="request">
              <div class="row">
                <strong class="time">{{ b.scheduled_at | date: 'EEE d MMM, HH:mm' }}</strong>
                <span class="pill {{ b.channel }}">{{ label(b.channel) }}</span>
                <span class="pill requested">requested</span>
                <span class="spacer"></span>
                <span class="muted small">{{ b.created_at | date: 'd MMM HH:mm' }}</span>
              </div>
              <div style="margin-top:6px"><strong>{{ b.clients?.name ?? b.guest_name }}</strong> <span class="muted">{{ b.clients?.phone }}</span></div>
              <div class="small">{{ serviceNames(b) }} · <strong>{{ value(b) | ksh }}</strong></div>
              <div class="small muted">{{ staffNames(b) ? 'Asked for ' + staffNames(b) : 'Any stylist' }}
                @if (b.channel === 'home') { · {{ b.address }} }</div>
              <div class="small">Deposit paid: <strong [class.maroon]="deposits(b) === 0">{{ deposits(b) | ksh }}</strong>
                @if (deposits(b) === 0) { <span class="muted"> – confirming keeps it "pending" until the deposit comes in</span> }</div>
              @if (b.notes) { <div class="small muted">Client note: {{ b.notes }}</div> }
              <div class="row actions">
                <ion-button size="small" (click)="confirmRequest(b)">Confirm</ion-button>
                <ion-button size="small" fill="outline" (click)="assigning.set(b)" data-testid="request-assign">{{ staffNames(b) ? 'Change stylist' : 'Assign stylist' }}</ion-button>
                <ion-button size="small" fill="outline" (click)="edit(b)">Change time</ion-button>
                <ion-button size="small" fill="clear" color="danger" (click)="declineRequest(b)">Decline</ion-button>
              </div>
            </div>
          } @empty { <div class="empty">No online requests waiting.</div> }
        } @else if (tab() === 'day') {
          <div class="row" style="margin:12px 0">
            <ion-button fill="clear" (click)="shiftDay(-1)" aria-label="Previous day"><ion-icon slot="icon-only" name="chevron-back-outline"></ion-icon></ion-button>
            <strong>{{ day() | date: 'EEEE d MMM y' }}</strong>
            <ion-button fill="clear" (click)="shiftDay(1)" aria-label="Next day"><ion-icon slot="icon-only" name="chevron-forward-outline"></ion-icon></ion-button>
            <ion-button size="small" fill="outline" (click)="goToday()">Today</ion-button>
            <ion-button size="small" fill="clear" (click)="showCal.set(!showCal())" data-testid="toggle-cal">{{ showCal() ? 'Hide calendar' : 'Calendar' }}</ion-button>
            <span class="spacer"></span>
            <span class="muted small">{{ hoursText() }}</span>
          </div>
          <div class="day-layout" [class.with-cal]="showCal()">
          @if (showCal()) {
            <div class="cal-col">
              <app-month-calendar #cal [value]="dayKey()" [counts]="counts()" (picked)="goDate($event)" (monthChange)="loadCounts($event)" />
              <p class="muted small" style="margin:6px 4px">Gold number = bookings that day (salon & home).</p>
            </div>
          }
          <div class="list-col">
          @for (b of bookings(); track b.id) {
            <div class="card booking" [class.late]="isLate(b)">
              <div class="row">
                <strong class="time">{{ b.scheduled_at | date: 'HH:mm' }}</strong>
                <span class="pill {{ b.channel }}">{{ label(b.channel) }}</span>
                <span class="pill {{ b.status }}">{{ b.status.replace('_', ' ') }}</span>
                @if (isLate(b)) { <span class="pill cancelled">over {{ lateMinutes() }} min late</span> }
                <span class="spacer"></span>
                <span class="muted small">{{ b.source }}</span>
              </div>
              <div style="margin-top:6px"><strong>{{ b.clients?.name ?? b.guest_name }}</strong> <span class="muted">{{ b.clients?.phone }}</span></div>
              <div class="small">{{ serviceNames(b) }} · <strong>{{ value(b) | ksh }}</strong></div>
              <div class="small muted">With {{ staffNames(b) || 'no stylist yet' }} · {{ b.duration_min ?? 60 }} min
                @if (b.channel === 'home') { · {{ b.address }} · transport {{ b.transport_fee | ksh }} }</div>
              @if (hair(b)) { <div class="small" data-testid="hair-note"><strong>{{ hair(b) }}</strong></div> }
              <div class="small">Paid upfront: <strong>{{ deposits(b) | ksh }}</strong>
                @if (b.status === 'pending') { <span class="maroon"> – needs {{ minDeposit() | ksh }} or full amount to hold the slot</span> }</div>
              @if (b.notes) { <div class="small muted">Note: {{ b.notes }}</div> }
              @if (b.early_reason) { <div class="small maroon" data-testid="early-note">Came early – had booked {{ b.original_scheduled_at | date: 'EEE d MMM, HH:mm' }}. Reason: {{ b.early_reason }}</div> }
              @if (b.status === 'requested') {
                <div class="row actions" data-testid="day-request-actions">
                  <span class="small maroon" style="font-weight:600">Online request – answer the client:</span>
                  <ion-button size="small" (click)="confirmRequest(b)">Confirm</ion-button>
                  <ion-button size="small" fill="clear" color="danger" (click)="declineRequest(b)">Decline</ion-button>
                </div>
              }
              @if (open(b)) {
                <div class="row actions">
                  <ion-button size="small" [fill]="staffNames(b) ? 'outline' : 'solid'" (click)="assigning.set(b)" data-testid="day-assign">{{ staffNames(b) ? 'Change stylist' : 'Assign stylist' }}</ion-button>
                  <ion-button size="small" fill="outline" (click)="depositFor.set(b)">+ Payment</ion-button>
                  @if (b.status !== 'in_progress') { <ion-button size="small" fill="outline" (click)="start(b)">Arrived / start</ion-button> }
                  <ion-button size="small" (click)="checkout(b)">Checkout</ion-button>
                  <ion-button size="small" fill="clear" (click)="edit(b)">Reschedule / edit</ion-button>
                  <ion-button size="small" fill="clear" color="danger" (click)="noShow(b)">No-show</ion-button>
                  <ion-button size="small" fill="clear" color="medium" (click)="cancel(b)">Cancel</ion-button>
                </div>
              }
            </div>
          } @empty { <div class="empty">No bookings for this day.</div> }
          </div>
          </div>
        } @else {
          <p class="muted small" style="margin-top:12px">Walk-ins in arrival order. Any free stylist takes the next client, or the client waits for a chosen stylist.</p>
          @for (b of queue(); track b.id; let i = $index) {
            <div class="card booking">
              <div class="row">
                <strong class="time">#{{ i + 1 }}</strong>
                <strong>{{ b.clients?.name ?? b.guest_name }}</strong>
                <span class="pill {{ b.status }}">{{ b.status.replace('_', ' ') }}</span>
                <span class="spacer"></span>
                <span class="small muted">waiting {{ waited(b) }} min</span>
              </div>
              <div class="small">{{ serviceNames(b) }} · <strong>{{ value(b) | ksh }}</strong></div>
              <div class="small muted">{{ staffNames(b) ? 'With ' + staffNames(b) : 'Next free stylist' }}</div>
              <div class="row actions">
                <ion-button size="small" [fill]="staffNames(b) ? 'outline' : 'solid'" (click)="assigning.set(b)" data-testid="queue-assign">{{ staffNames(b) ? 'Change stylist' : 'Assign stylist' }}</ion-button>
                @if (b.status === 'waiting') { <ion-button size="small" fill="outline" (click)="start(b)">Start</ion-button> }
                <ion-button size="small" (click)="checkout(b)">Checkout</ion-button>
                <ion-button size="small" fill="clear" color="medium" (click)="cancel(b)">Left / cancel</ion-button>
              </div>
            </div>
          } @empty { <div class="empty">Nobody waiting.</div> }
        }
      </div>

      <!-- new / edit booking -->
      <ion-modal [isOpen]="!!form()" (didDismiss)="form.set(null)" class="wide">
        <ng-template>
          <ion-header><ion-toolbar><ion-title>{{ form()?.id ? 'Edit booking' : 'New booking' }}</ion-title>
            <ion-buttons slot="end"><ion-button (click)="form.set(null)">Close</ion-button></ion-buttons></ion-toolbar></ion-header>
          <ion-content class="ion-padding">
            @if (form(); as f) {
              <ion-segment [(ngModel)]="f.channel">
                @for (c of channels; track c.value) { <ion-segment-button [value]="c.value"><ion-label>{{ c.label }}</ion-label></ion-segment-button> }
              </ion-segment>

              <div class="section-title">Client</div>
              <app-client-picker [(choice)]="who" />

              <div class="section-title">Services</div>
              <app-service-picker [clientType]="clientType()" (picked)="addService($event)" />
              @for (s of chosen(); track $index) {
                <div class="row line"><span>{{ s.name }}</span><span class="spacer"></span><strong>{{ s.price | ksh }}</strong>
                  <ion-button fill="clear" color="medium" size="small" (click)="removeService($index)" aria-label="Remove"><ion-icon slot="icon-only" name="trash-outline"></ion-icon></ion-button></div>
              }

              <div class="section-title">Stylist(s) {{ busy().length ? '– greyed out = already booked then' : '' }}</div>
              <ion-item lines="none" class="field">
                <ion-select label="Stylist(s)" labelPlacement="stacked" [multiple]="true" [(ngModel)]="staffSel">
                  @for (s of activeStaff(); track s.id) {
                    <ion-select-option [value]="s.id" [disabled]="busy().includes(s.id)">{{ s.name }}{{ busy().includes(s.id) ? ' (busy)' : '' }}</ion-select-option>
                  }
                </ion-select>
              </ion-item>

              <div class="form-grid">
                @if (f.channel !== 'walkin') {
                  <ion-item lines="none" class="field"><ion-input label="Date" labelPlacement="stacked" type="date" [(ngModel)]="f.date" (ionChange)="checkBusy()"></ion-input></ion-item>
                  <ion-item lines="none" class="field"><ion-input label="Time" labelPlacement="stacked" type="time" [(ngModel)]="f.time" (ionChange)="checkBusy()"></ion-input></ion-item>
                  <ion-item lines="none" class="field"><ion-input label="Expected duration (min)" labelPlacement="stacked" type="number" [(ngModel)]="f.duration_min" (ionChange)="checkBusy()"></ion-input></ion-item>
                }
                <ion-item lines="none" class="field">
                  <ion-select label="Booked via" labelPlacement="stacked" interface="popover" [(ngModel)]="f.source">
                    @for (s of sources; track s) { <ion-select-option [value]="s">{{ s }}</ion-select-option> }
                  </ion-select>
                </ion-item>
                @if (f.channel === 'home') {
                  <ion-item lines="none" class="field"><ion-input label="Client location / address" labelPlacement="stacked" [(ngModel)]="f.address"></ion-input></ion-item>
                  <ion-item lines="none" class="field"><ion-input label="Number of stylists" labelPlacement="stacked" type="number" min="1" [(ngModel)]="f.stylists_needed"></ion-input></ion-item>
                  <ion-item lines="none" class="field"><ion-input label="Transport fee (agreed)" labelPlacement="stacked" type="number" [(ngModel)]="f.transport_fee"></ion-input></ion-item>
                }
              </div>
              @if (f.channel === 'home') {
                <div class="hair-box" data-testid="hair-box">
                  <div class="section-title" style="margin-top:4px">Hair</div>
                  <ion-segment [value]="f.hair_source ?? ''" (ionChange)="f.hair_source = $any($event.detail.value) || null" data-testid="hair-source">
                    <ion-segment-button value="salon"><ion-label>Salon brings hair</ion-label></ion-segment-button>
                    <ion-segment-button value="client"><ion-label>Client has hair</ion-label></ion-segment-button>
                  </ion-segment>
                  @if (f.hair_source === 'salon') {
                    @for (h of f.hair; track $index) {
                      <div class="row small hair-line" style="margin-top:6px" data-testid="hair-line">
                        <span>{{ h.name }} × {{ h.qty }}</span><span class="spacer"></span><strong>{{ h.price * h.qty | ksh }}</strong>
                        <ion-button size="small" fill="clear" color="danger" (click)="removeHair(f, $index)" aria-label="Remove hair"><ion-icon slot="icon-only" name="trash-outline"></ion-icon></ion-button>
                      </div>
                    }
                    <div class="form-grid" style="margin-top:6px">
                      <ion-item lines="none" class="field">
                        <ion-select label="Hair from stock" labelPlacement="stacked" interface="popover" [(ngModel)]="hairPick" placeholder="Choose" data-testid="hair-product">
                          @for (p of hairProducts(); track p.id) { <ion-select-option [value]="p.id">{{ p.name }} · {{ p.price | ksh }} ({{ p.stock_qty }} in stock)</ion-select-option> }
                        </ion-select>
                      </ion-item>
                      <ion-item lines="none" class="field"><ion-input label="Packets / pieces" labelPlacement="stacked" type="number" min="1" [(ngModel)]="hairQty"></ion-input></ion-item>
                    </div>
                    <ion-button size="small" fill="outline" (click)="addHair(f)" data-testid="hair-add">+ Add hair</ion-button>
                    <p class="muted small" style="margin:4px 0 0">It goes on her bill at checkout and comes out of stock.</p>
                  } @else if (f.hair_source === 'client') {
                    <p class="muted small" style="margin:6px 0 0">The stylist doesn't carry hair.</p>
                  }
                </div>
              }
              <ion-item lines="none" class="field"><ion-textarea label="Notes" labelPlacement="stacked" autoGrow="true" [(ngModel)]="f.notes"></ion-textarea></ion-item>

              @if (!f.id && f.channel !== 'walkin') {
                <div class="section-title">Payment to hold the slot (full amount or at least {{ minDeposit() | ksh }})</div>
                <app-payment-entry [p]="deposit" />
              }
              <div class="row" style="margin-top:12px">
                <strong>Total: {{ formTotal() | ksh }}</strong>
                <span class="spacer"></span>
                <ion-button (click)="save(f)" [disabled]="saving()">{{ f.channel === 'walkin' && !f.id ? 'Add to queue' : 'Save booking' }}</ion-button>
              </div>
            }
          </ion-content>
        </ng-template>
      </ion-modal>

      <!-- deposit / payment on an existing booking -->
      <ion-modal [isOpen]="!!depositFor()" (didDismiss)="depositFor.set(null)" [initialBreakpoint]="0.92" [breakpoints]="[0, 0.92]">
        <ng-template>
          <ion-content class="ion-padding">
            <h3>Payment for booking</h3>
            <p class="muted small">Payments are kept if the client doesn't show up.</p>
            @if (depositFor(); as b) {
              <app-pay-dialog [pay]="payDeposit" [due]="value(b) - deposits(b)" [stk]="{ purpose: 'deposit', booking_id: b.id, phone: b.clients?.phone }" (done)="depositFor.set(null); load()" (cancelled)="depositFor.set(null)" />
            }
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
    <app-assign-sheet [booking]="assigning()" (closed)="assigning.set(null)" (done)="assigning.set(null); load()" />
  `,
  styles: `
    .booking { margin-bottom: 10px; }
    .booking.late { border-color: #e3a0a0; }
    .time { font-size: 1.1rem; color: var(--app-maroon); min-width: 48px; }
    .actions { margin-top: 8px; }
    .day-layout.with-cal { display: grid; gap: 16px; grid-template-columns: minmax(280px, 360px) 1fr; align-items: start; }
    @media (max-width: 820px) { .day-layout.with-cal { grid-template-columns: 1fr; } }
    .cal-col { position: sticky; top: 8px; }
    .line { border-bottom: 1px solid var(--app-border); padding: 2px 0; }
  `,
})
export class BookingsPage implements ViewWillEnter {
  readonly data = inject(DataService);
  private ui = inject(Ui);
  private router = inject(Router);
  /** ?client=<id> opens a new booking for that client */
  readonly client = input<string>();
  /** ?tab=requests opens the online requests (link from the dashboard) */
  readonly tabParam = input<string>(undefined, { alias: 'tab' });
  /** ?new=walkin|salon|home opens the booking form (front desk shortcuts) */
  readonly newParam = input<string>(undefined, { alias: 'new' });

  readonly tab = signal<'day' | 'queue' | 'requests'>('day');
  readonly day = signal(startOfDay(new Date()));
  readonly bookings = signal<Booking[]>([]);
  readonly queue = signal<Booking[]>([]);
  readonly requests = signal<Booking[]>([]);
  readonly showCal = signal(true);
  readonly counts = signal<Record<string, number>>({});
  readonly dayKey = computed(() => ymd(this.day()));
  readonly cal = viewChild<MonthCalendarComponent>('cal');
  private countsMonth = '';
  readonly form = signal<BookingForm | null>(null);
  readonly assigning = signal<Booking | null>(null);
  readonly chosen = signal<PickedService[]>([]);
  readonly busy = signal<string[]>([]);
  readonly saving = signal(false);
  readonly depositFor = signal<Booking | null>(null);
  readonly now = signal(Date.now());

  readonly channels = CHANNELS;
  readonly sources = SOURCES;
  readonly label = channelLabel;
  readonly activeStaff = computed(() => this.data.staff().filter((s) => s.active));
  /** Stable stylist-id arrays per walk-in. A fresh array on every render made ngModel re-render forever (page froze). */
  readonly minDeposit = computed(() => Number(this.data.setting('deposit_min', 500)));
  readonly lateMinutes = computed(() => Number(this.data.setting('late_minutes', 20)));

  who: ClientChoice = { client: null, guestName: '' };
  staffSel: string[] = [];
  deposit: PaymentInput = { method: 'mpesa_till', amount: null };

  payDeposit = (p: PaymentInput) => this.data.addDeposit(this.depositFor()!.id, p);

  constructor() {
    addIcons({ addOutline, chevronBackOutline, chevronForwardOutline, trashOutline });
    setInterval(() => this.now.set(Date.now()), 60000);
  }

  ionViewWillEnter() {
    const t = this.tabParam();
    if (t === 'requests' || t === 'queue' || t === 'day') this.tab.set(t);
    this.load();
    const n = this.newParam();
    if (n === 'walkin' || n === 'salon' || n === 'home') this.newBooking(n);
    const cid = this.client();
    if (cid) {
      this.data.getClient(cid).then((c) => {
        this.newBooking('salon');
        this.who = { client: c, guestName: '' };
      }).catch((e) => this.ui.error(e));
    }
  }

  async load() {
    if (!this.data.configured) return;
    try {
      const [from, to] = dayRange(this.day());
      const [b, q, r] = await Promise.all([this.data.bookingsBetween(from, to), this.data.walkinQueue(), this.data.onlineRequests()]);
      this.bookings.set(b);
      this.queue.set(q);
      this.requests.set(r);
      if (this.countsMonth) void this.loadCounts(this.countsMonth);
    } catch (e) {
      this.ui.error(e);
    }
  }

  // ----- day navigation -----
  shiftDay(n: number) {
    this.day.set(addDays(this.day(), n));
    this.cal()?.show(this.dayKey());
    this.load();
  }
  goToday() {
    this.day.set(startOfDay(new Date()));
    this.cal()?.show(this.dayKey());
    this.load();
  }
  goDate(key: string) {
    this.day.set(startOfDay(new Date(`${key}T12:00:00`)));
    this.load();
  }
  /** bookings per day for the month on the calendar */
  async loadCounts(first: string) {
    this.countsMonth = first;
    const start = new Date(`${first}T00:00:00`);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    try {
      const rows = await this.data.bookingDays(start.toISOString(), end.toISOString());
      if (this.countsMonth !== first) return;
      const c: Record<string, number> = {};
      for (const r of rows) {
        const k = ymd(new Date(r.scheduled_at));
        c[k] = (c[k] ?? 0) + 1;
      }
      this.counts.set(c);
    } catch (e) {
      this.ui.error(e);
    }
  }
  hoursText() {
    const h = this.hoursFor(this.day());
    return h ? `Open ${h.open}–${h.close}` : '';
  }
  private hoursFor(d: Date): { open: string; close: string } | null {
    const hours = this.data.setting<{ mon_sat?: { open: string; close: string }; sun?: { open: string; close: string } }>('salon_hours', {});
    return (d.getDay() === 0 ? hours.sun : hours.mon_sat) ?? null;
  }

  // ----- display helpers -----
  serviceNames(b: Booking) {
    return (b.booking_services ?? []).map((s) => s.name).join(', ') || 'No services yet';
  }
  staffNames(b: Booking) {
    return crewNames(b);
  }
  staffIds(b: Booking) {
    return mainIds(b);
  }
  value(b: Booking) {
    return bookingValue(b);
  }
  readonly hair = hairNote;
  /** products the salon can carry to a home service */
  readonly hairProducts = computed(() => this.data.products().filter((p) => p.status === 'active'));
  hairPick: string | null = null;
  hairQty = 1;
  addHair(f: BookingForm): void {
    const p = this.data.products().find((x) => x.id === this.hairPick);
    const qty = Number(this.hairQty);
    if (!p) { void this.ui.toast('Choose the hair', 'danger'); return; }
    if (!(qty > 0)) { void this.ui.toast('Enter how many', 'danger'); return; }
    const i = f.hair.findIndex((h) => h.product_id === p.id);
    if (i >= 0) f.hair[i] = { ...f.hair[i], qty: f.hair[i].qty + qty };
    else f.hair.push({ product_id: p.id, name: p.name, qty, price: Number(p.price) });
    this.hairPick = null;
    this.hairQty = 1;
  }
  removeHair(f: BookingForm, i: number) {
    f.hair.splice(i, 1);
  }
  private hairTotal(f: BookingForm | null) {
    return f?.channel === 'home' && f.hair_source === 'salon' ? f.hair.reduce((a, h) => a + h.price * h.qty, 0) : 0;
  }
  deposits(b: Booking) {
    return (b.payments ?? []).filter((p) => p.kind === 'deposit').reduce((a, p) => a + Number(p.amount), 0);
  }
  open(b: Booking) {
    return ['requested', 'pending', 'booked', 'waiting', 'in_progress'].includes(b.status);
  }
  isLate(b: Booking) {
    if (!b.scheduled_at || !['pending', 'booked'].includes(b.status)) return false;
    return this.now() > new Date(b.scheduled_at).getTime() + this.lateMinutes() * 60000;
  }
  waited(b: Booking) {
    return Math.max(0, Math.round((this.now() - new Date(b.created_at).getTime()) / 60000));
  }

  // ----- form -----
  clientType(): 'kids' | 'adult' | null {
    const a = ageFrom(this.who.client?.birth_date ?? null);
    return a === null ? null : a <= (Number(this.data.setting('kids_max_age', 12))) ? 'kids' : 'adult';
  }
  formTotal() {
    return this.chosen().reduce((a, s) => a + Number(s.price), 0) + (this.form()?.channel === 'home' ? Number(this.form()?.transport_fee ?? 0) : 0) + this.hairTotal(this.form());
  }
  newBooking(channel: Channel) {
    const d = this.tab() === 'day' ? this.day() : new Date();
    this.form.set({ channel, source: channel === 'walkin' ? 'In person' : 'WhatsApp', date: ymd(d), time: '', duration_min: 120, address: '', stylists_needed: 1, transport_fee: 0, notes: '', hair_source: null, hair: [] });
    this.hairPick = null;
    this.hairQty = 1;
    this.chosen.set([]);
    this.staffSel = [];
    this.busy.set([]);
    this.who = { client: null, guestName: '' };
    this.deposit = { method: 'mpesa_till', amount: null };
    void this.data.refreshStaff().catch(() => undefined); // people approved since the app opened
  }
  edit(b: Booking) {
    void this.data.refreshStaff().catch(() => undefined);
    const at = b.scheduled_at ? new Date(b.scheduled_at) : new Date();
    this.form.set({
      id: b.id, channel: b.channel, source: b.source, date: ymd(at),
      time: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
      duration_min: b.duration_min ?? 60, address: b.address ?? '', stylists_needed: b.stylists_needed,
      transport_fee: Number(b.transport_fee), notes: b.notes ?? '',
      hair_source: b.hair_source ?? null, hair: (b.hair_items ?? []).map((h) => ({ ...h })),
    });
    this.hairPick = null;
    this.hairQty = 1;
    this.chosen.set((b.booking_services ?? []).map((s) => ({ service_id: s.service_id, variant_id: s.variant_id, name: s.name, price: Number(s.price) })));
    this.staffSel = this.staffIds(b);
    this.who = { client: b.client_id ? ({ id: b.client_id, name: b.clients?.name, phone: b.clients?.phone } as Client) : null, guestName: b.guest_name ?? '' };
    this.checkBusy();
  }
  addService(s: PickedService) {
    this.chosen.update((l) => [...l, s]);
  }
  removeService(i: number) {
    this.chosen.update((l) => l.filter((_, j) => j !== i));
  }
  private startIso(f: BookingForm): string | null {
    if (f.channel === 'walkin' || !f.date || !f.time) return null;
    return new Date(`${f.date}T${f.time}:00`).toISOString();
  }
  async checkBusy() {
    const f = this.form();
    const iso = f && this.startIso(f);
    if (!f || !iso) return this.busy.set([]);
    try {
      this.busy.set(await this.data.busyStaff(iso, Number(f.duration_min) || 60, f.id));
    } catch (e) {
      this.ui.error(e);
    }
  }

  async save(f: BookingForm) {
    if (!this.who.client && !this.who.guestName.trim()) return this.ui.toast('Choose a client or enter a guest name', 'danger');
    if (!this.chosen().length) return this.ui.toast('Add at least one service', 'danger');
    const iso = this.startIso(f);
    if (f.channel !== 'walkin') {
      if (!iso) return this.ui.toast('Choose the date and time', 'danger');
      const d = new Date(iso);
      const h = this.hoursFor(d);
      const hm = f.time;
      if (h && (hm < h.open || hm >= h.close)) return this.ui.toast(`Outside opening hours (${h.open}–${h.close})`, 'danger');
      await this.checkBusy();
      const clash = this.staffSel.filter((s) => this.busy().includes(s));
      if (clash.length) return this.ui.toast('A chosen stylist is already booked at that time', 'danger');
    }
    if (f.channel === 'home' && !f.address.trim()) return this.ui.toast('Enter the client location for the home service', 'danger');
    if (f.channel === 'home' && !f.hair_source) return this.ui.toast('Choose who brings the hair: the salon or the client', 'danger');
    const dep = this.deposit;
    if (!f.id && f.channel !== 'walkin' && dep.amount) {
      const err = paymentError(dep);
      if (err) return this.ui.toast(err, 'danger');
      if (dep.amount > this.formTotal()) return this.ui.toast('Upfront payment is more than the booking total', 'danger');
    }
    this.saving.set(true);
    try {
      const services: BookingService[] = this.chosen().map((s) => ({ ...s }));
      const status = f.id ? undefined : f.channel === 'walkin' ? 'waiting' : 'pending';
      const id = await this.data.saveBooking(
        {
          id: f.id, channel: f.channel, source: f.source, client_id: this.who.client?.id ?? null,
          guest_name: this.who.client ? null : this.who.guestName.trim(), scheduled_at: iso ?? (f.channel === 'walkin' ? new Date().toISOString() : null),
          duration_min: Number(f.duration_min) || null, address: f.channel === 'home' ? f.address : null,
          stylists_needed: Number(f.stylists_needed) || 1, transport_fee: f.channel === 'home' ? Number(f.transport_fee) || 0 : 0,
          notes: f.notes || null, ...(status ? { status } : {}),
          hair_source: f.channel === 'home' ? f.hair_source : null,
          hair_items: f.channel === 'home' && f.hair_source === 'salon' ? f.hair : [],
        },
        services, this.staffSel,
      );
      if (!f.id && f.channel !== 'walkin' && dep.amount && dep.amount > 0) {
        await this.data.addDeposit(id, dep);
      }
      this.ui.toast(f.channel === 'walkin' ? 'Added to the queue' : 'Booking saved');
      this.form.set(null);
      if (f.channel === 'walkin') this.tab.set('queue');
      else if (iso) this.day.set(startOfDay(new Date(iso)));
      this.load();
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  // ----- actions -----
  /** Check in; before the booking day a reason is required and the booking moves to today. */
  async start(b: Booking) {
    try {
      if (await checkIn(this.data, this.ui, b)) await this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }
  checkout(b: Booking) {
    this.router.navigate(['/checkout'], { queryParams: { booking: b.id } });
  }
  async cancel(b: Booking) {
    const reason = await this.ui.prompt('Cancel booking', 'Reason (required)');
    if (!reason) return;
    await this.act(() => this.data.setBookingStatus(b.id, 'cancelled', { cancel_reason: reason }), 'Cancelled');
  }
  async noShow(b: Booking) {
    const dep = this.deposits(b);
    const ok = await this.ui.confirm('Mark as no-show?', dep > 0 ? `The ${dep.toLocaleString('en-KE')} KSh paid is kept (non-refundable).` : 'No payment was made for this booking.');
    if (ok) await this.act(() => this.data.setBookingStatus(b.id, 'no_show'), 'Marked as no-show');
  }
  async confirmRequest(b: Booking) {
    const note = await this.ui.prompt('Confirm booking', 'Message to the client (optional)');
    if (note === null) return;
    try {
      const status = await this.data.confirmBooking(b.id, note || null);
      this.ui.toast(status === 'booked' ? 'Booking confirmed' : 'Confirmed – waiting for the deposit');
      this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }
  async declineRequest(b: Booking) {
    const reason = await this.ui.prompt('Decline request', 'Reason / suggest another time (required)');
    if (!reason) return;
    const paid = this.deposits(b);
    const msg = paid > 0 ? `Declined – refund ${paid.toLocaleString('en-KE')} KSh to the client` : 'Declined';
    await this.act(() => this.data.declineBooking(b.id, reason), msg);
  }
  private async act(fn: () => Promise<unknown>, msg: string) {
    try {
      await fn();
      this.ui.toast(msg);
      this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }
}
