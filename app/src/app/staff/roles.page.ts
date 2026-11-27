import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonContent, IonModal, ViewWillEnter } from '@ionic/angular';
import { DataService } from '../core/data.service';
import { StaffRoleDef } from '../core/models';
import { StaffAuthService } from '../core/staff-auth.service';
import { Ui } from '../core/ui';
import { StaffHeaderComponent } from './staff-header.component';

/** Screens a role can be given, in the order shown to the owner. */
export const AREAS: { key: string; title: string; sub: string }[] = [
  { key: 'dashboard', title: 'Dashboard', sub: 'Money today, team now, things to act on' },
  { key: 'desk', title: 'Front desk', sub: 'Online requests, walk-in queue, assign stylists' },
  { key: 'my-day', title: 'My day', sub: 'Own clients, own calendar and own earnings' },
  { key: 'bookings', title: 'Bookings', sub: 'All bookings, walk-ins and online requests' },
  { key: 'checkout', title: 'Checkout', sub: 'Take payment and complete a sale' },
  { key: 'sales', title: 'Sales', sub: 'Sales history, void a sale' },
  { key: 'clients', title: 'Clients', sub: 'Client list and history' },
  { key: 'debts', title: 'Debts', sub: 'Who owes and collecting' },
  { key: 'outside', title: 'Bought outside', sub: 'Things bought from other shops, paying the shops' },
  { key: 'services', title: 'Service menu', sub: 'Prices and commission per service' },
  { key: 'products', title: 'Products', sub: 'Stock and product prices' },
  { key: 'team', title: 'Team', sub: 'Staff, commission and payouts' },
  { key: 'school', title: 'School', sub: 'Students, applications and fees' },
  { key: 'reports', title: 'Reports', sub: 'All reports and figures' },
];

interface RoleForm { key?: string; name: string; areas: string[]; serves: boolean; finishes: boolean; built_in: boolean; }

