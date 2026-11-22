-- =====================================================================
-- School in the client app: apply for a course, the school accepts (→ student + fee balance)
-- or declines; enrolled students see their fee balance and pay by M-Pesa prompt.
-- Run after 005_client_portal.sql.
-- =====================================================================

alter table students add column if not exists client_id uuid references clients(id) on delete set null;
alter table students add column if not exists email text;

create table if not exists course_applications (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references clients(id) on delete set null,
  course_id       uuid not null references courses(id) on delete restrict,
  name            text not null,
  phone           text,
  email           text,
  guardian_name   text,
  guardian_phone  text,
  preferred_start date,
  notes           text,
  status          text not null default 'requested' check (status in ('requested','accepted','declined','withdrawn')),
  response_note   text,
  student_id      uuid references students(id) on delete set null,
  created_at      timestamptz not null default now(),
  answered_at     timestamptz
);
create index if not exists course_app_status_idx on course_applications (status, created_at);

-- Full fee for a course (monthly fee × months, or the total)
create or replace function course_total(p_course uuid) returns numeric language sql stable as $$
  select case when fee_type = 'monthly'
              then fee * case when duration_unit = 'months' then duration_value else ceil(duration_value / 4.33) end
              else fee end
  from courses where id = p_course
$$;

-- ---------- client app ----------
-- p = { course_id, name, phone, email?, guardian_name?, guardian_phone?, preferred_start?, notes? }
create or replace function portal_apply_course(p_token text, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid := portal_client(p_token); v_course courses; v_id uuid; v_start date := nullif(p->>'preferred_start', '')::date;
begin
  select * into v_course from courses where id = nullif(p->>'course_id', '')::uuid and active;
  if v_course.id is null then raise exception 'Choose a course'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Enter the student''s full name'; end if;
  if mpesa_phone(p->>'phone') is null then raise exception 'Enter a valid phone number for the student'; end if;
  if nullif(p->>'guardian_phone', '') is not null and mpesa_phone(p->>'guardian_phone') is null then
    raise exception 'Enter a valid phone number for the guardian / next of kin';
  end if;
  if v_start is not null and v_start < (now() at time zone 'Africa/Nairobi')::date then raise exception 'Choose a start date from today on'; end if;
  if exists (select 1 from course_applications where client_id = v and course_id = v_course.id and status = 'requested') then
    raise exception 'You already applied for %. The school will contact you.', v_course.name;
  end if;
  insert into course_applications(client_id, course_id, name, phone, email, guardian_name, guardian_phone, preferred_start, notes)
  values (v, v_course.id, trim(p->>'name'), '0' || substr(mpesa_phone(p->>'phone'), 4), lower(nullif(trim(p->>'email'), '')),
          nullif(trim(p->>'guardian_name'), ''),
          case when nullif(p->>'guardian_phone', '') is not null then '0' || substr(mpesa_phone(p->>'guardian_phone'), 4) end,
          v_start, nullif(trim(p->>'notes'), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function portal_school(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := portal_client(p_token);
begin
  return jsonb_build_object(
    'applications', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'course', c.name, 'name', a.name, 'status', a.status,
        'preferred_start', a.preferred_start, 'response_note', a.response_note, 'created_at', a.created_at,
        'total', course_total(c.id)) order by a.created_at desc)
      from course_applications a join courses c on c.id = a.course_id where a.client_id = v), '[]'::jsonb),
    'enrolments', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'course', s.course_name, 'start_date', s.start_date,
        'status', s.status, 'total_fee', s.total_fee, 'paid', s.paid, 'balance', s.balance, 'phone', s.phone) order by s.start_date desc)
      from v_student_balances s where s.client_id = v), '[]'::jsonb));
end $$;

create or replace function portal_withdraw_application(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := portal_client(p_token);
begin
  update course_applications set status = 'withdrawn', answered_at = now() where id = p_id and client_id = v and status = 'requested';
  if not found then raise exception 'This application was already answered'; end if;
end $$;

-- ---------- school side ----------
create or replace function accept_application(p_id uuid, p_start date default null, p_total_fee numeric default null, p_note text default null)
returns uuid language plpgsql as $$
declare a course_applications; v_student uuid;
begin
  select * into a from course_applications where id = p_id for update;
  if a.id is null then raise exception 'Application not found'; end if;
  if a.status <> 'requested' then raise exception 'This application was already answered'; end if;
  insert into students(name, phone, email, guardian_name, guardian_phone, course_id, start_date, total_fee, client_id, notes)
  values (a.name, a.phone, a.email, a.guardian_name, a.guardian_phone, a.course_id,
          coalesce(p_start, a.preferred_start, current_date), coalesce(p_total_fee, course_total(a.course_id)), a.client_id,
          'Applied in the app' || coalesce(': ' || a.notes, ''))
  returning id into v_student;
  update course_applications set status = 'accepted', student_id = v_student, answered_at = now(), response_note = nullif(trim(p_note), '')
   where id = p_id;
  return v_student;
end $$;

create or replace function decline_application(p_id uuid, p_reason text) returns void
language plpgsql as $$
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the applicant a reason'; end if;
  update course_applications set status = 'declined', response_note = trim(p_reason), answered_at = now()
   where id = p_id and status = 'requested';
  if not found then raise exception 'This application was already answered'; end if;
end $$;

-- the student-balance view gains client_id (st.* already includes it once the column exists)
drop view if exists v_student_balances;
create view v_student_balances with (security_invoker = true) as
select st.*, co.name as course_name,
       coalesce((select sum(amount) from payments p where p.student_id = st.id and p.kind = 'school_fee'),0) as paid,
       st.total_fee - coalesce((select sum(amount) from payments p where p.student_id = st.id and p.kind = 'school_fee'),0) as balance
from students st join courses co on co.id = st.course_id;

alter table course_applications enable row level security;
drop policy if exists dev_open_access on course_applications;
-- DEVELOPMENT ONLY (same as the other tables until staff login is built)
create policy dev_open_access on course_applications for all to anon, authenticated using (true) with check (true);
