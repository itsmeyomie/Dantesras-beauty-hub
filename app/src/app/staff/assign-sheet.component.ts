import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { IonContent, IonModal } from '@ionic/angular';
import { DataService } from '../core/data.service';
import { Booking } from '../core/models';
import { TeamMember, clientName, isFinisher, isMain, teamAt } from '../core/team';
import { Ui, dayRange, startOfDay } from '../core/ui';

/**
 * Give a booking, request or walk-in to a stylist, and optionally a finisher.
 * Shows everyone as Free / Busy / In chair for that booking's time, free ones first.
 */
@Component({
  selector: 'app-assign-sheet',
  imports: [DatePipe, IonModal, IonContent],
  template: `
    <ion-modal [isOpen]="!!booking()" (didDismiss)="closed.emit()" [initialBreakpoint]="0.9" [breakpoints]="[0, 0.9, 1]" class="portal">
      <ng-template>
        <ion-content>
          @if (booking(); as b) {
            <div class="p-wrap" style="padding-top:18px" data-testid="assign-sheet">
              <div class="p-kicker">Assign stylist</div>
              <h2 class="p-display" style="font-size:1.6rem;margin:4px 0 2px">Who will serve <strong>{{ name(b) }}</strong>?</h2>
              <p class="p-muted p-small" style="margin:0 0 12px">
                {{ b.scheduled_at ? (b.scheduled_at | date: 'EEE d MMM · HH:mm') : 'Walk-in · now' }} · {{ minutes() }} min
                @if (b.stylists_needed > 1) { · needs {{ b.stylists_needed }} stylists }
              </p>
              @if (loading()) {
                @for (i of [1, 2, 3]; track i) { <div class="p-skeleton" style="height:64px;margin-bottom:8px"></div> }
              } @else {
                @if (finishers().length) { <div class="p-h2" style="margin-top:4px">Main stylist</div> }
                @for (m of mains(); track m.staff.id) {
                  <button class="p-assign {{ m.state }}" [class.on]="picked().includes(m.staff.id)" (click)="toggle(m.staff.id)"
                    [attr.data-testid]="'assign-' + m.staff.id" [attr.data-state]="m.state">
                    <span class="ph">@if (m.staff.photo) { <img [src]="m.staff.photo" alt="" /> } @else { {{ m.staff.name.charAt(0) }} }</span>
                    <span class="p-spacer"><b>{{ m.staff.name }}</b>
                      <span class="p-muted p-small" style="display:block">{{ m.staff.specialty || 'Stylist' }}</span></span>
                    <span class="p-badge {{ m.state === 'free' ? 'ok' : 'bad' }}">{{ m.state === 'free' ? 'Free' : m.label }}</span>
                  </button>
                } @empty { <div class="p-empty">No active stylists. Add them under Team.</div> }

                @if (finishers().length) {
                  <div class="p-h2">Finisher <span class="p-muted p-small" style="font-weight:400">· finishes the braids / work</span></div>
                  @for (m of finishers(); track m.staff.id) {
                    <button class="p-assign {{ m.state }}" [class.on]="finisher() === m.staff.id" (click)="toggleFinisher(m.staff.id)"
                      [attr.data-testid]="'finisher-' + m.staff.id" [attr.data-state]="m.state">
                      <span class="ph">@if (m.staff.photo) { <img [src]="m.staff.photo" alt="" /> } @else { {{ m.staff.name.charAt(0) }} }</span>
                      <span class="p-spacer"><b>{{ m.staff.name }}</b>
                        <span class="p-muted p-small" style="display:block">{{ m.staff.specialty || roleOf(m) }}</span></span>
                      <span class="p-badge {{ m.state === 'free' ? 'ok' : 'bad' }}">{{ m.state === 'free' ? 'Free' : m.label }}</span>
                    </button>
                  }
                  <p class="p-muted p-small" style="margin:2px 4px 0">Optional. The finisher shares the commission at checkout.</p>
                }

                @if (clash().length) {
                  <div class="p-note" data-testid="assign-clash" style="margin-top:10px">{{ clash().join(' & ') }} {{ clash().length === 1 ? 'is' : 'are' }} occupied at that time – the client may have to wait.</div>
                }
                <div class="p-row" style="margin-top:14px;gap:8px">
                  <button class="p-btn ghost" style="flex:1" (click)="closed.emit()">Cancel</button>
                  <button class="p-btn" style="flex:2" (click)="save()" [disabled]="busy() || (!picked().length && !finisher() && !(b.booking_staff ?? []).length)" data-testid="assign-save">
                    {{ saveText(b) }}</button>
                </div>
              }
            </div>
          }
        </ion-content>
      </ng-template>
    </ion-modal>
  `,
})
export class AssignSheetComponent {
  private data = inject(DataService);
  private ui = inject(Ui);
  readonly booking = input<Booking | null>(null);
  readonly done = output<string[]>();
  readonly closed = output<void>();
  readonly around = signal<Booking[]>([]);
  readonly picked = signal<string[]>([]);
  readonly finisher = signal<string | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  name = clientName;

