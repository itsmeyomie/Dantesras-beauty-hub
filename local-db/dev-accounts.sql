-- TEST LOGINS for the internal test database only (never load into the live database).
-- Runs on every start; only touches staff that don't have an account yet.
--   owner@dantesras.test      / test1234   Owner
--   manager@dantesras.test    / test1234   Esther Muthoni  (manager + stylist)
--   reception@dantesras.test  / test1234   Joy Atieno      (receptionist)
--   stylist@dantesras.test    / test1234   Wanjiku Kamau   (stylist)
--   finisher@dantesras.test   / test1234   Faith Wambui    (finisher)
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
