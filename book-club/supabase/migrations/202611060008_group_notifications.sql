begin;
-- A single explicitly connected group. Chat IDs and connection controls are admin-only.
create table public.notification_chat (
 singleton boolean primary key default true check(singleton),
 chat_id bigint not null check(chat_id<0), title text not null check(length(title)<=300),
 generation uuid not null default gen_random_uuid(), active boolean not null default true,
 connected_by uuid not null references public.club_members, updated_at timestamptz not null default now()
);
alter table public.notification_chat enable row level security;
revoke all on public.notification_chat from public,anon,authenticated;
grant select on public.notification_chat to authenticated;
grant all on public.notification_chat to service_role;
create policy notification_chat_admin on public.notification_chat for select to authenticated using(public.is_admin());

alter table public.notification_jobs alter column member_id drop not null;
alter table public.notification_jobs alter column meeting_id drop not null;
alter table public.notification_jobs add column chat_id bigint check(chat_id<0), add column chat_generation uuid,
 add column book_id uuid references public.club_books on delete cascade, add column book_generation bigint;
alter table public.notification_jobs drop constraint notification_jobs_kind_check;
alter table public.notification_jobs add constraint notification_jobs_kind_check check(kind in ('new','changed','cancelled','24h','1h','selected_book'));
alter table public.notification_jobs add constraint notification_target check((member_id is not null and chat_id is null) or (member_id is null and chat_id is not null and chat_generation is not null));
alter table public.notification_jobs add constraint notification_subject check(
 (meeting_id is not null and book_id is null and kind<>'selected_book') or
 (meeting_id is null and book_id is not null and kind='selected_book' and book_generation is not null));
create unique index one_group_meeting_notice on public.notification_jobs(chat_generation,meeting_id,meeting_version,kind) where chat_id is not null;
create unique index one_group_book_notice on public.notification_jobs(chat_generation,book_id,book_generation) where book_id is not null;
-- Do not deliver old invitations privately after switching to group announcements.
update public.notification_jobs set status='skipped' where status in ('pending','processing');

create table private.book_announcement_state (
 book_id uuid primary key references public.club_books on delete cascade,
 is_current boolean not null, generation bigint not null default 1
);
insert into private.book_announcement_state(book_id,is_current)
select b.id,b.status='reading' or (b.status not in ('finished','archived') and exists(select 1 from public.club_readings r where r.book_id=b.id and r.status='active')) from public.club_books b;

create function private.refresh_book_announcement(selected uuid) returns void language plpgsql security definer set search_path='' as $$
declare current_book boolean; previous private.book_announcement_state; target public.notification_chat;
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
  select * into target from public.notification_chat where active;
  if target.chat_id is not null then
   insert into public.notification_jobs(book_id,book_generation,meeting_version,chat_id,chat_generation,kind,run_at)
   values(selected,coalesce(previous.generation,0)+1,1,target.chat_id,target.generation,'selected_book',now()) on conflict do nothing;
  end if;
 end if;
end $$;
create function private.book_announcement_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='club_books' then perform private.refresh_book_announcement(new.id);
 else
  if tg_op<>'INSERT' then perform private.refresh_book_announcement(old.book_id); end if;
  if tg_op<>'DELETE' then perform private.refresh_book_announcement(new.book_id); end if;
 end if;
 return null;
end $$;
create trigger book_announcements after insert or update of status on public.club_books for each row execute function private.book_announcement_trigger();
create trigger reading_announcements after insert or update or delete on public.club_readings for each row execute function private.book_announcement_trigger();

create or replace function private.schedule_meeting() returns trigger language plpgsql security definer set search_path='' as $$
declare k text:=case when new.cancelled then 'cancelled' when tg_op='INSERT' then 'new' else 'changed' end; target public.notification_chat;
begin
 update public.notification_jobs set status='skipped' where meeting_id=new.id and status in ('pending','processing');
 select * into target from public.notification_chat where active;
 if new.starts_at<=now() or target.chat_id is null then return new; end if;
 insert into public.notification_jobs(meeting_id,meeting_version,chat_id,chat_generation,kind,run_at)
 values(new.id,new.version,target.chat_id,target.generation,k,now()) on conflict do nothing;
 if not new.cancelled and new.starts_at-interval '24 hours'>now() then
  insert into public.notification_jobs(meeting_id,meeting_version,chat_id,chat_generation,kind,run_at)
  values(new.id,new.version,target.chat_id,target.generation,'24h',new.starts_at-interval '24 hours') on conflict do nothing;
 end if; return new;
