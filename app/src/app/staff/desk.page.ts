import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent, IonRefresher, IonRefresherContent, ViewWillEnter, ViewWillLeave } from '@ionic/angular';
import { DataService } from '../core/data.service';
import { Booking } from '../core/models';
import { StaffAuthService } from '../core/staff-auth.service';
import { KshPipe, Ui, dayRange, startOfDay, ymd } from '../core/ui';
import { STATUS, bookingPaid, bookingValue, serviceNames } from './my-day.page';
import { StaffHeaderComponent } from './staff-header.component';
import { TeamBoardComponent } from './team-board.component';
import { crewNames } from '../core/team';
import { AssignSheetComponent } from './assign-sheet.component';

/** Receptionist home: quick actions, online requests to answer, walk-in queue, today's bookings. */
@Component({
  selector: 'app-desk',
  host: { class: 'portal' },
  imports: [DatePipe, RouterLink, KshPipe, IonContent, IonRefresher, IonRefresherContent, StaffHeaderComponent, TeamBoardComponent, AssignSheetComponent],
  template: `
    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="refresh($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>
      <div class="p-wrap">
        <app-staff-header />
        <p class="p-hey">Hey <b>{{ auth.firstName() }}</b>,</p>
        <h1 class="p-display" data-testid="desk-title">Front <strong>desk</strong></h1>
        <div class="p-row" style="margin-top:14px;gap:8px">
          <a class="p-btn gold" style="flex:1;padding:13px 0" routerLink="/bookings" [queryParams]="{ tab: 'queue', new: 'walkin' }" data-testid="desk-walkin">+ Walk-in</a>
          <a class="p-btn" style="flex:1;padding:13px 0;background:var(--p-ink);color:var(--p-gold-soft)" routerLink="/bookings" [queryParams]="{ new: 'salon' }" data-testid="desk-booking">+ Booking</a>
          <a class="p-btn ghost" style="flex:1;padding:13px 0" routerLink="/checkout">Checkout</a>
        </div>
        <div class="p-stats">
          <div class="p-stat"><small>Today's takings</small><b data-testid="takings">{{ takings() | ksh }}</b></div>
          <div class="p-stat"><small>Bookings</small><b>{{ todays().length }}</b></div>
          <div class="p-stat"><small>Waiting</small><b>{{ waiting().length }}</b></div>
        </div>

        <app-team-board [bookings]="board()" [now]="now()" />

        <div class="p-card" data-testid="desk-requests">
          <div class="p-row"><div class="p-kicker p-spacer">Online requests · {{ requests().length }}</div><span class="p-muted p-small">answer first</span></div>
          @for (b of requests(); track b.id) {
            <div style="padding:10px 0;border-bottom:1px solid rgba(123,30,46,.07)" data-testid="desk-request">
              <div class="p-row"><b class="p-spacer">{{ b.clients?.name ?? b.guest_name }}</b><span class="p-muted p-small">{{ data.phoneOf(b.client_id) }}</span></div>
              <div class="p-muted p-small">{{ b.scheduled_at | date: 'EEE d MMM · HH:mm' }} · {{ names(b) }} · paid {{ paid(b) | ksh }}</div>
              <div class="p-small" style="margin-top:2px">Stylist: <b>{{ stylist(b) || 'Any stylist' }}</b></div>
              <div class="p-row" style="margin-top:8px;gap:6px">
                <button class="p-link" style="color:#9b1c1c" (click)="decline(b)">Decline</button>
                <button class="p-btn small ghost" (click)="assigning.set(b)" data-testid="desk-assign">{{ stylist(b) ? 'Change stylist' : 'Assign' }}</button>
                <a class="p-btn small ghost" routerLink="/bookings" [queryParams]="{ tab: 'requests' }">Change time</a>
                <span class="p-spacer"></span>
                <button class="p-btn small" (click)="confirm(b)" data-testid="desk-confirm">Confirm</button>
              </div>
            </div>
          } @empty { <div class="p-muted p-small" style="padding:8px 0">No requests waiting.</div> }
        </div>

        <div class="p-card">
          <div class="p-kicker">Walk-in queue · {{ queue().length }}</div>
          @for (b of queue(); track b.id; let i = $index) {
            <div class="p-tl">
              <span class="t">#{{ i + 1 }}</span>
              <div class="p-spacer"><b>{{ b.clients?.name ?? b.guest_name }}</b>
                <div class="p-muted p-small">{{ names(b) }} · {{ waited(b) }} min</div></div>
              @if (b.status === 'waiting') {
                <button class="p-btn small" [class.ghost]="!!stylist(b)" (click)="assigning.set(b)" data-testid="queue-assign">{{ stylist(b) ? 'For ' + stylist(b) : 'Assign' }}</button>
              } @else { <span class="p-badge info">With {{ stylist(b) }}</span> }
            </div>
          } @empty { <div class="p-muted p-small" style="padding:8px 0">Nobody waiting.</div> }
        </div>

        <div class="p-h2">Today's bookings <a routerLink="/bookings">Open bookings</a></div>
        @for (b of todays(); track b.id) {
          <div class="p-card p-row">
            <span class="p-t">{{ b.scheduled_at | date: 'HH:mm' }}</span>
            <div class="p-spacer"><b>{{ b.clients?.name ?? b.guest_name }}</b>
              <div class="p-muted p-small">{{ names(b) }} · {{ value(b) | ksh }} · {{ stylist(b) || 'any stylist' }}</div></div>
            @if (b.status === 'in_progress') { <button class="p-btn small" (click)="checkout(b)">Checkout</button> }
            @else if (!stylist(b) && ['pending', 'booked'].includes(b.status)) { <button class="p-btn small" (click)="assigning.set(b)">Assign</button> }
            @else { <span class="p-badge {{ status(b).tone }}">{{ status(b).label }}</span> }
          </div>
        } @empty { <div class="p-empty">No bookings today.</div> }
      </div>
    </ion-content>
    <app-assign-sheet [booking]="assigning()" (closed)="assigning.set(null)" (done)="assigning.set(null); load()" />
  `,
})
export class DeskPage implements ViewWillEnter, ViewWillLeave {
  readonly data = inject(DataService);
  readonly auth = inject(StaffAuthService);
  private ui = inject(Ui);
  private router = inject(Router);
  readonly requests = signal<Booking[]>([]);
  readonly queue = signal<Booking[]>([]);
  readonly day = signal<Booking[]>([]);
  readonly takings = signal(0);
  readonly assigning = signal<Booking | null>(null);
  readonly board = computed(() => [...this.day(), ...this.queue()]);
  readonly now = signal(Date.now());
  private timer?: ReturnType<typeof setInterval>;
  readonly waiting = computed(() => this.queue().filter((b) => b.status === 'waiting'));
  readonly todays = computed(() => this.day().filter((b) => !['cancelled', 'declined'].includes(b.status)));
  names = serviceNames;
  value = bookingValue;
  paid = bookingPaid;

