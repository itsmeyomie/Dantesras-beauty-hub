import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, IonInput, IonItem, IonSelect, IonSelectOption } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeCircleOutline } from 'ionicons/icons';
import { PAY_METHODS, PaymentInput } from './models';

/** One payment line: method, amount and (for M-Pesa) last 3 characters of the code + time. */
@Component({
  selector: 'app-payment-entry',
  imports: [FormsModule, IonItem, IonSelect, IonSelectOption, IonInput, IonButton, IonIcon],
  template: `
    <div class="pay">
      <ion-item lines="none" class="field">
        <ion-select label="Method" labelPlacement="stacked" interface="popover" [(ngModel)]="p().method" (ionChange)="changed.emit()">
          @for (m of methods; track m.value) { <ion-select-option [value]="m.value">{{ m.label }}</ion-select-option> }
        </ion-select>
      </ion-item>
      <ion-item lines="none" class="field">
        <ion-input label="Amount (KSh)" labelPlacement="stacked" type="number" inputmode="numeric" min="0"
          [(ngModel)]="p().amount" (ionInput)="changed.emit()"></ion-input>
      </ion-item>
      @if (p().method.startsWith('mpesa')) {
        <ion-item lines="none" class="field small">
          <ion-input label="Code – last 3" labelPlacement="stacked" maxlength="3" [(ngModel)]="p().mpesa_ref"
            placeholder="e.g. 7QX" style="text-transform: uppercase"></ion-input>
        </ion-item>
        <ion-item lines="none" class="field small">
          <ion-input label="Time paid" labelPlacement="stacked" type="time" [(ngModel)]="p().mpesa_time"></ion-input>
        </ion-item>
      }
      @if (removable()) {
        <ion-button fill="clear" color="medium" (click)="remove.emit()" aria-label="Remove payment">
          <ion-icon slot="icon-only" name="close-circle-outline"></ion-icon>
        </ion-button>
      }
    </div>
  `,
  styles: `
    .pay { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; margin-bottom: 8px; }
    .field { flex: 1 1 140px; --background: var(--app-field-bg); border-radius: 8px; }
    .field.small { flex: 1 1 100px; }
  `,
})
export class PaymentEntryComponent {
  readonly p = input.required<PaymentInput>();
  readonly removable = input(false);
  readonly changed = output<void>();
  readonly remove = output<void>();
  readonly methods = PAY_METHODS;
  constructor() {
    addIcons({ closeCircleOutline });
  }
}

/** Validates M-Pesa fields; returns an error message or null. */
export function paymentError(p: PaymentInput): string | null {
  if (!p.amount || p.amount <= 0) return null; // empty line is ignored
  if (p.method.startsWith('mpesa')) {
    if (!p.mpesa_ref || p.mpesa_ref.trim().length !== 3) return 'Enter the last 3 characters of the M-Pesa code';
    if (!p.mpesa_time) return 'Enter the time shown on the M-Pesa message';
  }
  return null;
}