/** Owner: create roles (e.g. Finisher) and choose the screens each role can open. */
@Component({
  selector: 'app-roles',
  host: { class: 'portal' },
  imports: [FormsModule, IonContent, IonModal, StaffHeaderComponent],
  template: `
    <ion-content>
      <div class="p-wrap">
        <app-staff-header />
        <p class="p-hey">Jobs at the salon and what each can open</p>
        <h1 class="p-display" data-testid="roles-title">Roles <strong>& screens</strong></h1>
        <button class="p-btn gold block" style="margin-top:14px" (click)="create()" data-testid="role-new">+ New role</button>

        @for (r of data.roles(); track r.key) {
          <div class="p-card tap" (click)="edit(r)" [attr.data-testid]="'role-' + r.key">
            <div class="p-row">
              <b class="p-spacer" style="font-size:1.05rem">{{ r.name }}</b>
              <span class="p-muted p-small">{{ count(r.key) }} staff</span>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">
              @if (r.built_in) { <span class="p-badge done">Built-in</span> }
              @if (r.serves) { <span class="p-badge ok">Serves clients</span> }
              @if (r.finishes) { <span class="p-badge info">Finishes stylists' work</span> }
            </div>
            <div class="p-muted p-small">
              @if (r.key === 'owner') { Every screen, settings and staff approvals }
              @else { {{ screens(r) || 'Only their own profile' }} }
            </div>
          </div>
        }
      </div>
    </ion-content>

    <ion-modal [isOpen]="!!form()" (didDismiss)="form.set(null)" class="portal" [initialBreakpoint]="1" [breakpoints]="[0, 1]">
      <ng-template>
        <ion-content>
          @if (form(); as f) {
            <div class="p-wrap" style="padding-top:18px" data-testid="role-form">
              <div class="p-kicker">{{ f.key ? 'Change role' : 'New role' }}</div>
              <label class="p-field"><span>Name of the job</span>
                <input class="p-input" [(ngModel)]="f.name" placeholder="e.g. Finisher, Washer, Nail tech" data-testid="role-name" /></label>

              <div class="p-h2" style="margin-top:6px">Work on clients</div>
              <label class="p-check"><input type="checkbox" [(ngModel)]="f.serves" data-testid="role-serves" />
                <span><b>Serves clients</b><small>Can be the main stylist on a booking</small></span></label>
              <label class="p-check"><input type="checkbox" [(ngModel)]="f.finishes" data-testid="role-finishes" />
                <span><b>Finishes the main stylist's work</b><small>e.g. finishes the braids; gets a share of the commission</small></span></label>

              <div class="p-h2">Screens they can open</div>
              @if (f.key === 'owner') {
                <div class="p-note">The owner always has every screen.</div>
              } @else {
                @for (a of areas; track a.key) {
                  <label class="p-check"><input type="checkbox" [checked]="f.areas.includes(a.key)" (change)="toggle(f, a.key)" [attr.data-testid]="'area-' + a.key" />
                    <span><b>{{ a.title }}</b><small>{{ a.sub }}</small></span></label>
                }
                <p class="p-muted p-small">Everyone can always open their own profile. Settings, staff approvals and roles stay with the owner.</p>
              }
              @if (error()) { <div class="p-error">{{ error() }}</div> }
              <div class="p-row" style="gap:8px;margin-top:12px">
                @if (f.key && !f.built_in) {
                  <button class="p-btn ghost" style="color:#9b1c1c" (click)="remove(f)" data-testid="role-delete">Delete</button>
                }
                <span class="p-spacer"></span>
                <button class="p-btn ghost" (click)="form.set(null)">Cancel</button>
                @if (f.key !== 'owner') { <button class="p-btn" (click)="save(f)" [disabled]="busy()" data-testid="role-save">Save</button> }
              </div>
            </div>
          }
        </ion-content>
      </ng-template>
    </ion-modal>
  `,
})
export class RolesPage implements ViewWillEnter {
  readonly data = inject(DataService);
  private auth = inject(StaffAuthService);
  private ui = inject(Ui);
  readonly areas = AREAS;
  readonly form = signal<RoleForm | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  private readonly counts = computed(() => {
    const m = new Map<string, number>();
    for (const s of this.data.staff()) if (s.active) for (const r of s.roles) m.set(r, (m.get(r) ?? 0) + 1);
    return m;
  });

  async ionViewWillEnter() {
    try {
      await this.data.refreshRoles();
    } catch (e) {
      this.ui.error(e);
    }
  }
  count(key: string) {
    return this.counts().get(key) ?? 0;
  }
  screens(r: StaffRoleDef) {
    return AREAS.filter((a) => r.areas.includes(a.key)).map((a) => a.title).join(' · ');
  }
  create() {
    this.error.set('');
    this.form.set({ name: '', areas: ['my-day', 'bookings'], serves: false, finishes: false, built_in: false });
  }
  edit(r: StaffRoleDef) {
    this.error.set('');
    this.form.set({ key: r.key, name: r.name, areas: [...r.areas], serves: r.serves, finishes: r.finishes, built_in: r.built_in });
  }
  toggle(f: RoleForm, key: string) {
    f.areas = f.areas.includes(key) ? f.areas.filter((a) => a !== key) : [...f.areas, key];
  }
  async save(f: RoleForm) {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.saveRole({ key: f.key, name: f.name, areas: f.areas, serves: f.serves, finishes: f.finishes });
      this.ui.toast(f.key ? 'Role saved' : `Role "${f.name.trim()}" created`);
      this.form.set(null);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
  async remove(f: RoleForm) {
    if (!f.key || !(await this.ui.confirm('Delete role', `Delete the role "${f.name}"?`, 'Delete'))) return;
    try {
      await this.auth.deleteRole(f.key);
      this.ui.toast('Role deleted', 'medium');
      this.form.set(null);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}
