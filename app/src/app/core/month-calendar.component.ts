import { Component, OnInit, computed, input, output, signal } from '@angular/core';
import { ymd } from './ui';

export type DayState = 'open' | 'full' | 'closed' | 'none';

/**
 * A real month calendar (Mon–Sun grid) used by the client app and the staff Bookings page.
 * - `value`: chosen day 'YYYY-MM-DD'
 * - `min` / `max`: limits (days outside can't be picked)
 * - `states`: per-day availability from the database (full / closed are greyed out)
 * - `counts`: small number badge per day (staff: bookings that day)
 */
@Component({
  selector: 'app-month-calendar',
  template: `
    <div class="cal">
      <div class="head">
        <button type="button" class="nav" (click)="move(-1)" [disabled]="!canPrev()" aria-label="Previous month"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
        <div class="title" data-testid="cal-month">{{ title() }}</div>
        <button type="button" class="nav" (click)="move(1)" [disabled]="!canNext()" aria-label="Next month"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>
      </div>
      <div class="grid wd">@for (d of weekdays; track d) { <div>{{ d }}</div> }</div>
      <div class="grid">
        @for (c of cells(); track c.key) {
          @if (c.day) {
            <button type="button" class="day" [class.today]="c.key === today" [class.sel]="c.key === value()"
              [class.full]="c.state === 'full'" [disabled]="c.disabled" (click)="pick(c.key)"
              [attr.aria-label]="c.label" [attr.data-date]="c.key" [attr.aria-pressed]="c.key === value()">
              <span>{{ c.day }}</span>
              @if (c.count) { <i class="count">{{ c.count }}</i> }
              @else if (c.state === 'full') { <i class="dot"></i> }
            </button>
          } @else { <div></div> }
        }
      </div>
      @if (legend()) {
        <div class="legend"><span><i class="sw sel"></i>Chosen</span><span><i class="sw today"></i>Today</span><span><i class="sw full"></i>Fully booked</span></div>
      }
    </div>
  `,
  styles: `
    :host { display: block; --cal-accent: #7b1e2e; --cal-ink: #161214; --cal-muted: #9a8f86; }
    .cal { background: rgba(255,255,255,.62); backdrop-filter: blur(10px); border-radius: 28px; padding: 14px 10px 10px;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.9), 0 10px 30px rgba(74,15,27,.08); }
    .head { display: flex; align-items: center; justify-content: space-between; margin: 0 4px 10px; }
    .title { font: 600 1.1rem/1.2 'Playfair Display', Georgia, serif; color: var(--cal-ink); }
    .nav { width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(255,255,255,.85); color: var(--cal-ink); display: grid; place-items: center;
      cursor: pointer; box-shadow: inset 0 0 0 1px rgba(255,255,255,.9), 0 3px 10px rgba(74,15,27,.08); }
    .nav:disabled { opacity: .3; cursor: default; }
    .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
    .wd div { text-align: center; font: 500 .72rem 'Inter', sans-serif; color: var(--cal-muted); padding: 2px 0 6px; }
    .day { position: relative; width: 100%; max-width: 46px; aspect-ratio: 1 / 1; margin: 0 auto; border: 0; border-radius: 50%; background: rgba(255,255,255,.85);
      color: var(--cal-ink); font: 500 .92rem 'Inter', sans-serif; cursor: pointer; display: grid; place-items: center;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.95); transition: transform .12s ease, background .12s ease; }
    .day:hover:not(:disabled) { transform: scale(1.06); }
    .day:disabled { background: transparent; box-shadow: none; color: #cfc4ba; cursor: default; }
    .day.today { background: conic-gradient(from 200deg, #7b1e2e, #c9a227, #e2a0ae, #7b1e2e); color: #fff; font-weight: 600; box-shadow: none; }
    .day.today:disabled { color: #fff; opacity: .55; }
    .day.sel { background: var(--cal-ink); color: #f1d27a; font-weight: 600; box-shadow: 0 6px 14px rgba(22,18,20,.3); }
    .day.full:not(.sel) { text-decoration: line-through; }
    .dot { position: absolute; bottom: 4px; width: 4px; height: 4px; border-radius: 50%; background: #c62828; }
    .count { position: absolute; top: -3px; right: -3px; min-width: 17px; height: 17px; border-radius: 9px; background: #7b1e2e; color: #f1d27a;
      font: 700 .6rem/17px 'Inter', sans-serif; font-style: normal; padding: 0 4px; }
    .legend { display: flex; gap: 14px; justify-content: center; margin-top: 10px; font: 500 .72rem 'Inter', sans-serif; color: var(--cal-muted); flex-wrap: wrap; }
    .legend span { display: inline-flex; align-items: center; gap: 5px; }
    .sw { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .sw.sel { background: var(--cal-ink); } .sw.today { background: conic-gradient(from 200deg, #7b1e2e, #c9a227, #e2a0ae, #7b1e2e); } .sw.full { background: #e7dfd3; }
  `,
})
export class MonthCalendarComponent implements OnInit {
  readonly value = input<string | null>(null);
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  readonly states = input<Record<string, DayState>>({});
  readonly counts = input<Record<string, number>>({});
  readonly legend = input(false);
  readonly picked = output<string>();
  /** first day of the shown month, 'YYYY-MM-01' */
  readonly monthChange = output<string>();

  readonly weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  readonly today = ymd(new Date());
  readonly month = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  readonly title = computed(() => this.month().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }));
  readonly canPrev = computed(() => !this.min() || ymd(new Date(this.month().getFullYear(), this.month().getMonth(), 0)) >= this.min()!);
  readonly canNext = computed(() => !this.max() || ymd(new Date(this.month().getFullYear(), this.month().getMonth() + 1, 1)) <= this.max()!);
  readonly cells = computed(() => {
    const m = this.month();
    const lead = (m.getDay() + 6) % 7; // Monday first
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const out: { key: string; day: number; disabled: boolean; state?: DayState; count?: number; label: string }[] = [];
    for (let i = 0; i < lead; i++) out.push({ key: `b${i}`, day: 0, disabled: true, label: '' });
    for (let d = 1; d <= days; d++) {
      const date = new Date(m.getFullYear(), m.getMonth(), d);
      const key = ymd(date);
      const state = this.states()[key];
      const disabled = (!!this.min() && key < this.min()!) || (!!this.max() && key > this.max()!) || state === 'closed' || state === 'full' || state === 'none';
      out.push({ key, day: d, disabled, state, count: this.counts()[key], label: date.toDateString() + (state === 'full' ? ' – fully booked' : '') });
    }
    return out;
  });

  ngOnInit() {
    const v = this.value();
    if (v) this.month.set(new Date(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, 1));
    this.monthChange.emit(ymd(this.month()));
  }
  move(n: number) {
    const m = this.month();
    this.month.set(new Date(m.getFullYear(), m.getMonth() + n, 1));
    this.monthChange.emit(ymd(this.month()));
  }
  /** Jump to the month of a date (e.g. staff pressing "Today"). */
  show(dateKey: string) {
    const m = new Date(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)) - 1, 1);
    if (ymd(m) !== ymd(this.month())) {
      this.month.set(m);
      this.monthChange.emit(ymd(m));
    }
  }
  pick(key: string) {
    this.picked.emit(key);
  }
}
