import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonMenuButton, IonModal, IonSearchbar, IonTitle, IonToolbar,
  ViewWillEnter,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline } from 'ionicons/icons';
import { ClientFormComponent } from '../core/client-form.component';
import { DataService } from '../core/data.service';
import { Client } from '../core/models';
import { NotConfiguredComponent } from '../core/not-configured.component';
import { Ui, ageFrom } from '../core/ui';

@Component({
  selector: 'app-clients',
  imports: [FormsModule, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, IonSearchbar, IonButton, IonIcon, IonModal, ClientFormComponent, NotConfiguredComponent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons>
      <ion-title>Clients</ion-title>
      <ion-buttons slot="end"><ion-button (click)="adding.set(true)"><ion-icon slot="start" name="add-outline"></ion-icon>New</ion-button></ion-buttons>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="page-wrap">
        <app-not-configured />
        <ion-searchbar [placeholder]="data.owner() ? 'Search name or phone' : 'Search name (or full phone number)'" [debounce]="300" [(ngModel)]="term" (ionInput)="load()"></ion-searchbar>
        <div class="card">
          @if (clients().length === 0) { <div class="empty">No clients found.</div> }
          <table class="t">
            @if (clients().length) {
              <thead><tr><th>Name</th>@if (data.owner()) { <th>Phone</th> }<th>Area</th><th class="num">Age</th></tr></thead>
            }
            <tbody>
              @for (c of clients(); track c.id) {
                <tr (click)="open(c)" style="cursor:pointer">
                  <td><strong>{{ c.name }}</strong></td>
                  @if (data.owner()) { <td>{{ c.phone }}</td> }
                  <td class="muted">{{ c.area }}</td>
                  <td class="num">{{ age(c) ?? '' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
      <ion-modal [isOpen]="adding()" (didDismiss)="adding.set(false)" class="wide">
        <ng-template>
          <ion-header><ion-toolbar><ion-title>New client</ion-title></ion-toolbar></ion-header>
          <ion-content class="ion-padding">
            <app-client-form (saved)="onSaved($event)" (cancelled)="adding.set(false)" />
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
})
export class ClientsPage implements ViewWillEnter {
  readonly data = inject(DataService);
  private ui = inject(Ui);
  private router = inject(Router);
  readonly clients = signal<Client[]>([]);
  readonly adding = signal(false);
  term = '';

  constructor() {
    addIcons({ addOutline });
  }
  ionViewWillEnter() {
    this.load();
  }
  async load() {
    if (!this.data.configured) return;
    try {
      this.clients.set(await this.data.searchClients(this.term));
    } catch (e) {
      this.ui.error(e);
    }
  }
  age(c: Client) {
    return ageFrom(c.birth_date);
  }
  open(c: Client) {
    this.router.navigate(['/clients', c.id]);
  }
  onSaved(c: Client) {
    this.adding.set(false);
    this.open(c);
  }
}
