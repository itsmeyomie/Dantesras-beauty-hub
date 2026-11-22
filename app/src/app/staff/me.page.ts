import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonIcon, ViewWillEnter } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { logOutOutline } from 'ionicons/icons';
import { StaffAuthService, resizePhoto } from '../core/staff-auth.service';
import { Ui } from '../core/ui';
import { StaffHeaderComponent } from './staff-header.component';

/** My profile: photo (clients see it), name, phone, speciality, password, sign out. */
@Component({
  selector: 'app-me',
  host: { class: 'portal' },
  imports: [FormsModule, IonContent, IonIcon, StaffHeaderComponent],
  template: `
    <ion-content>
      <div class="p-wrap">
        <app-staff-header />
        <h1 class="p-display" style="margin-top:14px">My <strong>profile</strong></h1>
        <label class="p-upload" style="margin-top:16px">
          <span class="p-avatar" style="width:84px;height:84px;flex:0 0 auto">
            @if (photo()) { <img [src]="photo()" alt="My photo" class="p-photo" /> } @else { <span>{{ (f.name || '?').charAt(0) }}</span> }
          </span>
          <span><b>{{ photo() ? 'Change my photo' : 'Add my photo' }}</b><br /><span class="p-muted p-small">Clients see it when they choose a stylist</span></span>
          <input type="file" accept="image/*" capture="user" (change)="pickPhoto($event)" hidden data-testid="me-photo-input" />
        </label>
        <div class="p-card p-row"><div class="p-spacer"><div class="p-kicker">Role</div><b>{{ auth.roleLabel() }}</b></div>
          <span class="p-muted p-small">{{ auth.me()?.email }}</span></div>
        <label class="p-field"><span>Full name</span><input class="p-input" [(ngModel)]="f.name" data-testid="me-name" /></label>
        <label class="p-field"><span>Phone (M-Pesa payouts)</span><input class="p-input" type="tel" [(ngModel)]="f.phone" /></label>
        <label class="p-field"><span>Speciality (shown to clients)</span><input class="p-input" [(ngModel)]="f.specialty" data-testid="me-specialty" /></label>
        <label class="p-field"><span>New password (leave empty to keep)</span><input class="p-input" type="password" autocomplete="new-password" [(ngModel)]="f.password" /></label>
        @if (error()) { <div class="p-error">{{ error() }}</div> }
        <button class="p-btn block" (click)="save()" [disabled]="busy()" data-testid="me-save">Save</button>
        <button class="p-btn block ghost" style="margin-top:10px" (click)="signOut()" data-testid="me-signout"><ion-icon name="log-out-outline"></ion-icon>Sign out</button>
      </div>
    </ion-content>
  `,
})
export class MePage implements ViewWillEnter {
  readonly auth = inject(StaffAuthService);
  private ui = inject(Ui);
  private router = inject(Router);
  readonly busy = signal(false);
  /** picked photo (data URL) – a signal so the preview redraws */
  readonly photo = signal<string | null>(null);
  readonly error = signal('');
  f = { name: '', phone: '', specialty: '', password: '' };

  constructor() {
    addIcons({ logOutOutline });
  }
  ionViewWillEnter() {
    const m = this.auth.me();
    if (m) { this.f = { name: m.name, phone: m.phone ?? '', specialty: m.specialty ?? '', password: '' }; this.photo.set(m.photo); }
  }
  async pickPhoto(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      this.photo.set(await resizePhoto(file));
      await this.auth.update({ photo: this.photo() });
      this.ui.toast('Photo updated');
    } catch (e) {
      this.ui.error(e);
    }
  }
  async save() {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.update({ name: this.f.name, phone: this.f.phone, specialty: this.f.specialty, ...(this.f.password ? { password: this.f.password } : {}) });
      this.f.password = '';
      this.ui.toast('Saved');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
  async signOut() {
    await this.auth.logout();
    this.ui.toast('Signed out', 'medium');
    void this.router.navigateByUrl('/staff/sign-in', { replaceUrl: true });
  }
}
