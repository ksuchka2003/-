begin;
create sequence private.library_revision;
create table public.private_library_records (
 member_id uuid not null references public.club_members(id) on delete cascade,
 kind text not null check(kind in ('book','progress','review','quote','setting')),
 entity_id text not null check(length(entity_id) between 1 and 100),
 payload jsonb check(payload is null or (jsonb_typeof(payload)='object' and octet_length(payload::text)<=250000)),
 revision bigint not null,
 device_id uuid not null,
 updated_at timestamptz not null default now(),
 primary key(member_id,kind,entity_id)
);
alter table public.private_library_records enable row level security;
revoke all on public.private_library_records from public,anon,authenticated;
grant select on public.private_library_records to authenticated;
grant all on public.private_library_records to service_role;
create policy owner_only on public.private_library_records for select to authenticated using(member_id=public.my_member_id());
create index private_library_parent on public.private_library_records(member_id,(payload->>'bookId')) where payload is not null;

-- A batch is committed atomically. Diverging edits are returned as conflicts, never silently overwritten.
create function public.sync_private_library(p_changes jsonb,p_device uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.my_member_id(); change jsonb; current_record public.private_library_records;
 result jsonb:='[]'; incoming jsonb; base bigint; k text; entity text; saved public.private_library_records;
begin
 if actor is null then raise exception 'Нет доступа к клубу' using errcode='42501'; end if;
 if p_device is null or p_changes is null or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>200 or octet_length(p_changes::text)>900000 then raise exception 'Неверный пакет синхронизации'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||'private_library',5));
 for change in select value from jsonb_array_elements(p_changes) order by value->>'kind',value->>'entity_id' loop
  k:=change->>'kind';entity:=change->>'entity_id';base:=(change->>'base_revision')::bigint;incoming:=nullif(change->'payload','null'::jsonb);
  if k is null or k not in ('book','progress','review','quote','setting') or entity is null or length(entity) not between 1 and 100 or base is null or base<0 or not(change ? 'payload') then raise exception 'Неверная запись библиотеки'; end if;
  if k<>'setting' then perform entity::uuid; end if;
  if k='setting' and (left(entity,1)='_' or entity='privacy') then raise exception 'Служебные настройки не синхронизируются'; end if;
  if incoming is not null then
   if jsonb_typeof(incoming)<>'object' or octet_length(incoming::text)>250000 then raise exception 'Неверный формат записи'; end if;
   if k in ('book','quote') and (incoming->>'id' is distinct from entity) then raise exception 'UUID записи не совпадает'; end if;
   if k in ('progress','review') and (incoming->>'bookId' is distinct from entity) then raise exception 'UUID книги не совпадает'; end if;
   if k='setting' and (incoming->>'key' is distinct from entity) then raise exception 'Ключ настройки не совпадает'; end if;
   if k in ('progress','review','quote') and not exists (
    select 1 from public.private_library_records where member_id=actor and kind='book' and entity_id=incoming->>'bookId' and payload is not null
   ) then raise exception 'Книга удалена на другом устройстве. Повторите синхронизацию'; end if;
  end if;
  if k='book' and incoming is null and exists (
   select 1 from public.private_library_records child
   where child.member_id=actor and child.kind in ('progress','review','quote') and child.payload->>'bookId'=entity
   and not exists (
    select 1 from jsonb_array_elements(p_changes) deletion
    where deletion->>'kind'=child.kind and deletion->>'entity_id'=child.entity_id
    and deletion->'payload'='null'::jsonb and (deletion->>'base_revision')::bigint=child.revision
   )
  ) then raise exception 'Записи книги изменились на другом устройстве. Повторите синхронизацию'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||k||entity,5));
  select * into current_record from public.private_library_records where member_id=actor and kind=k and entity_id=entity;
  if found and current_record.payload is not distinct from incoming then
   result:=result||jsonb_build_array(jsonb_build_object('status','applied','record',to_jsonb(current_record)-'member_id'));continue;
  end if;
  if (current_record.member_id is not null and current_record.revision<>base) or (current_record.member_id is null and base<>0) then
   result:=result||jsonb_build_array(jsonb_build_object('status','conflict','record',case when current_record.member_id is not null then to_jsonb(current_record)-'member_id' else jsonb_build_object('kind',k,'entity_id',entity,'payload',null,'revision',0,'device_id',p_device) end));continue;
  end if;
  insert into public.private_library_records(member_id,kind,entity_id,payload,revision,device_id)
  values(actor,k,entity,incoming,nextval('private.library_revision'),p_device)
  on conflict(member_id,kind,entity_id) do update set payload=excluded.payload,revision=excluded.revision,device_id=excluded.device_id,updated_at=now()
  returning * into saved;
  result:=result||jsonb_build_array(jsonb_build_object('status','applied','record',to_jsonb(saved)-'member_id'));
 end loop;
 return result;
end $$;
revoke all on function public.sync_private_library(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.sync_private_library(jsonb,uuid) to authenticated;

create function public.sync_privacy_settings(p_patch jsonb,p_version bigint) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.my_member_id(); flag text; previous bigint;
begin
 if actor is null then raise exception 'Нет доступа к клубу' using errcode='42501'; end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_version is null or p_version<=0 then raise exception 'Неверные настройки'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||'privacy',5));
 for flag in select jsonb_object_keys(p_patch) loop
  if flag not in ('show_finished','show_current','show_progress','show_ratings','show_reviews','show_quotes') or jsonb_typeof(p_patch->flag)<>'boolean' then raise exception 'Неверное разрешение'; end if;
  select version into previous from private.sync_versions where member_id=actor and kind='privacy.'||flag and entity_id=actor;
  if previous is not null and previous>=p_version then continue; end if;
  execute format('update public.member_privacy_settings set %I=$1 where member_id=$2',flag) using (p_patch->>flag)::boolean,actor;
  insert into private.sync_versions values(actor,'privacy.'||flag,actor,p_version) on conflict(member_id,kind,entity_id) do update set version=excluded.version;
 end loop;
end $$;
revoke all on function public.sync_privacy_settings(jsonb,bigint) from public,anon,authenticated;
grant execute on function public.sync_privacy_settings(jsonb,bigint) to authenticated;

-- Only a server with service_role may resolve a verified Telegram ID or bootstrap the configured administrator.
create function public.resolve_telegram_member(p_telegram_id bigint,p_bootstrap_admin boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare member public.club_members;
begin
 if p_telegram_id is null or p_telegram_id<=0 then raise exception 'Неверный Telegram ID'; end if;
 perform pg_advisory_xact_lock(2147483000);
 select * into member from public.club_members where telegram_id=p_telegram_id for update;
 if p_bootstrap_admin then
  if (member.id is null or not member.active) and (select count(*) from public.club_members where active)>=20 then raise exception 'Лимит клуба: 20 участников'; end if;
  insert into public.club_members(telegram_id,role,active) values(p_telegram_id,'admin',true)
  on conflict(telegram_id) do update set role='admin',active=true returning * into member;
 end if;
 if member.id is null or not member.active then raise exception 'Вы не включены в список участников клуба'; end if;
 return to_jsonb(member);
end $$;
revoke all on function public.resolve_telegram_member(bigint,boolean) from public,anon,authenticated;
grant execute on function public.resolve_telegram_member(bigint,boolean) to service_role;
commit;
