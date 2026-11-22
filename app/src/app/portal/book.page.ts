import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonButtons, IonContent, IonHeader, IonIcon, IonSpinner, IonTitle, IonToolbar, ViewWillEnter } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, chevronBackOutline, businessOutline, carOutline, checkmarkOutline, closeOutline, homeOutline, personOutline } from 'ionicons/icons';
import { StkPushComponent } from '../core/stk-push.component';
import { KshPipe, Ui, addDays, ksh, ymd } from '../core/ui';
import { DayState, MonthCalendarComponent } from '../core/month-calendar.component';
import { CartItem, Draft, PCategory, PService, PortalService, priceText } from './portal.service';
import { PortalTabsComponent } from './portal-tabs.component';

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

@Component({
  selector: 'app-portal-book',
  host: { class: 'portal' },
  imports: [FormsModule, DatePipe, KshPipe, RouterLink, IonHeader, IonToolbar, IonButtons, IonTitle, IonContent, IonIcon, IonSpinner,
    StkPushComponent, PortalTabsComponent, MonthCalendarComponent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start">
        @if (step() > 1 && step() < 6) {
          <button class="p-glass-btn" style="margin-left:12px;width:42px;height:42px" (click)="back()" aria-label="Back"><ion-icon name="chevron-back-outline"></ion-icon></button>
        } @else if (step() === 1) {
          <a class="p-glass-btn" style="margin-left:12px;width:42px;height:42px" routerLink="/portal" aria-label="Home"><ion-icon name="chevron-back-outline"></ion-icon></a>
        }
      </ion-buttons>
      <ion-title>{{ titles[step() - 1] }}</ion-title>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="p-wrap" [class.with-sheet]="step() <= 5">
        @if (step() <= 5) { <div class="p-steps">@for (i of [1, 2, 3, 4, 5]; track i) { <i [class.on]="i <= step()"></i> }</div> }

        @switch (step()) {
          <!-- 1. services -->
          @case (1) {
            <h1 class="p-display" style="font-size:1.7rem;margin:6px 0 14px">Choose <strong>services</strong></h1>
            @if (p.catalog(); as c) {
              <div class="p-chips">
                @for (cat of c.categories; track cat.id) {
                  <button class="p-chip" [class.on]="cat.id === currentCategory()?.id" (click)="category.set(cat.id)">{{ cat.name }}</button>
                }
              </div>
              @if (currentCategory(); as cat) {
                @if (cat.client_type === 'kids') { <p class="p-muted p-small">For children aged 0 – {{ p.setting('kids_max_age', 12) }}.</p> }
                <div class="p-card" style="padding:4px 16px">
                  @for (s of cat.services; track s.id) {
                    <div class="p-service" [attr.data-service]="s.name">
                      <div class="p-spacer">
                        <div class="name">{{ s.name }}</div>
                        <div class="price">{{ price(s) }}</div>
                        @if (s.variants.length) {
                          <div class="p-variants">
                            <button class="p-chip" [class.on]="inCart(s.id, null)" (click)="toggle(cat, s, null)">Standard · {{ s.price | ksh }}</button>
                            @for (v of s.variants; track v.id) {
                              <button class="p-chip" [class.on]="inCart(s.id, v.id)" (click)="toggle(cat, s, v.id)">{{ v.name }} · {{ v.price | ksh }}</button>
                            }
                          </div>
                        }
                      </div>
                      @if (!s.variants.length) {
                        <button class="p-add" [class.on]="inCart(s.id, null)" (click)="toggle(cat, s, null)" [attr.aria-label]="(inCart(s.id, null) ? 'Remove ' : 'Add ') + s.name">
                          <ion-icon [name]="inCart(s.id, null) ? 'checkmark-outline' : 'add-outline'"></ion-icon>
                        </button>
                      }
                    </div>
                  }
                </div>
                <p class="p-muted p-small">Extension hair is not included – bring your own or buy it at the salon. Prices with a range are confirmed at the salon.</p>
              }
            } @else {
              @for (i of [1, 2, 3, 4, 5]; track i) { <div class="p-skeleton" style="height:64px;margin-bottom:10px"></div> }
            }
          }

          <!-- 2. where -->
          @case (2) {
            <h1 class="p-display" style="font-size:1.7rem;margin:6px 0 14px">Where <strong>to meet?</strong></h1>
            <div class="p-card tap" [class.selected]="d().channel === 'salon'" (click)="set('channel', 'salon')" data-testid="where-salon">
              <div class="p-row"><span class="p-round ink"><ion-icon name="business-outline"></ion-icon></span>
                <div class="p-spacer"><div style="font-weight:600">In-salon</div><div class="p-muted p-small">{{ p.setting('salon_location', 'Karuguru junction, Kamakis, Ruiru') }}</div></div></div>
            </div>
            <div class="p-card tap" [class.selected]="d().channel === 'home'" (click)="set('channel', 'home')" data-testid="where-home">
              <div class="p-row"><span class="p-round ink"><ion-icon name="car-outline"></ion-icon></span>
                <div class="p-spacer"><div style="font-weight:600">Home service</div><div class="p-muted p-small">We come to you. A transport fee is agreed with the salon.</div></div></div>
            </div>
            @if (d().channel === 'home') {
              <label class="p-field"><span>Where should we come?</span>
                <textarea class="p-input" [ngModel]="d().address" (ngModelChange)="set('address', $event)" placeholder="Estate, street, house / landmark" data-testid="address"></textarea></label>
            }
          }

          <!-- 3. book calendar -->
          @case (3) {
            <p class="p-sub-who">{{ d().staff_id ? stylistName() : 'Any stylist' }} <span>· {{ d().channel === 'home' ? 'Home service' : 'In-salon' }}</span></p>
            <h1 class="p-display" style="font-size:1.9rem;margin:0 0 14px"><strong>Bo<span class="p-oo"></span>k</strong> calendar</h1>
            <app-month-calendar [value]="d().date" [min]="today" [max]="lastDay()" [states]="monthStates()" [legend]="true"
              (picked)="pickDate($event)" (monthChange)="loadMonth($event)" />

            <div style="font-weight:600;font-size:1rem;margin:18px 2px 10px">Select a time</div>
            @if (d().date) {
              <div class="p-slots">
                @for (t of quickTimes(); track t) {
                  <button class="p-slot" [class.on]="d().time === t && !anyTime()" (click)="anyTime.set(false); typeTime(t)">{{ t }}</button>
                }
                <button class="p-slot any" [class.on]="anyTime()" (click)="anyTime.set(true)" data-testid="any-time">Any time</button>
              </div>
              @if (anyTime()) {
                <label class="p-field" style="margin-top:12px">
                  <span>{{ d().date | date: 'EEEE d MMMM' }}{{ hoursText() ? ' · open ' + hoursText() : '' }}</span>
                  <input class="p-input p-time-input" type="time" step="60" [min]="hours()?.open ?? null" [max]="lastStart()"
                    [value]="d().time ?? ''" (change)="typeTime($any($event.target).value)" (input)="typeTime($any($event.target).value, true)"
                    data-testid="time-input" aria-label="Time" />
                </label>
              }
              @if (checking()) {
                <div class="p-time-status p-muted">Checking…</div>
              } @else if (check(); as c) {
                @if (c.ok) {
                  <div class="p-time-status ok" data-testid="time-ok">✓ {{ d().time }} is available{{ d().staff_id ? ' with ' + stylistName() : '' }}</div>
                } @else {
                  <div class="p-time-status bad" data-testid="time-bad">{{ c.reason }}</div>
                  @if (c.suggestions?.length) {
                    <div class="p-small p-muted" style="margin:8px 0 6px">Nearest free times:</div>
                    <div class="p-slots">@for (s of c.suggestions; track s) { <button class="p-slot" (click)="typeTime(s)" data-testid="suggestion">{{ s }}</button> }</div>
                  }
                }
              }
            } @else { <p class="p-muted">Pick a day on the calendar first.</p> }
          }

          <!-- 4. choose stylist -->
          @case (4) {
            <h1 class="p-display" style="font-size:1.7rem;margin:6px 0 2px">Choose <strong>your stylist</strong></h1>
            <p class="p-muted p-small" style="margin:0 0 4px">Free at {{ d().time }} on {{ when() | date: 'EEE d MMM' }}</p>
            @if (stylists(); as list) {
              <div class="p-stylists">
                <button class="p-st" [class.on]="!d().staff_id" (click)="set('staff_id', null)" data-testid="stylist-any">
                  <div class="fl" style="--c:#161214"><b>✦</b></div><span class="state">Free</span>
                  <div class="n">Any stylist</div><div class="r">First free</div>
                </button>
                @for (s of list; track s.id; let i = $index) {
                  <button class="p-st" [class.on]="d().staff_id === s.id" [disabled]="!s.free" (click)="set('staff_id', s.id)" [attr.data-stylist]="s.name">
                    <div class="fl" [style.--c]="flowerColor(i)">@if (s.photo) { <img [src]="s.photo" [alt]="s.name" /> } @else { <b>{{ initials(s.name) }}</b> }</div>
                    <span class="state" [class.busy]="!s.free">{{ s.free ? 'Free' : 'Busy' }}</span>
                    <div class="n">{{ s.name }}</div><div class="r">{{ s.specialty || 'Stylist' }}</div>
                  </button>
                }
              </div>
            } @else {
              <div class="p-stylists">@for (i of [1, 2, 3, 4, 5, 6]; track i) { <div class="p-skeleton" style="height:130px;border-radius:22px"></div> }</div>
            }
          }

          <!-- 5. review -->
          @case (5) {
            <div class="p-card">
              <div class="p-kicker">Your appointment</div>
              <div style="font-weight:700;font-size:1.1rem;margin:6px 0 2px">{{ when() | date: 'EEEE d MMMM, HH:mm' }}</div>
              <div class="p-muted p-small">{{ d().channel === 'home' ? 'Home service · ' + d().address : 'In-salon' }} · {{ stylistName() }}</div>
              <div class="p-divider"></div>
              @for (i of d().items; track $index) {
                <div class="p-list-line"><span>{{ i.name }}</span><span>{{ i.approx ? 'from ' : '' }}{{ i.price | ksh }}</span></div>
              }
              <div class="p-list-line total"><span>Total{{ d().channel === 'home' ? ' (+ transport)' : '' }}</span><span>{{ p.cartTotal() | ksh }}</span></div>
            </div>
            <label class="p-field"><span>Anything we should know? (optional)</span>
              <textarea class="p-input" [ngModel]="d().notes" (ngModelChange)="set('notes', $event)" placeholder="e.g. hair length, colour, allergies"></textarea></label>
            <div class="p-note">
              <strong>How it works:</strong> send your request, then pay a <strong>{{ deposit() | ksh }}</strong> deposit by M-Pesa to hold the slot.
              The salon confirms your booking. Deposits are not refunded if you don't show up; if you're more than
              {{ p.setting('late_minutes', 20) }} minutes late we'll find you a new time.
            </div>
            @if (error()) { <div class="p-error">{{ error() }}</div> }
          }

          <!-- 6. pay deposit -->
          @case (6) {
            <div class="p-result" style="padding-top:6px">
              <div class="icon" style="background:#fff4d6;color:#8a5a00"><ion-icon name="checkmark-outline"></ion-icon></div>
              <h2>Request sent</h2>
              <p class="p-muted">Now pay the deposit to hold your slot on<br /><strong>{{ created()?.when | date: 'EEEE d MMM, HH:mm' }}</strong>.</p>
            </div>
            <div class="p-card">
              <app-stk-push purpose="deposit" audience="client" [bookingId]="created()!.id" [amount]="created()!.deposit"
                [maxAmount]="created()!.total" [phone]="p.me()?.phone ?? null" (paid)="step.set(7)" (cancelled)="step.set(7)" />
            </div>
            <button class="p-link" style="display:block;margin:6px auto" (click)="payLater()">Pay later</button>
          }

          <!-- 7. done -->
          @case (7) {
            <div class="p-result">
              <div class="icon"><ion-icon name="checkmark-outline"></ion-icon></div>
              <h2>You're all set{{ p.firstName() ? ', ' + p.firstName() : '' }}!</h2>
              <p class="p-muted">The salon will confirm your booking shortly. You'll see the status in My bookings.</p>
              <a class="p-btn block" routerLink="/portal/bookings" style="margin-top:18px">View my bookings</a>
              <a class="p-btn block ghost" routerLink="/portal" style="margin-top:10px">Back home</a>
            </div>
          }
        }
      </div>
    </ion-content>

    @if (step() <= 5) {
      <div class="p-sheet">
        <div class="in">
          @if (step() >= 3 && when()) {
            <div>
              <div class="big">{{ when() | date: 'MMM, d' }}</div>
              <div class="small">{{ d().time }} · {{ d().items.length }} service{{ d().items.length === 1 ? '' : 's' }} · {{ p.cartTotal() | ksh }}</div>
            </div>
          } @else {
            <div><div class="lbl">From</div><div class="big gold">{{ p.cartTotal() | ksh }}</div></div>
            <div><div class="lbl">Selected</div><div class="big">{{ d().items.length }}</div></div>
          }
          <button class="go" [class.white]="step() < 5" (click)="next()" [disabled]="!canNext() || busy()" data-testid="book-next">
            @if (busy()) { <ion-spinner name="dots"></ion-spinner> }
            @else if (step() === 5) { {{ p.signedIn() ? 'Send request' : 'Sign in & send' }} }
            @else { Next }
          </button>
        </div>
      </div>
    } @else {
      <app-portal-tabs />
    }
  `,
})
export class PortalBookPage implements ViewWillEnter {
  readonly p = inject(PortalService);
  private ui = inject(Ui);
  private router = inject(Router);
  /** ?category=<id> from the home screen, ?step=5 after signing in */
  readonly categoryParam = input<string>(undefined, { alias: 'category' });
  readonly stepParam = input<string>(undefined, { alias: 'step' });

  readonly titles = ['Choose services', 'Where', 'Book calendar', 'Choose stylist', 'Review', 'Deposit', 'Done'];
  readonly step = signal<Step>(1);
  readonly category = signal<string | null>(null);
  readonly monthStates = signal<Record<string, DayState>>({});
  readonly check = signal<{ ok: boolean; reason?: string; suggestions?: string[] } | null>(null);
  readonly checking = signal(false);
  /** "Any time" pill open → exact time box */
  readonly anyTime = signal(false);
  /** stylists with free / busy at the chosen time */
  readonly stylists = signal<{ id: string; name: string; free: boolean; photo?: string | null; specialty?: string | null }[] | null>(null);
  readonly today = ymd(new Date());
  private monthShown = '';
  private checkSeq = 0;
  readonly busy = signal(false);
  readonly error = signal('');
  readonly created = signal<{ id: string; total: number; deposit: number; when: Date | null } | null>(null);
  readonly d = this.p.draft;

  readonly currentCategory = computed(() => this.p.catalog()?.categories.find((c) => c.id === this.category()) ?? this.p.catalog()?.categories[0] ?? null);
  readonly deposit = computed(() => Math.min(this.p.depositMin(), this.p.cartTotal()));
  readonly when = computed(() => (this.d().date && this.d().time ? new Date(`${this.d().date}T${this.d().time}:00`) : null));
  readonly stylistName = computed(() => this.p.catalog()?.stylists.find((s) => s.id === this.d().staff_id)?.name ?? 'Any stylist');
  readonly lastDay = computed(() => ymd(addDays(new Date(), Number(this.p.setting('online_days_ahead', 30)))));
  /** opening hours of the chosen day */
  readonly hours = computed(() => {
    const date = this.d().date;
    if (!date) return null;
    const h = this.p.setting<{ mon_sat?: { open: string; close: string }; sun?: { open: string; close: string } }>('salon_hours', {});
    return (new Date(`${date}T12:00:00`).getDay() === 0 ? h.sun : h.mon_sat) ?? null;
  });
  /** last time a booking can start (1 hour before closing) */
  readonly lastStart = computed(() => {
    const h = this.hours();
    if (!h) return null;
    const [hh, mm] = h.close.split(':').map(Number);
    const m = hh * 60 + mm - 60;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  });
  readonly hoursText = computed(() => (this.hours() ? `${this.hours()!.open}–${this.hours()!.close}` : ''));
  /** one-tap times inside the day's hours: morning, midday, afternoon */
  readonly quickTimes = computed(() => {
    const h = this.hours();
    const last = this.lastStart();
    if (!h || !last) return [];
    return ['09:00', '10:30', '12:00', '14:00', '15:30', '17:00'].filter((t) => t >= h.open && t <= last).slice(0, 5);
  });

  private readonly flowerColors = ['#7b1e2e', '#c9a227', '#b4545f', '#8a6a12', '#4a0f1b', '#a3324a', '#6b5a2e'];

  constructor() {
    addIcons({ addOutline, checkmarkOutline, chevronBackOutline, businessOutline, carOutline, homeOutline, personOutline, closeOutline });
  }

  async ionViewWillEnter() {
    try {
      await this.p.loadCatalog();
      if (this.p.signedIn() && !this.p.me()) await this.p.loadMe();
    } catch (e) {
      this.ui.error(e);
    }
    if (this.categoryParam()) this.category.set(this.categoryParam()!);
    if (this.step() >= 6) { this.step.set(1); this.created.set(null); }
    if (this.stepParam() === '5' && this.d().items.length && this.d().time) this.step.set(5);
    const t = this.d().time;
    if (t && !this.quickTimes().includes(t)) this.anyTime.set(true);
    if (this.step() === 3 && t) void this.checkTime();
  }

  price(s: PService) {
    return priceText(s, ksh);
  }
  initials(name: string) {
    return name.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
  }
  flowerColor(i: number) {
    return this.flowerColors[i % this.flowerColors.length];
  }
  inCart(serviceId: string, variantId: string | null) {
    return this.d().items.some((i) => i.service_id === serviceId && i.variant_id === variantId);
  }
  toggle(cat: PCategory, s: PService, variantId: string | null) {
    if (this.inCart(s.id, variantId)) {
      this.p.updateDraft((d) => ({ ...d, items: d.items.filter((i) => !(i.service_id === s.id && i.variant_id === variantId)) }));
      return;
    }
    const v = s.variants.find((x) => x.id === variantId);
    const item: CartItem = {
      service_id: s.id, variant_id: variantId,
      name: `${cat.client_type === 'kids' ? 'Kids ' : ''}${s.name}${v ? ' – ' + v.name : ''}`,
      price: Number(v ? v.price : s.price), approx: !v && s.price_type !== 'fixed',
    };
    // one option per service
    this.p.updateDraft((d) => ({ ...d, items: [...d.items.filter((i) => i.service_id !== s.id), item] }));
  }
  set<K extends keyof Draft>(key: K, value: Draft[K]) {
    this.p.updateDraft((d) => ({ ...d, [key]: value }));
  }
  /** availability of every day in the shown month (closed / fully booked are greyed out) */
  async loadMonth(first: string) {
    this.monthShown = first;
    try {
      const states = await this.p.month(first, this.d().staff_id);
      if (this.monthShown === first) this.monthStates.update((s) => ({ ...s, ...states }));
    } catch (e) {
      this.ui.error(e);
    }
  }
  async pickDate(value: string) {
    this.p.updateDraft((d) => ({ ...d, date: value }));
    if (this.d().time) await this.checkTime();
  }
  /** any time, to the minute; `typing` = still typing, check without disturbing */
  async typeTime(value: string, typing = false) {
    if (!value) {
      this.p.updateDraft((d) => ({ ...d, time: null }));
      this.check.set(null);
      return;
    }
    this.p.updateDraft((d) => ({ ...d, time: value.slice(0, 5) }));
    if (!typing || value.length >= 5) await this.checkTime();
  }
  async checkTime() {
    const { date, time, staff_id } = this.d();
    if (!date || !time) return;
    const seq = ++this.checkSeq;
    this.checking.set(true);
    try {
      const r = await this.p.checkTime(date, time, staff_id);
      if (seq === this.checkSeq) this.check.set(r);
    } catch (e) {
      this.ui.error(e);
    } finally {
      if (seq === this.checkSeq) this.checking.set(false);
    }
  }
  async loadStylists() {
    const { date, time } = this.d();
    if (!date || !time) return;
    this.stylists.set(null);
    try {
      const list = await this.p.stylistsAt(date, time);
      this.stylists.set(list);
      // a chosen stylist who became busy → back to "any"
      const sel = this.d().staff_id;
      if (sel && !list.find((s) => s.id === sel)?.free) this.set('staff_id', null);
    } catch (e) {
      this.ui.error(e);
    }
  }

  canNext(): boolean {
    const d = this.d();
    switch (this.step()) {
      case 1: return d.items.length > 0;
      case 2: return d.channel === 'salon' || d.address.trim().length > 3;
      case 3: return !!d.date && !!d.time && !!this.check()?.ok && !this.checking();
      case 4: return !!this.stylists();
      case 5: return true;
      default: return false;
    }
  }
  back() {
    if (this.step() <= 1) return;
    this.step.set((this.step() - 1) as Step);
    if (this.step() === 3 && this.d().time) void this.checkTime();
  }
  async next() {
    this.error.set('');
    const s = this.step();
    if (s === 2) {
      this.step.set(3);
      if (this.d().time) await this.checkTime();
      return;
    }
    if (s === 3) {
      this.step.set(4);
      await this.loadStylists();
      return;
    }
    if (s < 5) return this.step.set((s + 1) as Step);
    if (!this.p.signedIn()) {
      void this.router.navigate(['/portal/sign-in'], { queryParams: { returnUrl: '/portal/book?step=5' } });
      return;
    }
    this.busy.set(true);
    try {
      const r = await this.p.requestBooking(this.d());
      this.created.set({ ...r, when: this.when() });
      this.p.resetDraft();
      this.anyTime.set(false);
      this.step.set(6);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.error.set(msg);
      if (/taken|too soon|passed/i.test(msg)) {
        this.step.set(3);
        this.monthShown = '';
        await this.checkTime();
        this.ui.toast(msg, 'danger');
      }
    } finally {
      this.busy.set(false);
    }
  }
  payLater() {
    this.ui.toast('You can pay the deposit from My bookings', 'medium');
    this.step.set(7);
  }
}
