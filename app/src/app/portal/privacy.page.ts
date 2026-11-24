import { Component, computed, inject } from '@angular/core';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar, ViewWillEnter } from '@ionic/angular';
import { PortalService } from './portal.service';

/** Privacy notice (Kenya Data Protection Act, 2019) – plain words, for clients, students and staff. */
@Component({
  selector: 'app-portal-privacy',
  host: { class: 'portal' },
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-back-button defaultHref="/portal" text=""></ion-back-button></ion-buttons>
      <ion-title>Privacy</ion-title>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="p-wrap privacy" data-testid="privacy">
        <div class="p-kicker">Dantesras Beauty Hub · Hair and Beauty School</div>
        <h1 class="p-h1">How we use your details</h1>
        <p class="p-muted p-small">Last updated: November 2026</p>

        <h3>Who we are</h3>
        <p>Dantesras Beauty Hub and Dantesras Hair and Beauty School, {{ location() }}. We decide how your details
          are used and we are responsible for them.</p>

        <h3>What we keep</h3>
        <ul>
          <li><b>Clients:</b> name, phone number, email, area, your bookings, what you paid and any balance.</li>
          <li><b>Students:</b> name, phone, guardian's name and phone, your course, fees paid and owed.</li>
          <li><b>Staff:</b> name, email, phone, photo, role, sales you worked on and what you earned.</li>
        </ul>

        <h3>Why</h3>
        <ul>
          <li>To take and confirm your bookings and remind you of them.</li>
          <li>To record payments, deposits and balances (we must keep sales records for tax).</li>
          <li>To run the school: applications, attendance and fees.</li>
          <li>To pay staff their commission.</li>
        </ul>
        <p>We never sell your details and we don't use them for advertising.</p>

        <h3>Who can see them</h3>
        <ul>
          <li>Salon staff, each only what their job needs (for example, stylists see their own clients and earnings).</li>
          <li>Services that run the app for us: Supabase (secure database), Google (if you sign in with Google),
            Firebase (notifications) and Safaricom M-Pesa (when you pay). They may store data outside Kenya, with safeguards.</li>
        </ul>

        <h3>How long</h3>
        <p>As long as you are a client, student or staff member, and up to 7 years after for payment and tax records.
          Sign-in codes are deleted after use.</p>

        <h3>Your rights</h3>
        <p>You can ask us to show you your details, correct them, or delete them (except records the law makes us keep).
          You can stop notifications at any time in your phone settings. You can also complain to the
          Office of the Data Protection Commissioner (odpc.go.ke).</p>

        <h3>Contact us</h3>
        <p>Visit the salon at {{ location() }}@if (phone()) {, or call / WhatsApp <a [href]="'tel:' + phone()">{{ phone() }}</a>}.</p>
      </div>
    </ion-content>
  `,
  styles: `
    .privacy h3 { font: 600 1.05rem 'Playfair Display', serif; color: var(--p-maroon); margin: 22px 0 6px; }
    .privacy p, .privacy li { line-height: 1.55; font-size: .93rem; }
    .privacy ul { padding-left: 18px; margin: 6px 0; }
  `,
})
export class PortalPrivacyPage implements ViewWillEnter {
  private p = inject(PortalService);
  readonly location = computed(() => this.p.setting('salon_location', 'Karuguru junction, Kamakis, Ruiru'));
  readonly phone = computed(() => this.p.setting<string>('salon_phone', ''));
  ionViewWillEnter() {
    void this.p.loadCatalog().catch(() => undefined);
  }
}
