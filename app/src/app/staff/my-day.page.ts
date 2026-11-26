import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonRefresher, IonRefresherContent, ViewWillEnter, ViewWillLeave } from '@ionic/angular';
import { DataService } from '../core/data.service';
import { Booking } from '../core/models';
import { StaffAuthService } from '../core/staff-auth.service';
import { KshPipe, Ui, dayRange, startOfDay } from '../core/ui';
import { StaffHeaderComponent } from './staff-header.component';
import { TeamBoardComponent } from './team-board.component';
import { isMain } from '../core/team';
import { checkIn } from '../core/checkin';
import { acceptRequest, declineRequest } from '../core/answer-request';

export const isMine = (b: Booking, id?: string) => !!id && (b.booking_staff ?? []).some((s) => s.staff_id === id);
export const bookingValue = (b: Booking) => (b.booking_services ?? []).reduce((a, s) => a + Number(s.price), 0) + Number(b.transport_fee ?? 0);
export const bookingPaid = (b: Booking) => (b.payments ?? []).filter((p) => p.kind === 'deposit').reduce((a, p) => a + Number(p.amount), 0);
export const serviceNames = (b: Booking) => (b.booking_services ?? []).map((s) => s.name).join(', ') || 'Service not chosen yet';
export const STATUS: Record<string, { label: string; tone: string }> = {
  requested: { label: 'To confirm', tone: 'wait' }, pending: { label: 'Pending', tone: 'wait' }, booked: { label: 'Booked', tone: 'ok' },
  waiting: { label: 'Waiting', tone: 'wait' }, in_progress: { label: 'In chair', tone: 'info' }, completed: { label: 'Done', tone: 'done' },
  cancelled: { label: 'Cancelled', tone: 'bad' }, no_show: { label: 'No-show', tone: 'bad' }, declined: { label: 'Declined', tone: 'bad' },
};

/** Stylist home: next client, today's timeline, walk-ins to take. */
@Component({
  selector: 'app-my-day',
  host: { class: 'portal' },
  imports: [DatePipe, KshPipe, IonContent, IonRefresher, IonRefresherContent, StaffHeaderComponent, TeamBoardComponent],
  template: `
    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="refresh($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>
      <div class="p-wrap">
        <app-staff-header />
        <p class="p-hey">Hey <b>{{ auth.firstName() }}</b>, you have {{ todays().length }} client{{ todays().length === 1 ? '' : 's' }} today</p>
        <h1 class="p-display">My <span class="p-oo tint"></span><strong> day</strong></h1>

        @if (next(); as b) {
          <section class="p-feature" style="min-height:0;padding:18px 20px" data-testid="next-client">
            <div style="position:relative">
              <div class="p-kicker" style="color:var(--p-gold-soft)">{{ finishing(b) ? (b.status === 'in_progress' ? 'Finish now · with ' + mainOf(b) : 'Next finish · ' + when(b)) : b.status === 'in_progress' ? 'In your chair now' : 'Next · ' + when(b) }}</div>
              <div class="name" style="font:600 1.5rem 'Playfair Display',serif;margin:4px 0 2px">{{ b.clients?.name ?? b.guest_name }}</div>
              <div class="p-small" style="opacity:.88">{{ b.scheduled_at | date: 'HH:mm' }} · {{ names(b) }} · {{ value(b) | ksh }}{{ paid(b) ? ' · deposit ' + (paid(b) | ksh) : '' }}</div>
              <div class="row" style="display:flex;gap:10px;margin-top:14px;align-items:center">
                @if (finishing(b)) {
                  <span class="p-small" data-testid="next-finish">You finish {{ mainOf(b) }}'s work</span>
                } @else if (b.status === 'in_progress') {
                  <button class="p-pill-white" (click)="checkout(b)" data-testid="next-checkout">Finish · checkout</button>
                } @else if (b.status === 'requested') {
                  <button class="p-pill-white" (click)="accept(b)" data-testid="next-accept">Accept</button>
                  <button class="p-link" style="color:#fff;opacity:.9" (click)="decline(b)" data-testid="next-decline">Decline</button>
                } @else {
                  <button class="p-pill-white" (click)="start(b)" data-testid="next-start">Client arrived · start</button>
                }
                <span class="p-badge {{ status(b).tone }}" style="margin-left:auto;background:#fff">{{ status(b).label }}</span>
              </div>
            </div>
          </section>
        }

        <div class="p-h2" style="margin-top:20px">Today <a>{{ todays().length }} job{{ todays().length === 1 ? '' : 's' }} · {{ waiting().length }} walk-in{{ waiting().length === 1 ? '' : 's' }} waiting</a></div>
        <div class="p-card" style="padding:6px 14px">
          @for (b of todays(); track b.id) {
            <div class="p-tl" data-testid="my-job">
              <span class="dot {{ status(b).tone }}"></span>
              <span class="t">{{ b.scheduled_at | date: 'HH:mm' }}</span>
              <div class="p-spacer"><b>{{ b.clients?.name ?? b.guest_name }}</b>
                <div class="p-muted p-small">{{ names(b) }}{{ b.channel === 'home' ? ' · home · ' + b.address : '' }}</div>
                @if (finishing(b)) { <div class="p-small maroon" data-testid="finish-for">Finish for {{ mainOf(b) }}</div> }</div>
              @if (finishing(b)) { <span class="p-badge info">{{ b.status === 'in_progress' ? 'Finish now' : 'Finisher' }}</span> }
              @else if (b.status === 'in_progress') { <button class="p-btn small" (click)="checkout(b)">Checkout</button> }
              @else if (b.status === 'requested') {
                <button class="p-link" style="color:#9b1c1c" (click)="decline(b)" data-testid="job-decline">Decline</button>
                <button class="p-btn small" (click)="accept(b)" data-testid="job-accept">Accept</button>
              }
              @else if (['booked', 'pending', 'waiting'].includes(b.status)) { <button class="p-btn small ghost" (click)="start(b)">Start</button> }
              @else { <span class="p-badge {{ status(b).tone }}">{{ status(b).label }}</span> }
            </div>
          }
          @for (b of waiting(); track b.id) {
            <div class="p-tl" data-testid="walkin">
              <span class="dot wait"></span>
              <span class="t">Walk-in</span>
              <div class="p-spacer"><b>{{ b.clients?.name ?? b.guest_name }}</b>
                <div class="p-muted p-small">{{ names(b) }} · waiting {{ waited(b) }} min</div></div>
              <button class="p-btn small" (click)="take(b)" data-testid="take">Take</button>
            </div>
          }
          @if (!todays().length && !waiting().length) { <div class="p-empty">No clients for you yet today.</div> }
        </div>

        <app-team-board [bookings]="board()" [now]="now()" />
      </div>
    </ion-content>
  `,
})
export class MyDayPage implements ViewWillEnter, ViewWillLeave {
  private data = inject(DataService);
  readonly auth = inject(StaffAuthService);
  private ui = inject(Ui);
  private router = inject(Router);
  readonly all = signal<Booking[]>([]);
  readonly queue = signal<Booking[]>([]);
  readonly board = computed(() => [...this.all(), ...this.queue()]);
  readonly now = signal(Date.now());
  private timer?: ReturnType<typeof setInterval>;

