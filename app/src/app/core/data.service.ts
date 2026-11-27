import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import {
  Booking, BookingService, BookingStatus, Category, Client, Course, Debt, PaymentInput, Product, Report,
  Service, Staff, StaffBalance, StaffRoleDef, Student, Variant,
} from './models';

/** Adds the staff sign-in token (saved by StaffAuthService) to every database request. */
const staffFetch: typeof fetch = (input, init = {}) => {
  let token: string | null = null;
  try { token = localStorage.getItem('dbh.staff.token'); } catch { /* private mode */ }
  if (!token) return fetch(input, init);
  const headers = new Headers(init.headers);
  headers.set('x-staff-token', token);
  return fetch(input, { ...init, headers });
};

/** Staff columns the app may read (never the password hash). */
const STAFF_COLUMNS = 'id, name, phone, roles, basic_salary, payout_schedule, active, created_at, email, photo, specialty, account_status';

/** Single gateway to Supabase. Every page talks to the database through here. */
@Injectable({ providedIn: 'root' })
export class DataService {
  readonly configured = !environment.supabaseUrl.includes('YOUR-PROJECT') && !environment.supabaseAnonKey.includes('YOUR-');
  private readonly db: SupabaseClient = createClient(
    this.configured ? environment.supabaseUrl : 'https://placeholder.supabase.co',
    this.configured ? environment.supabaseAnonKey : 'placeholder',
    {
      auth: { persistSession: false, autoRefreshToken: false },
      // every request carries the staff sign-in token (if any); the database checks it and the role's screens
      global: { fetch: staffFetch },
    },
  );

  /** Shared reference data, loaded once and refreshed after edits. */
  readonly staff = signal<Staff[]>([]);
  readonly roles = signal<StaffRoleDef[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly services = signal<Service[]>([]);
  readonly products = signal<Product[]>([]);
  readonly courses = signal<Course[]>([]);
  readonly settings = signal<Record<string, unknown>>({});

  private async run<T = unknown>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
    if (!this.configured) throw new Error('Supabase is not configured yet (see src/environments/environment.ts).');
    const { data, error } = await q;
    if (error) {
      if (error.message.includes('SERVICE_PAUSED')) window.dispatchEvent(new CustomEvent('dbh-paused', { detail: error.message }));
      throw new Error(error.message);
    }
    return data as T;
  }

