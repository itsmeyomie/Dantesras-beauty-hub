import { Component, computed, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton, IonInput, IonItem, IonModal, IonSearchbar, IonSegment, IonSegmentButton, IonLabel, IonSelect,
  IonSelectOption, IonContent, IonHeader, IonToolbar, IonTitle,
} from '@ionic/angular';
import { ClientFormComponent } from './client-form.component';
import { DataService } from './data.service';
import { Client } from './models';
import { Ui, ageFrom } from './ui';

export interface ClientChoice { client: Client | null; guestName: string; }

/** Choose a saved client, add a new one, or serve a guest (name only). */
@Component({
  selector: 'app-client-picker',
  imports: [FormsModule, IonSegment, IonSegmentButton, IonLabel, IonSearchbar, IonItem, IonInput, IonButton, IonModal, IonContent, IonHeader, IonToolbar, IonTitle, ClientFormComponent],
  template: `
    <ion-segment [value]="mode()" (ionChange)="setMode($any($event.detail.value))">
      <ion-segment-button value="client"><ion-label>Client</ion-label></ion-segment-button>
      <ion-segment-button value="guest"><ion-label>Guest (name only)</ion-label></ion-segment-button>
    </ion-segment>
    @if (mode() === 'client') {
      @if (choice().client; as c) {
        <div class="chosen">
          <div><strong>{{ c.name }}</strong> <span class="muted">{{ c.phone }}</span>
            @if (age(c) !== null) { <span class="muted"> · age {{ age(c) }}</span> }</div>
          <ion-button size="small" fill="clear" (click)="pick(null)">Change</ion-button>
        </div>
      } @else {
        <div class="row">
          <ion-searchbar style="flex:1" placeholder="Search name or phone" [debounce]="250" [(ngModel)]="term" (ionInput)="search()"></ion-searchbar>
          <ion-button size="small" fill="outline" (click)="adding.set(true)">+ New</ion-button>
        </div>
        @for (c of results(); track c.id) {
          <div class="result" (click)="pick(c)"><strong>{{ c.name }}</strong> <span class="muted">{{ c.phone }}</span></div>
        }
      }
    } @else {
      <ion-item lines="none" class="field" style="margin-top:8px">
        <ion-input label="Guest name" labelPlacement="stacked" [ngModel]="choice().guestName" (ngModelChange)="setGuest($event)"></ion-input>
      </ion-item>
      <p class="muted small">Guests are fully recorded but get no reminders and can't owe money.</p>
    }
    <ion-modal [isOpen]="adding()" (didDismiss)="adding.set(false)" class="wide">
      <ng-template>
        <ion-header><ion-toolbar><ion-title>New client</ion-title></ion-toolbar></ion-header>
        <ion-content class="ion-padding">
          <app-client-form (saved)="adding.set(false); pick($event)" (cancelled)="adding.set(false)" />
        </ion-content>
      </ng-template>
    </ion-modal>
  `,
  styles: `
    .chosen { display:flex; align-items:center; justify-content:space-between; background: var(--app-field-bg); border-radius: 8px; padding: 8px 12px; margin-top: 8px; }
    .result { padding: 10px 12px; border-bottom: 1px solid var(--app-border); cursor: pointer; }
    .result:hover { background: var(--app-field-bg); }
  `,
})
export class ClientPickerComponent {
  private data = inject(DataService);
  private ui = inject(Ui);
  readonly choice = model<ClientChoice>({ client: null, guestName: '' });
  readonly mode = signal<'client' | 'guest'>('client');
  readonly results = signal<Client[]>([]);
  readonly adding = signal(false);
  term = '';

  ngOnInit() {
    if (!this.choice().client && this.choice().guestName) this.mode.set('guest');
  }
  age(c: Client) {
    return ageFrom(c.birth_date);
  }
  setMode(m: 'client' | 'guest') {
    this.mode.set(m);
    this.choice.set({ client: null, guestName: '' });
  }
  setGuest(name: string) {
    this.choice.set({ client: null, guestName: name });
  }
  async search() {
    if (this.term.trim().length < 2) return this.results.set([]);
    try {
      this.results.set(await this.data.searchClients(this.term, 8));
    } catch (e) {
      this.ui.error(e);
    }
  }
  pick(c: Client | null) {
    this.choice.set({ client: c, guestName: '' });
    this.results.set([]);
    this.term = '';
  }
}

