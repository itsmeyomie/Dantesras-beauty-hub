import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonInput, IonItem, IonSelect, IonSelectOption, IonTextarea } from '@ionic/angular';
import { DataService } from './data.service';
import { Client, SOURCES } from './models';
import { Ui } from './ui';

/** Add / edit a client. Name + phone required; everything else optional. */
@Component({
  selector: 'app-client-form',
  imports: [FormsModule, IonItem, IonInput, IonSelect, IonSelectOption, IonTextarea, IonButton],
  template: `
    <div class="form-grid">
      <ion-item lines="none" class="field"><ion-input label="Name *" labelPlacement="stacked" [(ngModel)]="c.name"></ion-input></ion-item>
      <ion-item lines="none" class="field"><ion-input label="Phone *" labelPlacement="stacked" type="tel" placeholder="07XX XXX XXX" [(ngModel)]="c.phone"></ion-input></ion-item>
      <ion-item lines="none" class="field"><ion-input label="WhatsApp (if different)" labelPlacement="stacked" type="tel" [(ngModel)]="c.whatsapp"></ion-input></ion-item>
      <ion-item lines="none" class="field"><ion-input label="Date of birth (kids 0–12)" labelPlacement="stacked" type="date" [(ngModel)]="c.birth_date"></ion-input></ion-item>
      <ion-item lines="none" class="field">
        <ion-select label="Gender" labelPlacement="stacked" interface="popover" [(ngModel)]="c.gender">
          <ion-select-option value="female">Female</ion-select-option>
          <ion-select-option value="male">Male</ion-select-option>
        </ion-select>
      </ion-item>
      <ion-item lines="none" class="field"><ion-input label="Area / estate" labelPlacement="stacked" [(ngModel)]="c.area"></ion-input></ion-item>
      <ion-item lines="none" class="field">
        <ion-select label="How they found us" labelPlacement="stacked" interface="popover" [(ngModel)]="c.source">
          @for (s of sources; track s) { <ion-select-option [value]="s">{{ s }}</ion-select-option> }
        </ion-select>
      </ion-item>
      <ion-item lines="none" class="field">
        <ion-select label="Preferred stylist" labelPlacement="stacked" interface="popover" [(ngModel)]="c.preferred_staff_id">
          <ion-select-option [value]="null">None</ion-select-option>
          @for (s of data.staff(); track s.id) { <ion-select-option [value]="s.id">{{ s.name }}</ion-select-option> }
        </ion-select>
      </ion-item>
    </div>
    <ion-item lines="none" class="field"><ion-textarea label="Notes (allergies, hair type, usual style)" labelPlacement="stacked" autoGrow="true" [(ngModel)]="c.notes"></ion-textarea></ion-item>
    <div class="row">
      <span class="spacer"></span>
      <ion-button fill="clear" color="medium" (click)="cancelled.emit()">Cancel</ion-button>
      <ion-button (click)="save()" [disabled]="busy()">Save client</ion-button>
    </div>
  `,
})
export class ClientFormComponent implements OnInit {
  readonly data = inject(DataService);
  private ui = inject(Ui);
  readonly client = input<Partial<Client> | null>(null);
  readonly saved = output<Client>();
  readonly cancelled = output<void>();
  readonly sources = SOURCES;
  readonly busy = signal(false);
  c: Partial<Client> = {};

  ngOnInit() {
    this.c = { preferred_staff_id: null, ...(this.client() ?? {}) };
  }

  async save() {
    if (!this.c.name?.trim()) return this.ui.toast('Enter the client name', 'danger');
    const phone = (this.c.phone ?? '').replace(/\s+/g, '');
    if (!/^(\+?254|0)(7|1)\d{8}$/.test(phone)) return this.ui.toast('Enter a valid Kenyan phone number (07… or 01…)', 'danger');
    this.busy.set(true);
    try {
      const saved = await this.data.saveClient({
        ...this.c, name: this.c.name.trim(), phone,
        birth_date: this.c.birth_date || null, whatsapp: this.c.whatsapp || null,
      });
      this.ui.toast('Client saved');
      this.saved.emit(saved);
    } catch (e) {
      const msg = e instanceof Error && e.message.includes('clients_phone_key') ? 'A client with this phone number already exists' : e;
      this.ui.error(msg instanceof Error ? msg : new Error(String(msg)));
    } finally {
      this.busy.set(false);
    }
  }
}
