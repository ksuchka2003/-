begin;
alter table public.meetings add column venue_url text not null default '' check(length(venue_url)<=2048 and (venue_url='' or venue_url ~ '^https://[^[:space:]]+$'));
alter table public.public_quotes alter column book_id drop not null;
alter table public.public_quotes add column explicit_consent boolean not null default false;
alter table public.public_reviews add column explicit_consent boolean not null default false;

-- Only club-linked books expose a small projection; all other private payload stays owner-only.
create function private.refresh_club_progress(owner_id uuid, personal_id text) returns void
language plpgsql security definer set search_path='' as $$
declare b jsonb; p jsonb; shared_id uuid; target_book uuid; total integer; page_count integer; state text;
begin
 shared_id:=md5(owner_id::text||':'||personal_id)::uuid;
 select payload into b from public.private_library_records where member_id=owner_id and kind='book' and entity_id=personal_id;
 delete from public.public_reading_progress where member_id=owner_id and (id=shared_id or id::text=personal_id);
 if b is null or coalesce(b->>'clubBookId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return; end if;
 target_book:=(b->>'clubBookId')::uuid;
 if not exists(select 1 from public.club_books where id=target_book) then return; end if;
 select payload into p from public.private_library_records where member_id=owner_id and kind='progress' and entity_id=personal_id;
 total:=case when coalesce(b->>'totalPages','') ~ '^[0-9]{1,7}$' then least((b->>'totalPages')::integer,1000000) else 0 end;
 page_count:=case when coalesce(p->>'pages','') ~ '^[0-9]{1,7}$' then least((p->>'pages')::integer,total) else 0 end;
 state:=case when b->>'status' in ('planned','reading','finished','paused') then b->>'status' else 'planned' end;
 insert into public.public_reading_progress(id,member_id,book_id,title,status,pages,total_pages)
 values(shared_id,owner_id,target_book,left(coalesce(b->>'title','Книга'),300),state,page_count,total)
 on conflict(member_id,book_id) do update set id=excluded.id,title=excluded.title,status=excluded.status,pages=excluded.pages,total_pages=excluded.total_pages,updated_at=now();
end $$;
create function private.library_progress_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.kind in ('book','progress') then perform private.refresh_club_progress(new.member_id,new.entity_id); end if;
 return new;
end $$;
create trigger shared_club_progress after insert or update on public.private_library_records for each row execute function private.library_progress_changed();
revoke all on function private.refresh_club_progress(uuid,text),private.library_progress_changed() from public,anon,authenticated;
do $$ declare r record; begin
 for r in select member_id,entity_id from public.private_library_records where kind='book' loop
  perform private.refresh_club_progress(r.member_id,r.entity_id);
 end loop;
end $$;
drop policy progress_read on public.public_reading_progress;
create policy progress_read on public.public_reading_progress for select to authenticated using(public.my_member_id() is not null and public.active_member(member_id));
create or replace view public.visible_progress as select id,member_id,book_id,title,status,pages,total_pages,updated_at
 from public.public_reading_progress where public.my_member_id() is not null and public.active_member(member_id);

drop policy quotes_read on public.public_quotes;
create policy quotes_read on public.public_quotes for select to authenticated using(public.my_member_id() is not null and public.active_member(member_id) and (explicit_consent or public.can_see(member_id,'show_quotes')));
drop policy reviews_read on public.public_reviews;
create policy reviews_read on public.public_reviews for select to authenticated using(public.my_member_id() is not null and public.active_member(member_id) and (explicit_consent or public.can_see(member_id,'show_reviews')));
create or replace view public.visible_reviews as select id,member_id,book_id,title,
 case when explicit_consent or public.can_see(member_id,'show_ratings') then rating else null end as rating,
 case when explicit_consent or public.can_see(member_id,'show_reviews') then text else '' end as text,
 case when explicit_consent or public.can_see(member_id,'show_reviews') then spoilers else false end as spoilers,updated_at
 from public.public_reviews where public.my_member_id() is not null and public.active_member(member_id) and (explicit_consent or public.can_see(member_id,'show_reviews') or public.can_see(member_id,'show_ratings'));

alter function public.sync_public(text,uuid,jsonb,bigint) rename to sync_public_v1;
revoke all on function public.sync_public_v1(text,uuid,jsonb,bigint) from public,anon,authenticated;
create function public.sync_public(p_kind text,p_entity uuid,p_payload jsonb,p_version bigint) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.my_member_id(); old_version bigint;
begin
 if actor is null then raise exception 'Нет доступа к клубу' using errcode='42501'; end if;
 if p_kind='progress' then
  -- Old device queues cannot withdraw the mandatory club projection or forge another reader.
  return;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_kind||p_entity::text,0));
 select version into old_version from private.sync_versions where member_id=actor and kind=p_kind and entity_id=p_entity;
 if old_version is not null and old_version>=p_version then return; end if;
 perform public.sync_public_v1(p_kind,p_entity,p_payload,p_version);
 -- This one item was explicitly shared in its editor; no other item is made public.
 if p_payload is not null and p_payload->'explicit_share'='true'::jsonb then
  if p_kind='quote' then update public.public_quotes set explicit_consent=true where id=p_entity and member_id=actor;
  elsif p_kind='review' then update public.public_reviews set explicit_consent=true where id=p_entity and member_id=actor;
  end if;
 end if;
