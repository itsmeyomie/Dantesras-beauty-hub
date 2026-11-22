-- =====================================================================
-- Dantesras Beauty Hub & Hair and Beauty School – database schema
-- Run in Supabase: Dashboard → SQL Editor → paste → Run (once).
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------- Settings (owner-configurable rules) ----------
create table if not exists settings (
  key   text primary key,
  value jsonb not null
);

-- ---------- Staff ----------
create table if not exists staff (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  roles      text[] not null default '{stylist}',
  basic_salary numeric(12,2) not null default 0,
  payout_schedule text not null default 'weekly'
             check (payout_schedule in ('daily','weekly','biweekly','monthly')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Clients ----------
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text unique,
  whatsapp    text,
  birth_date  date,
  gender      text,
  area        text,
  source      text,
  notes       text,
  parent_id   uuid references clients(id) on delete set null,
  preferred_staff_id uuid references staff(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists clients_name_idx on clients (lower(name));

-- ---------- Service menu ----------
create table if not exists service_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  client_type text not null default 'any' check (client_type in ('kids','adult','any')),
  sort        int not null default 0
);

create table if not exists services (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references service_categories(id) on delete restrict,
  name           text not null,
  price          numeric(12,2) not null check (price >= 0),
  -- fixed: price only · range: price..max_price · from: price or more
  price_type     text not null default 'fixed' check (price_type in ('fixed','range','from')),
  max_price      numeric(12,2),
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 50),
  active         boolean not null default true,
  sort           int not null default 0,
  created_at     timestamptz not null default now()
);

create table if not exists service_variants (
  id         uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  name       text not null,
  price      numeric(12,2) not null check (price >= 0),
  sort       int not null default 0
);

-- Per-staff commission override for a service (staff rate wins)
create table if not exists staff_commission_overrides (
  staff_id   uuid not null references staff(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  pct        numeric(5,2) not null check (pct between 0 and 50),
  primary key (staff_id, service_id)
);

-- ---------- Products ----------
create table if not exists products (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  category       text,
  unit           text not null default 'piece',
  price          numeric(12,2) not null default 0,
  cost           numeric(12,2) not null default 0,
  stock_qty      numeric(12,2) not null default 0,
  low_stock      numeric(12,2) not null default 0,
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 50),
  status         text not null default 'active' check (status in ('active','pending','inactive')),
  created_at     timestamptz not null default now()
);

-- ---------- Bookings (salon / home / walk-in) ----------
create table if not exists bookings (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references clients(id) on delete set null,
  guest_name      text,
  channel         text not null check (channel in ('salon','home','walkin')),
  source          text,
  status          text not null default 'pending'
                  check (status in ('pending','booked','waiting','in_progress','completed','cancelled','no_show')),
  scheduled_at    timestamptz,
  duration_min    int,
  address         text,
  stylists_needed int not null default 1,
  transport_fee   numeric(12,2) not null default 0,
  notes           text,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  check (client_id is not null or guest_name is not null)
);
create index if not exists bookings_sched_idx on bookings (scheduled_at);
create index if not exists bookings_status_idx on bookings (status);

create table if not exists booking_services (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  service_id uuid references services(id) on delete set null,
  variant_id uuid references service_variants(id) on delete set null,
  name       text not null,
  price      numeric(12,2) not null
);

create table if not exists booking_staff (
  booking_id uuid not null references bookings(id) on delete cascade,
  staff_id   uuid not null references staff(id) on delete cascade,
  primary key (booking_id, staff_id)
);

-- ---------- Sales ----------
create table if not exists sales (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid references bookings(id) on delete set null,
  client_id       uuid references clients(id) on delete set null,
  guest_name      text,
  channel         text not null default 'salon' check (channel in ('salon','home','walkin')),
  sold_at         timestamptz not null default now(),
  subtotal        numeric(12,2) not null default 0,
  discount        numeric(12,2) not null default 0,
  discount_reason text,
  transport_fee   numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  paid            numeric(12,2) not null default 0,
  balance         numeric(12,2) not null default 0,
  status          text not null default 'completed' check (status in ('completed','void')),
  void_reason     text,
  entered_by      uuid references staff(id) on delete set null,
  notes           text
);
create index if not exists sales_sold_at_idx on sales (sold_at);

create table if not exists sale_items (
  id             uuid primary key default gen_random_uuid(),
  sale_id        uuid not null references sales(id) on delete cascade,
  kind           text not null check (kind in ('service','product')),
  service_id     uuid references services(id) on delete set null,
  variant_id     uuid references service_variants(id) on delete set null,
  product_id     uuid references products(id) on delete set null,
  name           text not null,
  qty            numeric(12,2) not null default 1,
  unit_price     numeric(12,2) not null,
  unit_cost      numeric(12,2) not null default 0,
  line_total     numeric(12,2) not null,
  commission_pct numeric(5,2) not null default 0
);

create table if not exists sale_staff (
  sale_id   uuid not null references sales(id) on delete cascade,
  staff_id  uuid not null references staff(id) on delete restrict,
  share_pct numeric(5,2) not null check (share_pct > 0 and share_pct <= 100),
  primary key (sale_id, staff_id)
);

-- Commission + transport earned per staff per sale
create table if not exists staff_earnings (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid not null references sales(id) on delete cascade,
  staff_id   uuid not null references staff(id) on delete restrict,
  kind       text not null check (kind in ('commission','transport')),
  amount     numeric(12,2) not null,
  created_at timestamptz not null default now()
);

-- Payouts and advances to staff
create table if not exists staff_payouts (
  id       uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete restrict,
  kind     text not null default 'payout' check (kind in ('payout','advance','bonus')),
  amount   numeric(12,2) not null check (amount > 0),
  method   text not null default 'cash',
  paid_at  timestamptz not null default now(),
  note     text
);

-- ---------- School ----------
create table if not exists courses (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  fee            numeric(12,2) not null,
  fee_type       text not null default 'total' check (fee_type in ('total','monthly')),
  duration_value int not null,
  duration_unit  text not null default 'weeks' check (duration_unit in ('weeks','months')),
  active         boolean not null default true
);

create table if not exists students (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  phone          text,
  guardian_name  text,
  guardian_phone text,
  course_id      uuid not null references courses(id) on delete restrict,
  start_date     date not null default current_date,
  status         text not null default 'active' check (status in ('active','completed','dropped')),
  total_fee      numeric(12,2) not null,
  notes          text,
  created_at     timestamptz not null default now()
);

-- ---------- Payments (sales, deposits, debt repayments, school fees) ----------
create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('sale','deposit','debt','school_fee')),
  sale_id     uuid references sales(id) on delete cascade,
  booking_id  uuid references bookings(id) on delete set null,
  student_id  uuid references students(id) on delete cascade,
  client_id   uuid references clients(id) on delete set null,
  method      text not null check (method in ('cash','mpesa_till','mpesa_paybill','mpesa_send','card')),
  amount      numeric(12,2) not null check (amount > 0),
  mpesa_ref   text,          -- last 3 characters of the M-Pesa code
  mpesa_at    timestamptz,   -- time shown on the M-Pesa message
  paid_at     timestamptz not null default now(),
  note        text,
  check (method not like 'mpesa%' or (mpesa_ref is not null and length(mpesa_ref) = 3))
);
create index if not exists payments_paid_at_idx on payments (paid_at);
create index if not exists payments_sale_idx on payments (sale_id);
