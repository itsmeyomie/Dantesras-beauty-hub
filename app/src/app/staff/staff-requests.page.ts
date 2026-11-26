import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { DataService } from '../core/data.service';
import { IonContent, ViewWillEnter } from '@ionic/angular';
import { StaffAuthService, StaffMe } from '../core/staff-auth.service';
import { Ui } from '../core/ui';
import { StaffHeaderComponent } from './staff-header.component';

/** Owner: approve staff accounts and give the role. */
@Component({
  selector: 'app-staff-requests',
  host: { class: 'portal' },
  imports: [DatePipe, IonContent, StaffHeaderComponent],
  template: `
    <ion-content>
      <div class="p-wrap">
        <app-staff-header back="/more" />
        <h1 class="p-display">Staff <strong>requests</strong></h1>
        <div class="p-chips" style="margin-top:14px">
          <button class="p-chip" [class.on]="tab() === 'pending'" (click)="tab.set('pending')">Waiting · {{ pending().length }}</button>
          <button class="p-chip" [class.on]="tab() === 'declined'" (click)="tab.set('declined')">Declined · {{ declined().length }}</button>
        </div>
        @for (s of shown(); track s.id) {
          <div class="p-card" data-testid="staff-request" [attr.data-email]="s.email">
            <div class="p-row" style="align-items:flex-start">
              <div class="p-flower" [style.--c]="'#7b1e2e'">@if (s.photo) { <img [src]="s.photo" alt="" /> } @else { <b>{{ initials(s.name) }}</b> }</div>
              <div class="p-spacer">
                <div style="font-weight:700">{{ s.name }}</div>
                <div class="p-muted p-small">{{ s.email }}{{ s.phone ? ' · ' + s.phone : '' }}</div>
                <div class="p-small">Wants: <b>{{ label(s.wanted_role) }}</b>{{ s.specialty ? ' · ' + s.specialty : '' }}</div>
                <div class="p-muted p-small">Sent {{ s.requested_at | date: 'd MMM, HH:mm' }}</div>
                @if (s.decline_reason) { <div class="p-small" style="color:#9b1c1c">Declined: {{ s.decline_reason }}</div> }
              </div>
            </div>
            <div class="p-kicker" style="color:var(--p-muted);margin:12px 2px 6px">Give role</div>
            <div class="p-pills">
              @for (r of roles(); track r) {
                <button class="p-chip" [class.on]="roleFor(s) === r" (click)="setRole(s, r)" [attr.data-role]="r">{{ label(r) }}</button>
              }
            </div>
            <div class="p-row" style="margin-top:12px">
              @if (s.account_status === 'pending') { <button class="p-link" style="color:#9b1c1c" (click)="decline(s)" data-testid="decline">Decline</button> }
              <span class="p-spacer"></span>
              <button class="p-btn small" (click)="approve(s)" data-testid="approve">Approve as {{ label(roleFor(s)) }}</button>
            </div>
          </div>
        } @empty {
          <div class="p-empty">{{ tab() === 'pending' ? 'No staff requests waiting.' : 'Nothing declined.' }}</div>
        }
      </div>
    </ion-content>
  `,
})
export class StaffRequestsPage implements ViewWillEnter {
  private auth = inject(StaffAuthService);
  private ui = inject(Ui);
  private data = inject(DataService);
  readonly list = signal<StaffMe[]>([]);
  readonly tab = signal<'pending' | 'declined'>('pending');
  readonly chosen = signal<Record<string, string>>({});
  /** every role except owner (and tutor, which is given on the Team screen) */
  readonly roles = computed(() => this.data.roles().map((r) => r.key).filter((k) => k !== 'owner' && k !== 'tutor'));
  readonly pending = computed(() => this.list().filter((s) => s.account_status === 'pending'));
  readonly declined = computed(() => this.list().filter((s) => s.account_status === 'declined'));
  readonly shown = computed(() => (this.tab() === 'pending' ? this.pending() : this.declined()));

  ionViewWillEnter() {
    void this.load();
  }
  async load() {
    try {
      this.list.set(await this.auth.requests());
    } catch (e) {
      this.ui.error(e);
    }
  }
  label(r?: string | null) {
    return this.data.roleName(r || 'stylist');
  }
  initials(n: string) {
    return n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
  }
  roleFor(s: StaffMe) {
    return this.chosen()[s.id] ?? s.wanted_role ?? 'stylist';
  }
  setRole(s: StaffMe, r: string) {
    this.chosen.update((c) => ({ ...c, [s.id]: r }));
  }
  async approve(s: StaffMe) {
    try {
      await this.auth.approve(s.id, this.roleFor(s));
      this.ui.toast(`${s.name} approved as ${this.label(this.roleFor(s))}`);
      await Promise.all([this.load(), this.data.refreshStaff()]);
    } catch (e) {
      this.ui.error(e);
    }
  }
  async decline(s: StaffMe) {
    const reason = await this.ui.prompt('Decline request', 'Reason (optional)');
    if (reason === null) return;
    try {
      await this.auth.decline(s.id, reason);
      this.ui.toast('Request declined', 'medium');
      await this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }
}