end $$;
revoke all on function public.sync_public(text,uuid,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.sync_public(text,uuid,jsonb,bigint) to authenticated;

alter function public.club_action(text,jsonb) rename to club_action_v4;
revoke all on function public.club_action_v4(text,jsonb) from public,anon,authenticated;
create function public.club_action(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.my_member_id(); target public.meetings; selected_meeting uuid; starts timestamptz; duration integer; changed boolean;
begin
 if actor is null then raise exception 'Нет доступа к клубу' using errcode='42501'; end if;
 if p_action like 'admin.%' and not public.is_admin() then raise exception 'Требуется администратор' using errcode='42501'; end if;
 if p_action='availability' then raise exception 'Календарь больше не используется. Ответьте на приглашение на встречу';
 elsif p_action='like' then
  if not exists(select 1 from public.public_quotes q where q.id=(p_data->>'quote_id')::uuid and public.active_member(q.member_id) and (q.explicit_consent or public.can_see(q.member_id,'show_quotes'))) then raise exception 'Цитата недоступна'; end if;
  if (p_data->>'liked')::boolean then insert into public.quote_likes values((p_data->>'quote_id')::uuid,actor,now()) on conflict do nothing;
  else delete from public.quote_likes where quote_id=(p_data->>'quote_id')::uuid and member_id=actor; end if;
  return jsonb_build_object('ok',true);
 elsif p_action='admin.meeting' then
  selected_meeting:=(p_data->>'id')::uuid;
  perform pg_advisory_xact_lock(2147482999);
  select * into target from public.meetings where id=selected_meeting for update;
  if target.id is not null and (p_data->>'version')::integer is distinct from target.version then raise exception 'Встречу уже изменили. Обновите страницу'; end if;
  starts:=(p_data->>'starts_at')::timestamptz; duration:=coalesce((p_data->>'duration_minutes')::integer,120);
  changed:=target.id is null or target.starts_at is distinct from starts or target.duration_minutes<>duration or (target.cancelled and not coalesce((p_data->>'cancelled')::boolean,false));
  if not coalesce((p_data->>'cancelled')::boolean,false) and changed and (starts is null or starts<=now()) then raise exception 'Выберите будущее время встречи'; end if;
  insert into public.meetings(id,title,starts_at,place,description,cancelled,duration_minutes,venue_url)
  values(selected_meeting,p_data->>'title',starts,coalesce(p_data->>'place',''),coalesce(p_data->>'description',''),coalesce((p_data->>'cancelled')::boolean,false),duration,coalesce(p_data->>'venue_url',''))
  on conflict(id) do update set title=excluded.title,starts_at=excluded.starts_at,place=excluded.place,description=excluded.description,cancelled=excluded.cancelled,duration_minutes=excluded.duration_minutes,venue_url=excluded.venue_url,
   version=meetings.version+1,schedule_version=meetings.schedule_version+case when changed then 1 else 0 end;
  delete from public.meeting_books where meeting_id=selected_meeting;
  insert into public.meeting_books(meeting_id,book_id) select selected_meeting,value::uuid from jsonb_array_elements_text(coalesce(p_data->'book_ids','[]'::jsonb)) on conflict do nothing;
  return jsonb_build_object('ok',true);
 end if;
 return public.club_action_v4(p_action,p_data);
end $$;
revoke all on function public.club_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.club_action(text,jsonb) to authenticated;
-- Keep historical availability privately stored; it no longer blocks meetings or has a client API.
revoke select on public.meeting_availability from authenticated;

create or replace function private.schedule_meeting() returns trigger language plpgsql security definer set search_path='' as $$
declare k text:=case when tg_op='INSERT' then 'new' when new.cancelled then 'cancelled' else 'changed' end;
begin
 update public.notification_jobs set status='skipped' where meeting_id=new.id and status in ('pending','processing');
 if new.starts_at<=now() then return new; end if;
 insert into public.notification_jobs(meeting_id,member_id,meeting_version,kind,run_at)
 select new.id,id,new.version,k,now() from public.club_members where active on conflict do nothing;
 if not new.cancelled and new.starts_at-interval '24 hours'>now() then
  insert into public.notification_jobs(meeting_id,member_id,meeting_version,kind,run_at)
  select new.id,id,new.version,'24h',new.starts_at-interval '24 hours' from public.club_members where active on conflict do nothing;
 end if; return new;
end $$;
update public.notification_jobs set status='skipped' where kind='1h' and status in ('pending','processing');
create or replace function public.claim_notifications() returns setof public.notification_jobs language plpgsql security definer set search_path='' as $$
begin
 update public.notification_jobs set status='failed',last_error='Истекла последняя попытка' where status='processing' and attempts>=6 and locked_at<now()-interval '5 minutes';
 return query
 update public.notification_jobs set status='processing',attempts=attempts+1,locked_at=now(),lock_token=gen_random_uuid()
 where id in(select id from public.notification_jobs where (status='pending' or(status='processing' and locked_at<now()-interval '5 minutes')) and run_at<=now() and attempts<6 order by run_at for update skip locked limit 20) returning *;
end;
$$;

commit;
