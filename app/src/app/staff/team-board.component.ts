import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { DataService } from '../core/data.service';
import { Booking } from '../core/models';
import { TeamMember, clientName, teamNow } from '../core/team';

/** "Team now": every stylist as Free / Booked / In chair, tap one to see their day. */
@Component({
  selector: 'app-team-board',
  imports: [DatePipe],
  template: `
    <div class="p-card" data-testid="team-board">
      <div class="p-row">
        <div class="p-kicker p-spacer">Team now</div>
        <span class="p-badge ok" data-testid="team-free">{{ free() }} free</span>
        <span class="p-badge bad" data-testid="team-busy">{{ team().length - free() }} occupied</span>
      </div>
      <div class="p-team">
        @for (m of team(); track m.staff.id) {
          <button class="p-team-m {{ m.state }}" [class.on]="open() === m.staff.id" (click)="toggle(m)"
            [attr.data-testid]="'team-' + m.staff.id" [attr.data-state]="m.state">
            <span class="ph">@if (m.staff.photo) { <img [src]="m.staff.photo" alt="" /> } @else { {{ m.staff.name.charAt(0) }} }</span>
            <span class="n">{{ m.staff.name.split(' ')[0] }}</span>
            @if (m.finisher) { <span class="f">Finisher</span> }
            <span class="s">{{ m.state === 'free' ? 'Free' : m.state === 'chair' ? 'In chair' : 'Booked' }}</span>
          </button>
        } @empty { <div class="p-muted p-small">No active stylists yet.</div> }
      </div>
      @if (selected(); as m) {
        <div class="p-team-day" data-testid="team-day">
          <div class="p-small"><b>{{ m.staff.name }}</b> · {{ m.label }}</div>
          @for (b of m.day; track b.id) {
            <div class="p-list-line"><span>{{ (b.started_at && b.status === 'in_progress' ? b.started_at : b.scheduled_at) | date: 'HH:mm' }} · {{ name(b) }}</span>
              <span class="p-muted p-small">{{ b.status === 'in_progress' ? 'in chair' : b.status === 'requested' ? 'request' : (b.duration_min ?? 60) + ' min' }}</span></div>
          } @empty { <div class="p-muted p-small" style="padding:6px 0">Nothing booked today.</div> }
        </div>
      }
    </div>
  `,
})
export class TeamBoardComponent {
  private data = inject(DataService);
  /** today's bookings and the walk-in queue */
  readonly bookings = input<Booking[]>([]);
  /** current time; pass a ticking signal so the board refreshes */
  readonly now = input<number>(Date.now());
  readonly open = signal<string | null>(null);
  readonly team = computed(() => teamNow(this.data.staff(), this.bookings(), this.now(), this.data.roles()));
  readonly free = computed(() => this.team().filter((m) => m.state === 'free').length);
  readonly selected = computed(() => this.team().find((m) => m.staff.id === this.open()) ?? null);
  name = clientName;

  toggle(m: TeamMember) {
    this.open.update((id) => (id === m.staff.id ? null : m.staff.id));
  }
}
