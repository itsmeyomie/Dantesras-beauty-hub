import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { IonContent, ViewWillEnter } from '@ionic/angular';
import { DataService } from '../core/data.service';
import { MonthCalendarComponent } from '../core/month-calendar.component';
import { Booking } from '../core/models';
import { StaffAuthService } from '../core/staff-auth.service';
import { KshPipe, Ui, ymd } from '../core/ui';
import { STATUS, bookingValue, isMine, serviceNames } from './my-day.page';
import { StaffHeaderComponent } from './staff-header.component';

/** Stylist: my bookings on a month calendar, and the chosen day's list. */
@Component({
  selector: 'app-my-calendar',
  host: { class: 'portal' },
  imports: [DatePipe, KshPipe, IonContent, MonthCalendarComponent, StaffHeaderComponent],
  template: `
    <ion-content>
      <div class="p-wrap">
        <app-staff-header />
        <h1 class="p-display" style="margin:14px 0"><strong>My</strong> calendar</h1>
        <app-month-calendar [value]="day()" [counts]="counts()" (picked)="day.set($event)" (monthChange)="loadMonth($event)" />
        <div class="p-h2">{{ day() | date: 'EEE d MMM' }} <a>{{ dayList().length }} booking{{ dayList().length === 1 ? '' : 's' }}</a></div>
        @for (b of dayList(); track b.id) {
          <div class="p-card p-row" data-testid="cal-booking">
            <span class="p-t">{{ b.scheduled_at | date: 'HH:mm' }}</span>
            <div class="p-spacer"><b>{{ b.online && b.status === 'requested' ? 'Online request · ' : '' }}{{ b.clients?.name ?? b.guest_name }}</b>
              <div class="p-muted p-small">{{ names(b) }} · {{ value(b) | ksh }}{{ b.channel === 'home' ? ' · home' : '' }}</div></div>
            <span class="p-badge {{ status(b).tone }}">{{ status(b).label }}</span>
          </div>
        } @empty { <div class="p-empty">Nothing booked for you this day.</div> }
      </div>
    </ion-content>
  `,
})
export class MyCalendarPage implements ViewWillEnter {
  private data = inject(DataService);
  private auth = inject(StaffAuthService);
  private ui = inject(Ui);
  readonly day = signal(ymd(new Date()));
  readonly month = signal<Booking[]>([]);
  private shown = '';
  readonly mine = computed(() => this.month().filter((b) => isMine(b, this.auth.me()?.id) && !['cancelled', 'declined'].includes(b.status)));
  readonly counts = computed(() => {
    const c: Record<string, number> = {};
    for (const b of this.mine()) if (b.scheduled_at) { const k = ymd(new Date(b.scheduled_at)); c[k] = (c[k] ?? 0) + 1; }
    return c;
  });
  readonly dayList = computed(() => this.mine().filter((b) => b.scheduled_at && ymd(new Date(b.scheduled_at)) === this.day())
    .sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!)));
  names = serviceNames;
  value = bookingValue;
  status(b: Booking) {
    return STATUS[b.status] ?? { label: b.status, tone: 'info' };
  }
  ionViewWillEnter() {
    if (this.shown) void this.loadMonth(this.shown);
  }
  async loadMonth(first: string) {
    this.shown = first;
    const start = new Date(`${first}T00:00:00`);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    try {
      const rows = await this.data.bookingsBetween(start.toISOString(), end.toISOString());
      if (this.shown === first) this.month.set(rows);
    } catch (e) {
      this.ui.error(e);
    }
  }
}
