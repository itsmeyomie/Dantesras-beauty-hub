-- TEST LOGINS for the internal test database only (never load into the live database).
-- Runs on every start; only touches staff that don't have an account yet.
--   owner@dantesras.test      / test1234   Owner
--   manager@dantesras.test    / test1234   Esther Muthoni  (manager + stylist)
--   reception@dantesras.test  / test1234   Joy Atieno      (receptionist)
--   stylist@dantesras.test    / test1234   Wanjiku Kamau   (stylist)
--   finisher@dantesras.test   / test1234   Faith Wambui    (finisher)
--   dev@dantesras.test        / test1234   Dev Tester      (owner + developer, /dev panel)
update staff set email = 'owner@dantesras.test', password_hash = crypt('test1234', gen_salt('bf')), account_status = 'approved', active = true
 where id = (select id from staff where 'owner' = any(roles) order by created_at limit 1) and email is null;
update staff set email = 'manager@dantesras.test', password_hash = crypt('test1234', gen_salt('bf')), account_status = 'approved',
       roles = '{manager,stylist}', specialty = 'Braids · knotless'
 where name = 'Esther Muthoni' and email is null;
update staff set email = 'reception@dantesras.test', password_hash = crypt('test1234', gen_salt('bf')), account_status = 'approved',
       roles = '{receptionist}'
 where name = 'Joy Atieno' and email is null;
update staff set email = 'stylist@dantesras.test', password_hash = crypt('test1234', gen_salt('bf')), account_status = 'approved',
       specialty = 'Nails · gel & builder gel'
 where name = 'Wanjiku Kamau' and email is null;
update staff set email = 'finisher@dantesras.test', password_hash = crypt('test1234', gen_salt('bf')), account_status = 'approved',
       roles = '{finisher}', specialty = 'Finishing · ends & edges'
 where name = 'Faith Wambui' and email is null;

-- developer (the /dev panel):  dev@dantesras.test / test1234   "Dev Tester" (owner + developer)
insert into staff(name, email, password_hash, roles, account_status, active)
select 'Dev Tester', 'dev@dantesras.test', crypt('test1234', gen_salt('bf')), '{owner}', 'approved', true
 where not exists (select 1 from staff where email = 'dev@dantesras.test');
insert into developers(email) values ('dev@dantesras.test') on conflict do nothing;
