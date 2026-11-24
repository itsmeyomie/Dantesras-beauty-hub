import { DatePipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { notificationsOffOutline } from 'ionicons/icons';
import { AppNotification } from './notify.service';

/** The list of notifications (same look for clients and staff). */
@Component({
  selector: 'app-notifications-list',
  imports: [DatePipe, IonIcon],
  template: `
    @if (items() === null) {
      @for (i of [1, 2, 3]; track i) { <div class="p-skeleton" style="height:70px;margin-bottom:10px"></div> }
    } @else {
      @for (n of items()!; track n.id) {
        <button class="p-card p-note-item" [class.new]="!n.read_at" (click)="open(n)" data-testid="notification">
          <span class="dot"></span>
          <span class="p-spacer">
            <b>{{ n.title }}</b>
            @if (n.body) { <span class="p-small" style="display:block;margin-top:2px">{{ n.body }}</span> }
            <span class="p-muted p-small">{{ n.created_at | date: 'EEE d MMM, HH:mm' }}</span>
          </span>
        </button>
      } @empty {
        <div class="p-empty"><ion-icon name="notifications-off-outline"></ion-icon>No notifications yet.</div>
      }
    }
  `,
  styles: `
    .p-note-item { width: 100%; display: flex; gap: 12px; align-items: flex-start; text-align: left; border: 0; cursor: pointer;
      font-family: 'Inter', sans-serif; color: var(--p-ink); }
    .p-note-item .dot { width: 9px; height: 9px; border-radius: 50%; margin-top: 6px; flex: 0 0 9px; background: transparent; }
    .p-note-item.new .dot { background: var(--p-maroon); }
    .p-note-item.new b { color: var(--p-maroon); }
  `,
})
export class NotificationsListComponent {
  private router = inject(Router);
  readonly items = input<AppNotification[] | null>(null);
  constructor() {
    addIcons({ notificationsOffOutline });
  }
  open(n: AppNotification) {
    if (n.url) void this.router.navigateByUrl(n.url);
  }
}
