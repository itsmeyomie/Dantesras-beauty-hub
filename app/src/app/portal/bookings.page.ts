import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonContent, IonHeader, IonIcon, IonModal, IonRefresher, IonRefresherContent, IonTitle, IonToolbar, ViewWillEnter, ViewWillLeave,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { calendarClearOutline, carOutline, chatbubbleOutline } from 'ionicons/icons';
import { StkPushComponent } from '../core/stk-push.component';
import { KshPipe, Ui } from '../core/ui';
import { MyBooking, PortalService, STATUS_TEXT } from './portal.service';
import { PortalTabsComponent } from './portal-tabs.component';

@Component({
  selector: 'app-portal-bookings',
  host: { class: 'portal' },
  imports: [DatePipe, KshPipe, RouterLink, IonHeader, IonToolbar, IonTitle, IonContent, IonIcon, IonModal, IonRefresher, IonRefresherContent,
    StkPushComponent, PortalTabsComponent],
  template: `
    <ion-header><ion-toolbar><ion-title>My bookings</ion-title></ion-toolbar></ion-header>
    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="refresh($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>
      <div class="p-wrap">
        <div class="p-seg">
          <button type="button" [class.on]="tab() === 'upcoming'" (click)="tab.set('upcoming')">Upcoming ({{ upcoming().length }})</button>
          <button type="button" [class.on]="tab() === 'past'" (click)="tab.set('past')">Past</button>
        </div>
        @if (loading() && !list().length) {
          @for (i of [1, 2]; track i) { <div class="p-skeleton" style="height:128px;margin-bottom:12px"></div> }
        } @else {
          @for (b of shown(); track b.id) {
            <div class="p-card" data-testid="my-booking">
              <div class="p-appt">
                <div class="cal"><div class="n">{{ b.scheduled_at | date: 'd' }}</div><div class="m">{{ b.scheduled_at | date: 'MMM' }}</div></div>
                <div class="body">
                  <div class="when">{{ b.scheduled_at | date: 'EEEE, HH:mm' }}</div>
                  <div class="what">{{ names(b) }}</div>
                  <span class="p-badge {{ status(b).tone }}" data-testid="status">{{ status(b).label }}</span>
                  <div class="p-small p-muted" style="margin-top:8px">
                    @if (b.channel === 'home') { <ion-icon name="car-outline" style="vertical-align:-2px"></ion-icon> Home · {{ b.address }} · }
                    {{ b.stylists.length ? 'With ' + b.stylists.join(' & ') : 'Any stylist' }}
                  </div>
                  <div class="p-small" style="margin-top:4px">Total <strong>{{ b.total | ksh }}</strong> · paid <strong>{{ b.paid | ksh }}</strong></div>
                  @if (b.response_note) {
                    <div class="msg"><ion-icon name="chatbubble-outline" style="vertical-align:-2px"></ion-icon> Salon: {{ b.response_note }}</div>
                  }
                  @if (b.status === 'declined' && b.paid > 0) {
                    <div class="msg">The salon will refund your {{ b.paid | ksh }} deposit.</div>
                  }
                  @if (needsDeposit(b) || canCancel(b)) {
                    <div class="p-row" style="margin-top:12px;flex-wrap:wrap">
                      @if (needsDeposit(b)) { <button class="p-btn small" (click)="paying.set(b)">Pay deposit {{ depositFor(b) | ksh }}</button> }
                      @if (canCancel(b)) { <button class="p-btn small ghost" (click)="cancel(b)">Cancel</button> }
                    </div>
                  }
                </div>
              </div>
            </div>
          } @empty {
            <div class="p-empty">
              <ion-icon name="calendar-clear-outline"></ion-icon>
              {{ tab() === 'upcoming' ? 'No upcoming bookings.' : 'No past visits yet.' }}
              @if (tab() === 'upcoming') { <div style="margin-top:14px"><a class="p-btn" routerLink="/portal/book">Book now</a></div> }
            </div>
          }
        }
      </div>

      <ion-modal [isOpen]="!!paying()" (didDismiss)="paying.set(null)" [initialBreakpoint]="0.92" [breakpoints]="[0, 0.92]">
        <ng-template>
          <ion-content class="ion-padding portal">
            @if (paying(); as b) {
              <h3 class="p-serif" style="margin-top:6px">Deposit for {{ b.scheduled_at | date: 'EEE d MMM, HH:mm' }}</h3>
              <p class="p-muted p-small">Pay {{ depositFor(b) | ksh }} (or more, up to the full {{ b.total - b.paid | ksh }}) to hold your slot.</p>
              <app-stk-push purpose="deposit" audience="client" [bookingId]="b.id" [amount]="depositFor(b)" [maxAmount]="b.total - b.paid"
                [phone]="p.me()?.phone ?? null" (paid)="paying.set(null); load()" (cancelled)="paying.set(null)" />
            }
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
    <app-portal-tabs />
  `,
})
export class PortalBookingsPage implements ViewWillEnter, ViewWillLeave {
  readonly p = inject(PortalService);
  private ui = inject(Ui);
  readonly list = signal<MyBooking[]>([]);
  readonly loading = signal(false);
  readonly tab = signal<'upcoming' | 'past'>('upcoming');
  readonly paying = signal<MyBooking | null>(null);
  private poll?: ReturnType<typeof setInterval>;