  // ---------- client sign-in through Supabase Auth (email code / Google) ----------
  private authClient?: SupabaseClient;
  /** Separate client that keeps the short Supabase Auth sign-in (needed for the Google redirect). */
  private get auth(): SupabaseClient {
    this.authClient ??= createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'pkce', storageKey: 'dbh.client-auth' },
    });
    return this.authClient;
  }
  private authError(e: { message: string }): Error {
    const m = e.message;
    if (/expired|invalid/i.test(m) && /token|otp/i.test(m)) return new Error('Wrong or expired code. Check the email or ask for a new one.');
    if (/rate limit|security purposes|seconds/i.test(m)) return new Error('Please wait a minute before asking for another code.');
    if (/Failed to fetch|network/i.test(m)) return new Error('No connection to the server. Check the internet and try again.');
    return new Error(m);
  }
  /** Email a 6-digit sign-in code. */
  async authEmailCode(email: string) {
    const { error } = await this.auth.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw this.authError(error);
  }
  /** Check the emailed code, then open the client's session. */
  async authVerifyEmail(email: string, code: string) {
    const { error } = await this.auth.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw this.authError(error);
    return this.portalFromAuth();
  }
  /** Staff "Forgot password?": check the emailed code, then set the new password. */
  async authStaffReset(email: string, code: string, password: string) {
    const { error } = await this.auth.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw this.authError(error);
    try {
      return await this.run<{ ok: boolean; name: string }>(this.auth.rpc('staff_reset_password', { p_password: password }));
    } finally {
      await this.auth.auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
  }
  /** Address of Google's sign-in page; Google sends the client back to redirectTo with a code. */
  async authGoogleUrl(redirectTo: string): Promise<string> {
    const { data, error } = await this.auth.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
    if (error || !data.url) throw this.authError(error ?? { message: 'Google sign-in is not available' });
    return data.url;
  }
  /** Back from Google with ?code=… */
  async authFinishGoogle(code: string) {
    const { error } = await this.auth.auth.exchangeCodeForSession(code);
    if (error) throw this.authError(error);
    return this.portalFromAuth();
  }
  /** Staff back from Google: sign in the staff account that uses this Google email. */
  async authFinishGoogleStaff<T>(code: string): Promise<T> {
    const { error } = await this.auth.auth.exchangeCodeForSession(code);
    if (error) throw this.authError(error);
    try {
      return await this.run<T>(this.auth.rpc('staff_login_google', {}));
    } finally {
      await this.auth.auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
  }
  private async portalFromAuth() {
    try {
      return await this.run<{ token: string; is_new: boolean; client_id: string }>(this.auth.rpc('portal_from_auth', {}));
    } finally {
      await this.auth.auth.signOut({ scope: 'local' }).catch(() => undefined); // the salon session takes over
    }
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
  private staffLoadedAt = 0;
  /** Re-read the team and roles (people approved or changed on another phone show up). Skips if read in the last `minAgeMs`. */
  async refreshStaff(minAgeMs = 0): Promise<void> {
    if (Date.now() - this.staffLoadedAt < minAgeMs) return;
    this.staffLoadedAt = Date.now();
    const [staff, roles] = await Promise.all([this.run<Staff[]>(this.db.from('staff').select(STAFF_COLUMNS).order('name')), this.loadRoles()]);
    this.roles.set(roles);
    this.staff.set(staff);
  }
  async loadReference(): Promise<void> {
    this.staffLoadedAt = Date.now();
    const [staff, cats, services, products, courses, settings, roles] = await Promise.all([
      this.run<Staff[]>(this.db.from('staff').select(STAFF_COLUMNS).order('name')),
      this.run<Category[]>(this.db.from('service_categories').select('*').order('sort')),
      this.run<Service[]>(this.db.from('services').select('*, service_variants(*)').order('sort').order('name')),
      this.run<Product[]>(this.db.from('products').select('*').order('name')),
      this.run<Course[]>(this.db.from('courses').select('*').order('name')),
      this.run<{ key: string; value: unknown }[]>(this.db.from('settings').select('*')),
      this.loadRoles(),
    ]);
    this.roles.set(roles);
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
    if (s.id) {
      // roles only through the owner-only function; other account fields are never written directly
      const { id, name, phone, basic_salary, payout_schedule, active, roles } = s;
      await this.run(this.db.from('staff').update({ name, phone, basic_salary, payout_schedule, active }).eq('id', id));
      if (roles) await this.run(this.db.rpc('staff_set_roles', { p_token: localStorage.getItem('dbh.staff.token'), p_id: id, p_roles: roles }));
    } else {
      const { name, phone, basic_salary, payout_schedule, active, roles } = s;
      await this.run(this.db.from('staff').insert({ name, phone, basic_salary, payout_schedule, active, roles }));
    }
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
    '*, clients(name, phone), booking_services(*), booking_staff(staff_id, part, staff(name)), payments(amount, kind)';

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
    await this.run(this.db.from('booking_staff').delete().eq('booking_id', saved.id).eq('part', 'main'));
    if (staffIds.length) {
      await this.run(this.db.from('booking_staff').insert(staffIds.map((id) => ({ booking_id: saved.id, staff_id: id }))));
    }
    return saved.id;
  }
  /** Check a client in (start). Before the booking day a reason is needed; the booking then moves to today. */
  startBooking(id: string, reason: string | null = null) {
    return this.run<{ id: string; status: string; moved: boolean }>(this.db.rpc('start_booking', { p_id: id, p_reason: reason }));
  }
  setBookingStatus(id: string, status: BookingStatus, extra: Partial<Booking> = {}) {
    return this.run(this.db.from('bookings').update({ status, ...extra }).eq('id', id));
  }
  /** Roles (jobs) and the screens each can open. */
  loadRoles() {
    return this.run<StaffRoleDef[]>(this.db.from('staff_roles').select('*').order('sort'));
  }
  async refreshRoles() {
    this.roles.set(await this.loadRoles());
  }
  /** Name of a role key, e.g. finisher → Finisher */
  roleName(key: string | null | undefined): string {
    return this.roles().find((r) => r.key === key)?.name ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : '');
  }
  /** Main stylist(s) and an optional finisher on a booking. */
  async setBookingStaff(id: string, staffIds: string[], finisherIds: string[] = []) {
    const rows = [...staffIds.map((s) => ({ booking_id: id, staff_id: s, part: 'main' })),
      ...finisherIds.filter((f) => !staffIds.includes(f)).map((s) => ({ booking_id: id, staff_id: s, part: 'finisher' }))];
    // remove only the people taken off; people who stay are not re-added (so they are not notified again)
    let gone = this.db.from('booking_staff').delete().eq('booking_id', id);
    if (rows.length) gone = gone.not('staff_id', 'in', `(${rows.map((r) => r.staff_id).join(',')})`);
    await this.run(gone);
    if (rows.length) await this.run(this.db.from('booking_staff').upsert(rows, { onConflict: 'booking_id,staff_id' }));
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