  readonly todays = computed(() => {
    const id = this.auth.me()?.id;
    const mineToday = this.all().filter((b) => isMine(b, id) && !['cancelled', 'declined', 'no_show'].includes(b.status));
    const mineQueue = this.queue().filter((b) => isMine(b, id));
    return [...mineToday, ...mineQueue.filter((q) => !mineToday.some((b) => b.id === q.id))]
      .sort((a, b) => (a.scheduled_at ?? a.created_at).localeCompare(b.scheduled_at ?? b.created_at));
  });
  /** walk-ins nobody has taken yet – only for people who serve clients (not finishers only) */
  readonly waiting = computed(() => {
    const me = this.data.staff().find((s) => s.id === this.auth.me()?.id);
    if (me && !isMain(me, this.data.roles())) return [];
    return this.queue().filter((b) => b.status === 'waiting' && !(b.booking_staff ?? []).length);
  });
  readonly next = computed(() =>
    this.todays().find((b) => b.status === 'in_progress') ??
    this.todays().find((b) => ['booked', 'pending', 'requested', 'waiting'].includes(b.status)) ?? null);

  names = serviceNames;
  value = bookingValue;
  paid = bookingPaid;
  status(b: Booking) {
    return STATUS[b.status] ?? { label: b.status, tone: 'info' };
  }
  /** I am the finisher on this booking */
  finishing(b: Booking) {
    const id = this.auth.me()?.id;
    return (b.booking_staff ?? []).some((s) => s.staff_id === id && s.part === 'finisher');
  }
  /** first name(s) of the main stylist(s) */
  mainOf(b: Booking) {
    return (b.booking_staff ?? []).filter((s) => s.part !== 'finisher').map((s) => s.staff?.name?.split(' ')[0]).filter(Boolean).join(' & ') || 'the stylist';
  }
  when(b: Booking) {
    if (!b.scheduled_at) return 'walk-in';
    const min = Math.round((new Date(b.scheduled_at).getTime() - this.now()) / 60000);
    const span = (m: number) => (m >= 90 ? `${Math.round(m / 60)} h` : `${m} min`);
    return min > 0 ? `in ${span(min)}` : min > -30 ? 'now' : `${span(-min)} late`;
  }
  waited(b: Booking) {
    return Math.max(0, Math.round((this.now() - new Date(b.created_at).getTime()) / 60000));
  }

  ionViewWillEnter() {
    void this.load();
    this.timer = setInterval(() => { this.now.set(Date.now()); void this.load(true); }, 60_000);
  }
  ionViewWillLeave() {
    clearInterval(this.timer);
  }
  async load(quiet = false) {
    try {
      const [from, to] = dayRange(startOfDay(new Date()));
      const [b, q] = await Promise.all([this.data.bookingsBetween(from, to), this.data.walkinQueue()]);
      this.all.set(b);
      this.queue.set(q);
    } catch (e) {
      if (!quiet) this.ui.error(e);
    }
  }
  async refresh(ev: CustomEvent) {
    await this.load();
    (ev.target as HTMLIonRefresherElement).complete();
  }
  async start(b: Booking) {
    try {
      if (!(await checkIn(this.data, this.ui, b))) return;
      await this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }
  async accept(b: Booking) {
    if (await acceptRequest(this.data, this.ui, b)) await this.load();
  }
  async decline(b: Booking) {
    if (await declineRequest(this.data, this.ui, b)) await this.load();
  }
  async take(b: Booking) {
    try {
      await this.data.setBookingStaff(b.id, [this.auth.me()!.id]);
      await this.data.startBooking(b.id);
      this.ui.toast('Walk-in is yours');
      await this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }
  checkout(b: Booking) {
    void this.router.navigate(['/checkout'], { queryParams: { booking: b.id } });
  }
}
