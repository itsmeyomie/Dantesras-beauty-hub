-- =====================================================================
-- LIVE ONLY (Supabase SQL Editor, once): the jobs that send notifications.
--   every minute   → call the push-send Edge Function (sends waiting notifications)
--   every evening  → queue tomorrow's appointment reminders (18:00 Kenya time)
-- Needs migration 016 and the push-send function deployed. Free on Supabase.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname in ('dantesras-push', 'dantesras-reminders');

select cron.schedule('dantesras-push', '* * * * *', $$
  select net.http_post(
    url := 'https://frjflqepqhjkxfzknnoz.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-job-secret', (select secret from public.push_job_secret where id = 1)),
    body := '{}'::jsonb)
  where exists (select 1 from public.notifications where pushed_at is null and created_at > now() - interval '2 days');
$$);

-- 15:00 UTC = 18:00 in Kenya
select cron.schedule('dantesras-reminders', '0 15 * * *', $$ select public.queue_reminders(); $$);