  status(b: Booking) {
    return STATUS[b.status] ?? { label: b.status, tone: 'info' };
  }
  stylist(b: Booking) {
    return crewNames(b, true);
  }
  waited(b: Booking) {
    return Math.max(0, Math.round((this.now() - new Date(b.created_at).getTime()) / 60000));
  }
  ionViewWillEnter() {
    void this.load();
    this.timer = setInterval(() => { this.now.set(Date.now()); void this.load(true); }, 30_000);
  }
  ionViewWillLeave() {
    clearInterval(this.timer);
  }
  async load(quiet = false) {
    const today = startOfDay(new Date());
    const [from, to] = dayRange(today);
    try {
      const [r, q, d, rep] = await Promise.all([
        this.data.onlineRequests(), this.data.walkinQueue(), this.data.bookingsBetween(from, to), this.data.report(ymd(today), ymd(today)),
      ]);
      this.requests.set(r);
      this.queue.set(q);
      void this.data.loadContacts([...r, ...q].map((x) => x.client_id));
      this.day.set(d);
      this.takings.set(Number(rep.collected.salon) + Number(rep.collected.school));
    } catch (e) {
      if (!quiet) this.ui.error(e);
    }
  }
  async refresh(ev: CustomEvent) {
    await this.load();
    (ev.target as HTMLIonRefresherElement).complete();
  }
  async confirm(b: Booking) {
    const note = await this.ui.prompt('Confirm booking', 'Message to the client (optional)');
    if (note === null) return;
    try {
      const st = await this.data.confirmBooking(b.id, note || null);
      this.ui.toast(st === 'booked' ? 'Booking confirmed' : 'Confirmed – waiting for the deposit');
      await this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }
  async decline(b: Booking) {
    const reason = await this.ui.prompt('Decline request', 'Reason / suggest another time (required)');
    if (!reason) return;
    try {
      await this.data.declineBooking(b.id, reason);
      this.ui.toast('Declined');
      await this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }
  checkout(b: Booking) {
    void this.router.navigate(['/checkout'], { queryParams: { booking: b.id } });
  }
}