  readonly minutes = computed(() => this.booking()?.duration_min ?? 60);
  readonly start = computed(() => {
    const b = this.booking();
    return b?.scheduled_at ? new Date(b.scheduled_at).getTime() : Date.now();
  });
  private readonly team = computed(() =>
    teamAt(this.data.staff(), this.around(), this.start(), this.minutes(), this.booking()?.id, Date.now(), this.data.roles()));
  readonly mains = computed(() => this.team().filter((m) => isMain(m.staff, this.data.roles())));
  readonly finishers = computed(() => this.team().filter((m) => isFinisher(m.staff, this.data.roles())));
  readonly clash = computed(() => {
    const chosen = [...this.picked(), this.finisher()];
    return this.team().filter((m) => m.state !== 'free' && chosen.includes(m.staff.id)).map((m) => m.staff.name.split(' ')[0]);
  });
  private first = (id: string | null) => this.data.staff().find((s) => s.id === id)?.name.split(' ')[0] ?? '';

  constructor() {
    effect(() => {
      const b = this.booking();
      if (b) void this.load(b);
    });
  }
  private async load(b: Booking) {
    const st = b.booking_staff ?? [];
    this.picked.set(st.filter((s) => s.part !== 'finisher').map((s) => s.staff_id));
    this.finisher.set(st.find((s) => s.part === 'finisher')?.staff_id ?? null);
    this.loading.set(true);
    try {
      const [from, to] = dayRange(startOfDay(new Date(this.start())));
      this.around.set(await this.data.activeToday(from, to));
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.loading.set(false);
    }
  }
  roleOf(m: TeamMember) {
    const r = this.data.roles().find((x) => x.finishes && m.staff.roles.includes(x.key));
    return r?.name ?? 'Finisher';
  }
  saveText(b: Booking) {
    const names = this.picked().map((id) => this.first(id)).join(' & ');
    if (!this.picked().length && !this.finisher()) return (b.booking_staff ?? []).length ? 'Remove stylist' : 'Pick a stylist';
    return 'Assign ' + [names, this.finisher() ? 'finisher ' + this.first(this.finisher()) : ''].filter(Boolean).join(' + ');
  }
  toggle(id: string) {
    const many = (this.booking()?.stylists_needed ?? 1) > 1;
    this.picked.update((p) => (p.includes(id) ? p.filter((x) => x !== id) : many ? [...p, id] : [id]));
    if (this.finisher() === id) this.finisher.set(null);
  }
  toggleFinisher(id: string) {
    this.finisher.update((f) => (f === id ? null : id));
    this.picked.update((p) => p.filter((x) => x !== id));
  }
  async save() {
    const b = this.booking();
    if (!b) return;
    this.busy.set(true);
    try {
      const f = this.finisher();
      await this.data.setBookingStaff(b.id, this.picked(), f ? [f] : []);
      const who = this.picked().map((id) => this.first(id)).join(' & ');
      this.ui.toast(who || f ? `Assigned to ${[who, f ? 'finisher ' + this.first(f) : ''].filter(Boolean).join(' + ')}` : 'Stylist removed');
      this.done.emit(this.picked());
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
