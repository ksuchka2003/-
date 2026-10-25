-- Выполняется вручную после развёртывания функций. Секреты предварительно создайте в Vault.
-- Vault names: bookclub_project_url, bookclub_cron_secret, bookclub_anon_key.
-- Значения не должны попадать в Git. Включите pg_cron и pg_net через Dashboard → Integrations.
select cron.schedule('bookclub-notifications','* * * * *',$$
 select net.http_post(
   url := (select decrypted_secret from vault.decrypted_secrets where name='bookclub_project_url') || '/functions/v1/notifications',
   headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='bookclub_anon_key'),'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='bookclub_cron_secret')),
   body := '{}'::jsonb,
   timeout_milliseconds := 10000
 );
$$);
-- Для остановки: select cron.unschedule('bookclub-notifications');
