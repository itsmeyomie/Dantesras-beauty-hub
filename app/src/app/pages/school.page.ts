import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonMenuButton, IonModal,
  IonSearchbar, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonTextarea, IonTitle, IonToggle, IonToolbar,
  ViewWillEnter,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline } from 'ionicons/icons';
import { DataService } from '../core/data.service';
import { Course, PaymentInput, Student, methodLabel } from '../core/models';
import { NotConfiguredComponent } from '../core/not-configured.component';
import { PayDialogComponent } from '../core/pay-dialog.component';
import { KshPipe, Ui, ymd } from '../core/ui';

@Component({
  selector: 'app-school',
  imports: [
    FormsModule, DatePipe, KshPipe, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, IonButton, IonIcon,
    IonSegment, IonSegmentButton, IonLabel, IonSearchbar, IonModal, IonItem, IonInput, IonSelect, IonSelectOption, IonTextarea,
    IonToggle, NotConfiguredComponent, PayDialogComponent,
  ],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons>
      <ion-title>Hair and Beauty School</ion-title>
      <ion-buttons slot="end">
        <ion-button (click)="tab() === 'students' ? editStudent(null) : editCourse(null)"><ion-icon slot="start" name="add-outline"></ion-icon>{{ tab() === 'students' ? 'Enrol' : 'Course' }}</ion-button>
      </ion-buttons>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="page-wrap">
        <app-not-configured />
        <div class="school-brand"><img src="assets/school-logo.png" alt="Dantesras Hair and Beauty School logo" /></div>
        <ion-segment [value]="tab()" (ionChange)="tab.set($any($event.detail.value))">
          <ion-segment-button value="students"><ion-label>Students</ion-label></ion-segment-button>
          <ion-segment-button value="courses"><ion-label>Courses</ion-label></ion-segment-button>
          <ion-segment-button value="applications"><ion-label>Applications ({{ applications().length }})</ion-label></ion-segment-button>
        </ion-segment>

        @if (tab() === 'applications') {
          <p class="muted small" style="margin-top:12px">Sent from the client app. Accepting creates the student with the full course fee as balance.</p>
          @for (a of applications(); track a.id) {
            <div class="card request" style="margin-bottom:10px" data-testid="application">
              <div class="row"><strong>{{ a.name }}</strong><span class="muted">{{ a.phone }}</span><span class="spacer"></span><span class="pill requested">{{ a.courses?.name }}</span></div>
              <div class="small" style="margin-top:4px">Wants to start: <strong>{{ a.preferred_start ? (a.preferred_start | date: 'd MMM y') : 'not given' }}</strong> · sent {{ a.created_at | date: 'd MMM HH:mm' }}</div>
              @if (a.guardian_name || a.guardian_phone) { <div class="small muted">Guardian / next of kin: {{ a.guardian_name }} {{ a.guardian_phone }}</div> }
              @if (a.email) { <div class="small muted">{{ a.email }}</div> }
              @if (a.notes) { <div class="small muted">Note: {{ a.notes }}</div> }
              <div class="row" style="margin-top:8px">
                <ion-button size="small" (click)="acceptApp(a)">Accept</ion-button>
                <ion-button size="small" fill="clear" color="danger" (click)="declineApp(a)">Decline</ion-button>
              </div>
            </div>
          } @empty { <div class="empty">No new applications.</div> }
        }

        @if (tab() === 'students') {
          <div class="grid" style="margin-top:12px">
            <div class="card stat"><div class="label">Active students</div><div class="value">{{ active().length }}</div></div>
            <div class="card stat"><div class="label">Fees collected (all)</div><div class="value">{{ collected() | ksh }}</div></div>
            <div class="card stat"><div class="label">Balances owed</div><div class="value maroon">{{ owed() | ksh }}</div></div>
          </div>
          <ion-searchbar placeholder="Search students" [(ngModel)]="term"></ion-searchbar>
          <div class="card">
            <table class="t">
              <thead><tr><th>Student</th><th>Course</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead>
              <tbody>
                @for (s of filtered(); track s.id) {
                  <tr (click)="openStudent(s)" style="cursor:pointer" [style.opacity]="s.status === 'active' ? 1 : 0.5">
                    <td><strong>{{ s.name }}</strong><br /><span class="muted small">{{ s.phone }} · started {{ s.start_date | date: 'd MMM y' }}</span></td>
                    <td>{{ s.course_name }}@if (s.status !== 'active') { <br /><span class="pill">{{ s.status }}</span> }</td>
                    <td class="num">{{ s.paid | ksh }}</td>
                    <td class="num"><strong [class.maroon]="(s.balance ?? 0) > 0">{{ s.balance | ksh }}</strong></td>
                  </tr>
                } @empty { <tr><td colspan="4" class="empty">No students yet.</td></tr> }
              </tbody>
            </table>
          </div>
        } @else {
          <div class="card" style="margin-top:12px">
            <table class="t">
              <thead><tr><th>Course</th><th>Duration</th><th class="num">Fee</th><th class="num">Full course</th></tr></thead>
              <tbody>
                @for (c of data.courses(); track c.id) {
                  <tr (click)="editCourse(c)" style="cursor:pointer" [style.opacity]="c.active ? 1 : 0.45">
                    <td><strong>{{ c.name }}</strong></td>
                    <td>{{ c.duration_value }} {{ c.duration_unit }}</td>
                    <td class="num">{{ c.fee | ksh }}{{ c.fee_type === 'monthly' ? ' / month' : '' }}</td>
                    <td class="num">{{ courseTotal(c) | ksh }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="muted small">Classes run Monday – Friday from 9:00 am.</p>
        }
      </div>

      <!-- enrol / edit student -->
      <ion-modal [isOpen]="!!studentForm()" (didDismiss)="studentForm.set(null)" class="wide">
        <ng-template>
          <ion-header><ion-toolbar><ion-title>{{ studentForm()?.id ? 'Edit student' : 'Enrol student' }}</ion-title></ion-toolbar></ion-header>
          <ion-content class="ion-padding">
            @if (studentForm(); as f) {
              <div class="form-grid">
                <ion-item lines="none" class="field"><ion-input label="Full name" labelPlacement="stacked" [(ngModel)]="f.name"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Phone" labelPlacement="stacked" type="tel" [(ngModel)]="f.phone"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Guardian / next of kin" labelPlacement="stacked" [(ngModel)]="f.guardian_name"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Guardian phone" labelPlacement="stacked" type="tel" [(ngModel)]="f.guardian_phone"></ion-input></ion-item>
                <ion-item lines="none" class="field">
                  <ion-select label="Course" labelPlacement="stacked" interface="popover" [(ngModel)]="f.course_id" (ionChange)="courseChanged(f)">
                    @for (c of data.courses(); track c.id) { <ion-select-option [value]="c.id">{{ c.name }}</ion-select-option> }
                  </ion-select>
                </ion-item>
                <ion-item lines="none" class="field"><ion-input label="Start date" labelPlacement="stacked" type="date" [(ngModel)]="f.start_date"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Total course fee (KSh)" labelPlacement="stacked" type="number" [(ngModel)]="f.total_fee"></ion-input></ion-item>
                <ion-item lines="none" class="field">
                  <ion-select label="Status" labelPlacement="stacked" interface="popover" [(ngModel)]="f.status">
                    <ion-select-option value="active">Active</ion-select-option>
                    <ion-select-option value="completed">Completed</ion-select-option>
                    <ion-select-option value="dropped">Dropped</ion-select-option>
                  </ion-select>
                </ion-item>
              </div>
              <ion-item lines="none" class="field"><ion-textarea label="Notes" labelPlacement="stacked" autoGrow="true" [(ngModel)]="f.notes"></ion-textarea></ion-item>
              <div class="row" style="margin-top:12px">
                <span class="spacer"></span>
                <ion-button fill="clear" color="medium" (click)="studentForm.set(null)">Cancel</ion-button>
                <ion-button (click)="saveStudent(f)">Save</ion-button>
              </div>
            }
          </ion-content>
        </ng-template>
      </ion-modal>

      <!-- student detail: fees -->
      <ion-modal [isOpen]="!!selected()" (didDismiss)="selected.set(null)" class="wide">
        <ng-template>
          <ion-header><ion-toolbar><ion-title>{{ selected()?.name }}</ion-title>
            <ion-buttons slot="end"><ion-button (click)="editStudent(selected())">Edit</ion-button><ion-button (click)="selected.set(null)">Close</ion-button></ion-buttons></ion-toolbar></ion-header>
          <ion-content class="ion-padding">
            @if (selected(); as s) {
              <p>{{ s.course_name }} · started {{ s.start_date | date: 'd MMM y' }} · {{ s.phone }}</p>
              <div class="grid">
                <div class="card stat"><div class="label">Course fee</div><div class="value">{{ s.total_fee | ksh }}</div></div>
                <div class="card stat"><div class="label">Paid</div><div class="value">{{ s.paid | ksh }}</div></div>
                <div class="card stat"><div class="label">Balance</div><div class="value maroon">{{ s.balance | ksh }}</div></div>
              </div>
              @if ((s.balance ?? 0) > 0) {
                <div class="section-title">Receive fee payment</div>
                <app-pay-dialog [due]="s.balance ?? null" [pay]="payFee" [stk]="{ purpose: 'school_fee', student_id: s.id, phone: s.phone }" (done)="afterFee()" (cancelled)="selected.set(null)" />
              }
              <div class="section-title">Payment history</div>
              <table class="t"><tbody>
                @for (p of feePayments(); track p.id) {
                  <tr><td>{{ p.paid_at | date: 'd MMM y, HH:mm' }}</td><td>{{ mLabel(p.method) }}{{ p.mpesa_ref ? ' (…' + p.mpesa_ref + ')' : '' }}</td><td class="num">{{ p.amount | ksh }}</td></tr>
                } @empty { <tr><td class="muted">No payments yet.</td></tr> }
              </tbody></table>
            }
          </ion-content>
        </ng-template>
      </ion-modal>

      <!-- course -->
      <ion-modal [isOpen]="!!courseForm()" (didDismiss)="courseForm.set(null)" class="wide">
        <ng-template>
          <ion-header><ion-toolbar><ion-title>{{ courseForm()?.id ? 'Edit course' : 'New course' }}</ion-title></ion-toolbar></ion-header>
          <ion-content class="ion-padding">
            @if (courseForm(); as c) {
              <div class="form-grid">
                <ion-item lines="none" class="field"><ion-input label="Course name" labelPlacement="stacked" [(ngModel)]="c.name"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Fee (KSh)" labelPlacement="stacked" type="number" [(ngModel)]="c.fee"></ion-input></ion-item>
                <ion-item lines="none" class="field">
                  <ion-select label="Fee is" labelPlacement="stacked" interface="popover" [(ngModel)]="c.fee_type">
                    <ion-select-option value="total">For the whole course</ion-select-option>
                    <ion-select-option value="monthly">Per month</ion-select-option>
                  </ion-select>
                </ion-item>
                <ion-item lines="none" class="field"><ion-input label="Duration" labelPlacement="stacked" type="number" [(ngModel)]="c.duration_value"></ion-input></ion-item>
                <ion-item lines="none" class="field">
                  <ion-select label="Unit" labelPlacement="stacked" interface="popover" [(ngModel)]="c.duration_unit">
                    <ion-select-option value="weeks">Weeks</ion-select-option>
                    <ion-select-option value="months">Months</ion-select-option>
                  </ion-select>
                </ion-item>
                <ion-item lines="none" class="field"><ion-toggle [(ngModel)]="c.active">Open for enrolment</ion-toggle></ion-item>
              </div>
              <div class="row" style="margin-top:12px">
                <span class="spacer"></span>
                <ion-button fill="clear" color="medium" (click)="courseForm.set(null)">Cancel</ion-button>
                <ion-button (click)="saveCourse(c)">Save</ion-button>
              </div>
            }
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
  styles: `
    .school-brand { background:#000; border-radius: 12px; text-align:center; margin-bottom: 12px; }
    .school-brand img { max-height: 120px; }
  `,
})
export class SchoolPage implements ViewWillEnter {
  readonly data = inject(DataService);
  private ui = inject(Ui);
  readonly tab = signal<'students' | 'courses' | 'applications'>('students');
  /** ?tab=applications (link from the dashboard) */
  readonly tabParam = input<string>(undefined, { alias: 'tab' });
  readonly applications = signal<Awaited<ReturnType<DataService['courseApplications']>>>([]);
  readonly students = signal<Student[]>([]);
  readonly studentForm = signal<Partial<Student> | null>(null);
  readonly courseForm = signal<Partial<Course> | null>(null);
  readonly selected = signal<Student | null>(null);
  readonly feePayments = signal<Awaited<ReturnType<DataService['studentPayments']>>>([]);
  readonly active = computed(() => this.students().filter((s) => s.status === 'active'));
  readonly collected = computed(() => this.students().reduce((a, s) => a + Number(s.paid ?? 0), 0));
  readonly owed = computed(() => this.active().reduce((a, s) => a + Math.max(0, Number(s.balance ?? 0)), 0));
  readonly mLabel = methodLabel;
  term = '';

  payFee = (p: PaymentInput) => this.data.payStudentFee(this.selected()!.id, p);

  constructor() {
    addIcons({ addOutline });
  }
  ionViewWillEnter() {
    const t = this.tabParam();
    if (t === 'applications' || t === 'courses' || t === 'students') this.tab.set(t);
    this.load();
  }
  async load() {
    if (!this.data.configured) return;
    try {
      const [st, apps] = await Promise.all([this.data.students(), this.data.courseApplications()]);
      this.students.set(st);
      this.applications.set(apps);
    } catch (e) {
      this.ui.error(e);
    }
  }
  async acceptApp(a: { id: string; name: string; preferred_start: string | null }) {
    const ok = await this.ui.confirm('Accept application', `Enrol ${a.name}? Start date: ${a.preferred_start ?? 'today'}.`, 'Accept');
    if (!ok) return;
    try {
      await this.data.acceptApplication(a.id);
      this.ui.toast('Student enrolled');
      await this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }
  async declineApp(a: { id: string }) {
    const reason = await this.ui.prompt('Decline application', 'Reason (the applicant sees it)');
    if (!reason) return;
    try {
      await this.data.declineApplication(a.id, reason);
      this.ui.toast('Application declined');
      await this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }
  filtered() {
    const t = this.term.trim().toLowerCase();
    return t ? this.students().filter((s) => s.name.toLowerCase().includes(t) || (s.phone ?? '').includes(t)) : this.students();
  }
  courseTotal(c: Partial<Course>) {
    if (c.fee_type !== 'monthly') return Number(c.fee ?? 0);
    const months = c.duration_unit === 'months' ? Number(c.duration_value) : Math.ceil(Number(c.duration_value) / 4.33);
    return Number(c.fee ?? 0) * months;
  }
  editStudent(s: Student | null) {
    this.selected.set(null);
    const first = this.data.courses().find((c) => c.active);
    this.studentForm.set(s ? { ...s } : { status: 'active', start_date: ymd(new Date()), course_id: first?.id, total_fee: first ? this.courseTotal(first) : 0 });
  }
  courseChanged(f: Partial<Student>) {
    const c = this.data.courses().find((x) => x.id === f.course_id);
    if (c && !f.id) f.total_fee = this.courseTotal(c);
  }
  async saveStudent(f: Partial<Student>) {
    if (!f.name?.trim() || !f.course_id) return this.ui.toast('Enter the name and course', 'danger');
    try {
      await this.data.saveStudent({ ...f, name: f.name.trim(), total_fee: Number(f.total_fee) });
      this.studentForm.set(null);
      this.ui.toast('Student saved');
      this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }
  async openStudent(s: Student) {
    this.selected.set(s);
    try {
      this.feePayments.set(await this.data.studentPayments(s.id));
    } catch (e) {
      this.ui.error(e);
    }
  }
  async afterFee() {
    const id = this.selected()?.id;
    await this.load();
    const s = this.students().find((x) => x.id === id);
    if (s) this.openStudent(s);
  }
  editCourse(c: Course | null) {
    this.courseForm.set(c ? { ...c } : { fee_type: 'total', duration_unit: 'weeks', active: true });
  }
  async saveCourse(c: Partial<Course>) {
    if (!c.name?.trim() || !c.fee || !c.duration_value) return this.ui.toast('Enter name, fee and duration', 'danger');
    try {
      await this.data.saveCourse({ ...c, name: c.name.trim(), fee: Number(c.fee), duration_value: Number(c.duration_value) });
      this.courseForm.set(null);
      this.ui.toast('Course saved');
    } catch (e) {
      this.ui.error(e);
    }
  }
}
