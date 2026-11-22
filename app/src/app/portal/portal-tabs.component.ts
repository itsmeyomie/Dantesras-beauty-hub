import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { calendarClearOutline, homeOutline, personOutline, schoolOutline, sparklesOutline } from 'ionicons/icons';

/** Floating bottom navigation of the client app (icons; the active one sits in the maroon–gold ring). */
@Component({
  selector: 'app-portal-tabs',
  imports: [RouterLink, RouterLinkActive, IonIcon],
  template: `
    <div class="p-tabs">
      <nav aria-label="Main">
        <a routerLink="/portal" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" aria-label="Home" title="Home"><ion-icon name="home-outline"></ion-icon>Home</a>
        <a routerLink="/portal/book" routerLinkActive="active" class="book" aria-label="Book" title="Book"><ion-icon name="sparkles-outline"></ion-icon>Book</a>
        <a routerLink="/portal/bookings" routerLinkActive="active" aria-label="Bookings" title="My bookings"><ion-icon name="calendar-clear-outline"></ion-icon>Bookings</a>
        <a routerLink="/portal/school" routerLinkActive="active" aria-label="School" title="School"><ion-icon name="school-outline"></ion-icon>School</a>
        <a routerLink="/portal/account" routerLinkActive="active" aria-label="Account" title="Account"><ion-icon name="person-outline"></ion-icon>Account</a>
      </nav>
    </div>
  `,
})
export class PortalTabsComponent {
  constructor() {
    addIcons({ homeOutline, calendarClearOutline, sparklesOutline, schoolOutline, personOutline });
  }
}
