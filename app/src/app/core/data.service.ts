import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import {
  Booking, BookingService, BookingStatus, Category, Client, Course, Debt, PaymentInput, Product, Report,
  Service, Staff, StaffBalance, Student, Variant,
} from './models';

/** Single gateway to Supabase. Every page talks to the database through here. */
@Injectable({ providedIn: 'root' })
export class DataService {
  readonly configured = !environment.supabaseUrl.includes('YOUR-PROJECT') && !environment.supabaseAnonKey.includes('YOUR-');
  private readonly db: SupabaseClient = createClient(
    this.configured ? environment.supabaseUrl : 'https://placeholder.supabase.co',
    this.configured ? environment.supabaseAnonKey : 'placeholder',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  /** Shared reference data, loaded once and refreshed after edits. */
  readonly staff = signal<Staff[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly services = signal<Service[]>([]);
  readonly products = signal<Product[]>([]);
  readonly courses = signal<Course[]>([]);
  readonly settings = signal<Record<string, unknown>>({});

  private async run<T = unknown>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
    if (!this.configured) throw new Error('Supabase is not configured yet (see src/environments/environment.ts).');
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data as T;
  }

  /** Call a database function directly. */
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    return this.run<T>(this.db.rpc(fn, args));
  }

  /** Call a Supabase Edge Function (M-Pesa, one-time codes). Errors carry the function's message. */
  async invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
    if (!this.configured) throw new Error('Supabase is not configured yet (see src/environments/environment.ts).');
    const { data, error } = await this.db.functions.invoke(fn, { body });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      let msg = error.message;
      try {
        const j = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
        if (j?.message) msg = j.message;
      } catch { /* keep default message */ }
      if (/Failed to send a request/i.test(msg)) msg = 'No connection to the server. Check the internet and try again.';
      throw new Error(msg);
    }
    return data as T;
  }

  // ---------- reference data ----------
  async loadReference(): Promise<void> {
    const [staff, cats, services, products, courses, settings] = await Promise.all([
      this.run<Staff[]>(this.db.from('staff').select('*').order('name')),
      this.run<Category[]>(this.db.from('service_categories').select('*').order('sort')),
      this.run<Service[]>(this.db.from('services').select('*, service_variants(*)').order('sort').order('name')),
      this.run<Product[]>(this.db.from('products').select('*').order('name')),
      this.run<Course[]>(this.db.from('courses').select('*').order('name')),
      this.run<{ key: string; value: unknown }[]>(this.db.from('settings').select('*')),
    ]);
    services.forEach((s) => s.service_variants?.sort((a, b) => a.sort - b.sort));
    this.staff.set(staff);
    this.categories.set(cats);
    this.services.set(services);
    this.products.set(products);
    this.courses.set(courses);
    this.settings.set(Object.fromEntries(settings.map((s) => [s.key, s.value])));
  }

  setting<T>(key: string, fallback: T): T {
    const v = this.settings()[key];
    return v === undefined || v === null ? fallback : (v as T);
  }

  async saveSetting(key: string, value: unknown) {
    await this.run(this.db.from('settings').upsert({ key, value }));
    this.settings.update((s) => ({ ...s, [key]: value }));
  }

  // ---------- staff ----------
  async saveStaff(s: Partial<Staff>) {
    await this.run(s.id ? this.db.from('staff').update(s).eq('id', s.id) : this.db.from('staff').insert(s));
    await this.loadReference();
  }
  staffBalances() {
    return this.run<StaffBalance[]>(this.db.from('v_staff_balances').select('*').order('name'));
  }
  staffEarnings(staffId: string, from: string, to: string) {
    return this.run<{ id: string; kind: string; amount: number; created_at: string; sales: { sold_at: string; total: number; client_id: string | null; guest_name: string | null; clients: { name: string } | null } }[]>(
      this.db.from('staff_earnings')
        .select('id, kind, amount, created_at, sales!inner(sold_at, total, client_id, guest_name, clients(name))')
        .eq('staff_id', staffId).gte('created_at', from).lt('created_at', to).order('created_at', { ascending: false }),
    );
  }
  staffPayouts(staffId: string) {
    return this.run<{ id: string; kind: string; amount: number; method: string; paid_at: string; note: string | null }[]>(
      this.db.from('staff_payouts').select('*').eq('staff_id', staffId).order('paid_at', { ascending: false }),
    );
  }
  addPayout(p: { staff_id: string; kind: string; amount: number; method: string; note?: string }) {
    return this.run(this.db.from('staff_payouts').insert(p));
  }

  // ---------- clients ----------
  searchClients(term: string, limit = 50) {
    let q = this.db.from('clients').select('*').order('name').limit(limit);
    const t = term.trim();
    if (t) q = q.or(`name.ilike.%${t.replace(/[%,()]/g, '')}%,phone.ilike.%${t.replace(/[%,()]/g, '')}%`);
    return this.run<Client[]>(q);
  }
  getClient(id: string) {
    return this.run<Client>(this.db.from('clients').select('*').eq('id', id).single());
  }
  async saveClient(c: Partial<Client>): Promise<Client> {
    const row = { ...c, phone: c.phone?.trim() || null };
    return this.run<Client>(
      c.id ? this.db.from('clients').update(row).eq('id', c.id).select().single()
           : this.db.from('clients').insert(row).select().single(),
    );
  }
  clientHistory(clientId: string) {
    return this.run<{ id: string; sold_at: string; total: number; balance: number; status: string; channel: string; sale_items: { name: string }[]; sale_staff: { staff: { name: string } }[] }[]>(
      this.db.from('sales').select('id, sold_at, total, balance, status, channel, sale_items(name), sale_staff(staff(name))')
        .eq('client_id', clientId).order('sold_at', { ascending: false }),
    );
  }

  // ---------- services & products ----------
  async saveService(s: Partial<Service>, variants: Partial<Variant>[]) {
    const { service_variants: _v, ...row } = s;
    const saved = await this.run<Service>(
      s.id ? this.db.from('services').update(row).eq('id', s.id).select().single()
           : this.db.from('services').insert(row).select().single(),
    );
    const keep = variants.filter((v) => v.id).map((v) => v.id!);
    const existing = this.services().find((x) => x.id === saved.id)?.service_variants ?? [];
    const removed = existing.filter((v) => !keep.includes(v.id)).map((v) => v.id);
    if (removed.length) await this.run(this.db.from('service_variants').delete().in('id', removed));
    for (const [i, v] of variants.entries()) {
      const vrow = { service_id: saved.id, name: v.name, price: v.price, sort: i + 1 };
      await this.run(v.id ? this.db.from('service_variants').update(vrow).eq('id', v.id) : this.db.from('service_variants').insert(vrow));
    }
    await this.loadReference();
  }
  async saveCategory(c: Partial<Category>) {
    await this.run(c.id ? this.db.from('service_categories').update(c).eq('id', c.id) : this.db.from('service_categories').insert(c));
    await this.loadReference();
  }
  async saveProduct(p: Partial<Product>) {
    await this.run(p.id ? this.db.from('products').update(p).eq('id', p.id) : this.db.from('products').insert(p));
    await this.loadReference();
  }

  // ---------- bookings ----------
  private readonly bookingSelect =
    '*, clients(name, phone), booking_services(*), booking_staff(staff_id, staff(name)), payments(amount, kind)';

  bookingsBetween(fromIso: string, toIso: string) {
    return this.run<Booking[]>(
      this.db.from('bookings').select(this.bookingSelect)
        .neq('channel', 'walkin').gte('scheduled_at', fromIso).lt('scheduled_at', toIso).order('scheduled_at'),
    );
  }
  /** scheduled times of salon / home bookings in a range (for the calendar counts) */
  bookingDays(fromIso: string, toIso: string) {
    return this.run<{ scheduled_at: string }[]>(
      this.db.from('bookings').select('scheduled_at').neq('channel', 'walkin')
        .not('status', 'in', '(cancelled,declined)').gte('scheduled_at', fromIso).lt('scheduled_at', toIso),
    );
  }
  walkinQueue() {
    return this.run<Booking[]>(
      this.db.from('bookings').select(this.bookingSelect)
        .eq('channel', 'walkin').in('status', ['waiting', 'in_progress']).order('created_at'),
    );
  }
  activeToday(fromIso: string, toIso: string) {
    return this.run<Booking[]>(
      this.db.from('bookings').select(this.bookingSelect)
        .or(`and(scheduled_at.gte.${fromIso},scheduled_at.lt.${toIso}),and(channel.eq.walkin,status.in.(waiting,in_progress))`)
        .order('scheduled_at', { nullsFirst: false }),
    );
  }
  /** Booked by clients in the app, waiting for the salon to answer. */
  onlineRequests() {
    return this.run<Booking[]>(
      this.db.from('bookings').select(this.bookingSelect).eq('status', 'requested').order('scheduled_at'),
    );
  }
  confirmBooking(id: string, note: string | null) {
    return this.run<string>(this.db.rpc('confirm_booking', { p_id: id, p_note: note }));
  }
  declineBooking(id: string, reason: string) {
    return this.run(this.db.rpc('decline_booking', { p_id: id, p_reason: reason }));
  }
  getBooking(id: string) {
    return this.run<Booking>(this.db.from('bookings').select(this.bookingSelect).eq('id', id).single());
  }
  /** Stylists already booked in an overlapping time window (double-booking check). */
  async busyStaff(startIso: string, durationMin: number, ignoreBookingId?: string): Promise<string[]> {
    const start = new Date(startIso).getTime();
    const end = start + durationMin * 60000;
    const dayStart = new Date(start - 12 * 3600000).toISOString();
    const rows = await this.run<{ id: string; scheduled_at: string; duration_min: number | null; booking_staff: { staff_id: string }[] }[]>(
      this.db.from('bookings').select('id, scheduled_at, duration_min, booking_staff(staff_id)')
        .in('status', ['requested', 'pending', 'booked', 'in_progress']).gte('scheduled_at', dayStart).lt('scheduled_at', new Date(end).toISOString()),
    );
    const busy = new Set<string>();
    for (const r of rows) {
      if (r.id === ignoreBookingId) continue;
      const s = new Date(r.scheduled_at).getTime();
      const e = s + (r.duration_min ?? 60) * 60000;
      if (s < end && e > start) r.booking_staff.forEach((b) => busy.add(b.staff_id));
    }
    return [...busy];
  }
  async saveBooking(b: Partial<Booking>, services: BookingService[], staffIds: string[]): Promise<string> {
    const { clients: _c, booking_services: _s, booking_staff: _st, payments: _p, ...row } = b;
    const saved = await this.run<Booking>(
      b.id ? this.db.from('bookings').update(row).eq('id', b.id).select().single()
           : this.db.from('bookings').insert(row).select().single(),
    );
    await this.run(this.db.from('booking_services').delete().eq('booking_id', saved.id));
    if (services.length) {
      await this.run(this.db.from('booking_services').insert(
        services.map((s) => ({ booking_id: saved.id, service_id: s.service_id, variant_id: s.variant_id, name: s.name, price: s.price })),
      ));
    }
    await this.run(this.db.from('booking_staff').delete().eq('booking_id', saved.id));
    if (staffIds.length) {
      await this.run(this.db.from('booking_staff').insert(staffIds.map((id) => ({ booking_id: saved.id, staff_id: id }))));
    }
    return saved.id;
  }
  setBookingStatus(id: string, status: BookingStatus, extra: Partial<Booking> = {}) {
    return this.run(this.db.from('bookings').update({ status, ...extra }).eq('id', id));
  }
  async setBookingStaff(id: string, staffIds: string[]) {
    await this.run(this.db.from('booking_staff').delete().eq('booking_id', id));
    if (staffIds.length) await this.run(this.db.from('booking_staff').insert(staffIds.map((s) => ({ booking_id: id, staff_id: s }))));
  }
  addDeposit(bookingId: string, p: PaymentInput) {
    return this.run<number>(this.db.rpc('add_deposit', {
      p_booking_id: bookingId, p_method: p.method, p_amount: p.amount,
      p_mpesa_ref: p.mpesa_ref || null, p_mpesa_at: toTodayIso(p.mpesa_time),
    }));
  }

  // ---------- checkout, sales, debts ----------
  checkout(payload: unknown) {
    return this.run<string>(this.db.rpc('checkout', { p: payload }));
  }
  salesBetween(fromIso: string, toIso: string) {
    return this.run<{ id: string; sold_at: string; total: number; paid: number; balance: number; status: string; channel: string; guest_name: string | null; void_reason: string | null; clients: { name: string } | null; sale_items: { name: string }[]; sale_staff: { staff: { name: string } }[]; entered: { name: string } | null; payments: { method: string; amount: number; mpesa_ref: string | null }[] }[]>(
      this.db.from('sales')
        .select('id, sold_at, total, paid, balance, status, channel, guest_name, void_reason, clients(name), sale_items(name), sale_staff(staff(name)), entered:staff!sales_entered_by_fkey(name), payments(method, amount, mpesa_ref)')
        .gte('sold_at', fromIso).lt('sold_at', toIso).order('sold_at', { ascending: false }),
    );
  }
  voidSale(id: string, reason: string) {
    return this.run(this.db.rpc('void_sale', { p_sale_id: id, p_reason: reason }));
  }
  debts() {
    return this.run<Debt[]>(this.db.from('v_debts').select('*').order('sold_at'));
  }
  clientDebt(clientId: string) {
    return this.run<Debt[]>(this.db.from('v_debts').select('*').eq('client_id', clientId));
  }
  payDebt(saleId: string, p: PaymentInput) {
    return this.run<number>(this.db.rpc('pay_debt', {
      p_sale_id: saleId, p_method: p.method, p_amount: p.amount,
      p_mpesa_ref: p.mpesa_ref || null, p_mpesa_at: toTodayIso(p.mpesa_time),
    }));
  }

  // ---------- school ----------
  async saveCourse(c: Partial<Course>) {
    await this.run(c.id ? this.db.from('courses').update(c).eq('id', c.id) : this.db.from('courses').insert(c));
    await this.loadReference();
  }
  students() {
    return this.run<Student[]>(this.db.from('v_student_balances').select('*').order('name'));
  }
  saveStudent(s: Partial<Student>) {
    const { course_name: _c, paid: _p, balance: _b, ...row } = s;
    return this.run(s.id ? this.db.from('students').update(row).eq('id', s.id) : this.db.from('students').insert(row));
  }
  studentPayments(studentId: string) {
    return this.run<{ id: string; amount: number; method: string; mpesa_ref: string | null; paid_at: string }[]>(
      this.db.from('payments').select('id, amount, method, mpesa_ref, paid_at').eq('student_id', studentId).order('paid_at', { ascending: false }),
    );
  }
  payStudentFee(studentId: string, p: PaymentInput) {
    return this.run(this.db.from('payments').insert({
      kind: 'school_fee', student_id: studentId, method: p.method, amount: p.amount,
      mpesa_ref: p.mpesa_ref ? p.mpesa_ref.toUpperCase() : null, mpesa_at: toTodayIso(p.mpesa_time),
    }));
  }

  /** Applications sent from the client app, waiting for the school. */
  courseApplications() {
    return this.run<{ id: string; name: string; phone: string | null; email: string | null; guardian_name: string | null; guardian_phone: string | null;
      preferred_start: string | null; notes: string | null; created_at: string; courses: { name: string } | null }[]>(
      this.db.from('course_applications').select('*, courses(name)').eq('status', 'requested').order('created_at'),
    );
  }
  acceptApplication(id: string, start?: string, totalFee?: number) {
    return this.run<string>(this.db.rpc('accept_application', { p_id: id, p_start: start ?? null, p_total_fee: totalFee ?? null }));
  }
  declineApplication(id: string, reason: string) {
    return this.run(this.db.rpc('decline_application', { p_id: id, p_reason: reason }));
  }

  // ---------- reports ----------
  report(from: string, to: string) {
    return this.run<Report>(this.db.rpc('sales_report', { p_from: from, p_to: to }));
  }
}

/** "14:32" (time on the M-Pesa SMS) → ISO timestamp today. */
function toTodayIso(time?: string): string | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
