begin;
insert into public.club_settings(key,value) values('notification_delivery','"private_bot"'::jsonb) on conflict(key) do update set value=excluded.value;
-- Keep announcements in private bot chats. Previously connected groups stay disabled.
update public.notification_chat set active=false,updated_at=now() where active;
update public.notification_jobs set status='skipped' where chat_id is not null and status in ('pending','processing');
create unique index one_personal_book_notice on public.notification_jobs(member_id,book_id,book_generation) where member_id is not null and book_id is not null;

create or replace function private.refresh_book_announcement(selected uuid) returns void language plpgsql security definer set search_path='' as $$
declare current_book boolean; previous private.book_announcement_state;
begin
 perform pg_advisory_xact_lock(hashtextextended(selected::text,8));
 select b.status='reading' or (b.status not in ('finished','archived') and exists(select 1 from public.club_readings r where r.book_id=b.id and r.status='active')) into current_book from public.club_books b where b.id=selected;
 if current_book is null then return; end if;
 select * into previous from private.book_announcement_state where book_id=selected for update;
 if previous.book_id is not null and previous.is_current=current_book then return; end if;
 insert into private.book_announcement_state(book_id,is_current,generation) values(selected,current_book,coalesce(previous.generation,0)+1)
 on conflict(book_id) do update set is_current=excluded.is_current,generation=excluded.generation;
 update public.notification_jobs set status='skipped' where book_id=selected and status in ('pending','processing');
 if current_book then
  insert into public.notification_jobs(book_id,book_generation,meeting_version,member_id,kind,run_at)
  select selected,coalesce(previous.generation,0)+1,1,id,'selected_book',now() from public.club_members where active on conflict do nothing;
 end if;
end $$;

create or replace function private.schedule_meeting() returns trigger language plpgsql security definer set search_path='' as $$
declare k text:=case when new.cancelled then 'cancelled' when tg_op='INSERT' then 'new' else 'changed' end;
begin
 update public.notification_jobs set status='skipped' where meeting_id=new.id and status in ('pending','processing');
 if new.starts_at<=now() then return new; end if;
 insert into public.notification_jobs(meeting_id,meeting_version,member_id,kind,run_at)
 select new.id,new.version,id,k,now() from public.club_members where active on conflict do nothing;
 if not new.cancelled and new.starts_at-interval '24 hours'>now() then
  insert into public.notification_jobs(meeting_id,meeting_version,member_id,kind,run_at)
  select new.id,new.version,id,'24h',new.starts_at-interval '24 hours' from public.club_members where active on conflict do nothing;
 end if; return new;
end $$;

create function private.schedule_private_reminders(selected uuid) returns void language sql security definer set search_path='' as $$
 insert into public.notification_jobs(meeting_id,meeting_version,member_id,kind,run_at)
 select m.id,m.version,selected,'24h',m.starts_at-interval '24 hours'
 from public.meetings m join public.club_members c on c.id=selected and c.active
 where not m.cancelled and m.starts_at-interval '24 hours'>now()
 on conflict(meeting_id,member_id,meeting_version,kind) do update
 set status='pending',run_at=excluded.run_at,attempts=0,last_error=null
 where notification_jobs.status='skipped';
$$;
create function private.member_notification_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.active then perform private.schedule_private_reminders(new.id);
 else update public.notification_jobs set status='skipped' where member_id=new.id and status in ('pending','processing');
 end if;
 return null;
end $$;
create trigger member_notification_access after insert or update of active on public.club_members for each row execute function private.member_notification_trigger();

-- Restore only future reminders, never resend old book or meeting announcements on update.
do $$declare member uuid;begin
 for member in select id from public.club_members where active loop perform private.schedule_private_reminders(member); end loop;
end $$;
create or replace function public.connect_notification_chat(p_telegram bigint,p_chat bigint,p_title text,p_active boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 raise exception 'Уведомления приходят в личный чат с ботом. Групповая рассылка отключена';
end $$;
revoke all on function public.connect_notification_chat(bigint,bigint,text,boolean) from public,anon,authenticated,service_role;
revoke all on function private.refresh_book_announcement(uuid),private.schedule_meeting(),private.schedule_private_reminders(uuid),private.member_notification_trigger() from public,anon,authenticated;
commit;