end $$;

-- Called only from the authenticated Telegram webhook, after getChatMember checks.
create function public.connect_notification_chat(p_telegram bigint,p_chat bigint,p_title text,p_active boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; target public.notification_chat; fresh boolean;
begin
 select id into actor from public.club_members where telegram_id=p_telegram and active and role='admin';
 if actor is null or p_chat>=0 or p_chat is null then raise exception 'Требуется администратор клуба и групповой чат'; end if;
 perform pg_advisory_xact_lock(8008);
 select * into target from public.notification_chat for update;
 if not p_active then
  if target.chat_id is distinct from p_chat then raise exception 'Эта группа не подключена'; end if;
  update public.notification_chat set active=false,updated_at=now();
  update public.notification_jobs set status='skipped' where chat_id is not null and status in ('pending','processing');
  return jsonb_build_object('active',false);
 end if;
 fresh:=target.chat_id is distinct from p_chat or not coalesce(target.active,false);
 if fresh then
  update public.notification_jobs set status='skipped' where chat_id is not null and status in ('pending','processing');
 end if;
 insert into public.notification_chat(chat_id,title,connected_by) values(p_chat,left(p_title,300),actor)
 on conflict(singleton) do update set chat_id=excluded.chat_id,title=excluded.title,connected_by=excluded.connected_by,active=true,updated_at=now(),
 generation=case when fresh then gen_random_uuid() else notification_chat.generation end
 returning * into target;
 if fresh then
  insert into public.notification_jobs(book_id,book_generation,meeting_version,chat_id,chat_generation,kind,run_at)
  select s.book_id,s.generation,1,target.chat_id,target.generation,'selected_book',now() from private.book_announcement_state s where s.is_current on conflict do nothing;
  insert into public.notification_jobs(meeting_id,meeting_version,chat_id,chat_generation,kind,run_at)
  select id,version,target.chat_id,target.generation,'new',now() from public.meetings where not cancelled and starts_at>now() on conflict do nothing;
  insert into public.notification_jobs(meeting_id,meeting_version,chat_id,chat_generation,kind,run_at)
  select id,version,target.chat_id,target.generation,'24h',starts_at-interval '24 hours' from public.meetings where not cancelled and starts_at-interval '24 hours'>now() on conflict do nothing;
 end if;
 return jsonb_build_object('active',true,'changed',fresh);
end $$;
create function public.migrate_notification_chat(p_old bigint,p_new bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_new>=0 or p_new is null then raise exception 'Неверная группа'; end if;
 update public.notification_chat set chat_id=p_new,updated_at=now() where chat_id=p_old;
 update public.notification_jobs set chat_id=p_new where chat_id=p_old and status in ('pending','processing');
end $$;
create function public.book_announcement_current(p_book uuid,p_generation bigint) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.book_announcement_state where book_id=p_book and generation=p_generation and is_current);
$$;
-- Disable legacy attendance writes while retaining existing records.
alter function public.club_action(text,jsonb) rename to club_action_v7;
revoke all on function public.club_action_v7(text,jsonb) from public,anon,authenticated;
create function public.club_action(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_action='attendance' then raise exception 'Обсудите участие во встрече в чате клуба'; end if;
 return public.club_action_v7(p_action,p_data);
end $$;
revoke all on function public.club_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.club_action(text,jsonb) to authenticated;
revoke all on function public.connect_notification_chat(bigint,bigint,text,boolean),public.migrate_notification_chat(bigint,bigint),public.book_announcement_current(uuid,bigint) from public,anon,authenticated;
grant execute on function public.connect_notification_chat(bigint,bigint,text,boolean),public.migrate_notification_chat(bigint,bigint),public.book_announcement_current(uuid,bigint) to service_role;
revoke all on function private.refresh_book_announcement(uuid),private.book_announcement_trigger(),private.schedule_meeting() from public,anon,authenticated;
commit;