  private readonly open = ['requested', 'pending', 'booked', 'waiting', 'in_progress'];
  readonly upcoming = computed(() =>
    this.list().filter((b) => this.open.includes(b.status) && new Date(b.scheduled_at).getTime() > Date.now() - 4 * 3600_000)
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
  );
  readonly past = computed(() => this.list().filter((b) => !this.upcoming().includes(b)));
  readonly shown = computed(() => (this.tab() === 'upcoming' ? this.upcoming() : this.past()));

  constructor() {
    addIcons({ calendarClearOutline, carOutline, chatbubbleOutline });
  }

  ionViewWillEnter() {
    void this.load();
    if (!this.p.me()) void this.p.loadMe().catch(() => undefined);
    void this.p.loadCatalog().catch(() => undefined);
    // the salon may confirm while the client is looking
    this.poll = setInterval(() => void this.load(true), 20_000);
  }
  ionViewWillLeave() {
    clearInterval(this.poll);
  }
  async load(quiet = false) {
    if (!quiet) this.loading.set(true);
    try {
      this.list.set(await this.p.bookings());
    } catch (e) {
      if (!quiet) this.ui.error(e);
    } finally {
      this.loading.set(false);
    }
  }
  async refresh(ev: CustomEvent) {
    await this.load();
    (ev.target as HTMLIonRefresherElement).complete();
  }

  names(b: MyBooking) {
    return b.services.map((s) => s.name).join(', ');
  }
  status(b: MyBooking) {
    return STATUS_TEXT[b.status] ?? { label: b.status, tone: 'info' as const };
  }
  depositFor(b: MyBooking) {
    return Math.max(0, Math.min(this.p.depositMin(), b.total) - b.paid);
  }
  needsDeposit(b: MyBooking) {
    return ['requested', 'pending'].includes(b.status) && this.depositFor(b) > 0 && new Date(b.scheduled_at).getTime() > Date.now();
  }
  canCancel(b: MyBooking) {
    return ['requested', 'pending', 'booked'].includes(b.status) && new Date(b.scheduled_at).getTime() > Date.now();
  }
  async cancel(b: MyBooking) {
    const msg = b.paid > 0 && b.status === 'booked'
      ? `Your ${b.paid.toLocaleString('en-KE')} KSh deposit is not refundable. Cancel anyway?`
      : 'Cancel this booking?';
    if (!(await this.ui.confirm('Cancel booking', msg, 'Cancel booking'))) return;
    try {
      await this.p.cancelBooking(b.id);
      this.ui.toast('Booking cancelled');
      await this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }
}