export interface PickedService { service_id: string | null; variant_id: string | null; name: string; price: number; }

/** Pick a service + variant; price pre-filled, editable within a range for range/"from" services. */
@Component({
  selector: 'app-service-picker',
  imports: [FormsModule, IonItem, IonSelect, IonSelectOption, IonInput, IonButton],
  template: `
    <div class="row">
      <ion-item lines="none" class="field" style="flex:2 1 220px">
        <ion-select label="Service" labelPlacement="stacked" interface="action-sheet" [ngModel]="serviceId()" (ngModelChange)="setService($event)">
          @for (s of options(); track s.id) { <ion-select-option [value]="s.id">{{ s.label }}</ion-select-option> }
        </ion-select>
      </ion-item>
      @if (service()?.service_variants?.length) {
        <ion-item lines="none" class="field" style="flex:1 1 160px">
          <ion-select label="Option" labelPlacement="stacked" interface="popover" [ngModel]="variantId()" (ngModelChange)="setVariant($event)">
            <ion-select-option [value]="null">Standard</ion-select-option>
            @for (v of service()!.service_variants!; track v.id) { <ion-select-option [value]="v.id">{{ v.name }}</ion-select-option> }
          </ion-select>
        </ion-item>
      }
      @if (service()) {
        <ion-item lines="none" class="field" style="flex:1 1 120px">
          <ion-input [label]="priceLabel()" labelPlacement="stacked" type="number" [readonly]="fixed()" [(ngModel)]="price"></ion-input>
        </ion-item>
        <ion-button (click)="add()">Add</ion-button>
      }
    </div>
  `,
})
export class ServicePickerComponent {
  private data = inject(DataService);
  private ui = inject(Ui);
  /** 'kids' puts kids services first (client aged 0–12). */
  readonly clientType = input<'kids' | 'adult' | null>(null);
  readonly picked = output<PickedService>();
  readonly serviceId = signal<string | null>(null);
  readonly variantId = signal<string | null>(null);
  price = 0;

  readonly service = computed(() => this.data.services().find((s) => s.id === this.serviceId()) ?? null);
  readonly fixed = computed(() => this.service()?.price_type === 'fixed');
  readonly options = computed(() => {
    const cats = [...this.data.categories()];
    const t = this.clientType();
    if (t) cats.sort((a, b) => (a.client_type === t ? -1 : 0) - (b.client_type === t ? -1 : 0));
    return cats.flatMap((c) =>
      this.data.services().filter((s) => s.category_id === c.id && s.active).map((s) => ({ id: s.id, label: `${c.name}: ${s.name}` })),
    );
  });

  priceLabel() {
    const s = this.service();
    if (!s || this.variantId()) return 'Price';
    if (s.price_type === 'range') return `Price (${s.price}–${s.max_price})`;
    if (s.price_type === 'from') return `Price (from ${s.price})`;
    return 'Price';
  }
  setService(id: string) {
    this.serviceId.set(id);
    this.variantId.set(null);
    this.price = Number(this.service()?.price ?? 0);
  }
  setVariant(id: string | null) {
    this.variantId.set(id);
    const v = this.service()?.service_variants?.find((x) => x.id === id);
    this.price = Number(v ? v.price : this.service()?.price ?? 0);
  }
  add(): void {
    const s = this.service();
    if (!s) return;
    const price = Number(this.price);
    const v = s.service_variants?.find((x) => x.id === this.variantId());
    if (!v && s.price_type === 'range' && (price < s.price || price > Number(s.max_price))) {
      void this.ui.toast(`Price must be between ${s.price} and ${s.max_price}`, 'danger');
      return;
    }
    if (!v && s.price_type === 'from' && price < s.price) {
      void this.ui.toast(`Price must be at least ${s.price}`, 'danger');
      return;
    }
    const cat = this.data.categories().find((c) => c.id === s.category_id);
    const prefix = cat?.client_type === 'kids' ? 'Kids ' : '';
    this.picked.emit({ service_id: s.id, variant_id: v?.id ?? null, name: `${prefix}${s.name}${v ? ' – ' + v.name : ''}`, price });
    this.serviceId.set(null);
    this.variantId.set(null);
    this.price = 0;
  }
}
