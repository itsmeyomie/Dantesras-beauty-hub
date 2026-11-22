import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { appsOutline, chevronBackOutline } from 'ionicons/icons';
import { StaffAuthService } from '../core/staff-auth.service';

/** Top bar of the staff screens: back (or my photo) on the left, role + menu on the right. */
@Component({
  selector: 'app-staff-header',
  imports: [RouterLink, IonIcon],
  template: `
    <div class="p-top">
      @if (back()) {
        <a class="p-glass-btn" [routerLink]="back()" aria-label="Back"><ion-icon name="chevron-back-outline"></ion-icon></a>
      } @else {
        <a class="p-avatar" routerLink="/me" aria-label="My profile" data-testid="me-avatar">
          @if (auth.me()?.photo) { <img [src]="auth.me()!.photo" alt="" class="p-photo" /> } @else { <span>{{ (auth.me()?.name ?? '?').charAt(0) }}</span> }
        </a>
      }
      <div class="p-icons">
        <span class="p-role-pill" data-testid="role-pill">{{ auth.roleLabel() }}</span>
        <a class="p-glass-btn" routerLink="/more" aria-label="All sections"><ion-icon name="apps-outline"></ion-icon></a>
      </div>
    </div>
  `,
})
export class StaffHeaderComponent {
  readonly auth = inject(StaffAuthService);
  readonly back = input<string>();
  constructor() {
    addIcons({ chevronBackOutline, appsOutline });
  }
}
