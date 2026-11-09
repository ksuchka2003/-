begin;
alter table public.private_library_records drop constraint private_library_records_kind_check;
alter table public.private_library_records add constraint private_library_records_kind_check check(kind in ('book','progress','review','quote','entry','setting'));
alter table public.public_reading_progress drop constraint public_reading_progress_status_check;
alter table public.public_reading_progress add constraint public_reading_progress_status_check check(status in ('planned','reading','finished','paused','abandoned'));
alter table public.public_quotes add column source_label text not null default '' check(length(source_label)<=300);
alter table public.public_reviews alter column book_id drop not null;
alter table public.club_readings add column completed_at timestamptz;

create table public.reading_participation(
 reading_id uuid not null references public.club_readings on delete cascade,
 member_id uuid not null references public.club_members on delete cascade,
 choice text not null check(choice in ('reading','already_read','declined')),
 version bigint not null default 0,updated_at timestamptz not null default now(),pages integer,total_pages integer,status text,primary key(reading_id,member_id),check(pages is null or pages between 0 and 1000000),check(total_pages is null or total_pages between 0 and 1000000)
);
alter table public.reading_participation enable row level security;
revoke all on public.reading_participation from public,anon,authenticated;
grant select on public.reading_participation to authenticated;
grant all on public.reading_participation to service_role;
create policy participation_read on public.reading_participation for select to authenticated using(public.my_member_id() is not null and public.active_member(member_id));
create view public.visible_reading_participation with(security_barrier=true) as
 select c.reading_id,r.book_id,c.member_id,c.choice,c.updated_at,c.pages,c.total_pages,c.status from public.reading_participation c join public.club_readings r on r.id=c.reading_id
 where public.my_member_id() is not null and public.active_member(c.member_id);
revoke all on public.visible_reading_participation from public,anon,authenticated;
grant select on public.visible_reading_participation to authenticated;

create function private.can_share_book(owner_id uuid,selected uuid) returns boolean language sql stable security definer set search_path='' as $$
 select selected is null or not exists(select 1 from public.club_readings r join public.reading_participation p on p.reading_id=r.id
  join public.club_books b on b.id=r.book_id where r.book_id=selected and r.status='active' and b.status not in ('finished','archived') and p.member_id=owner_id and p.choice='declined')
$$;
revoke all on function private.can_share_book(uuid,uuid) from public,anon,authenticated;

create table public.public_entries(
 id uuid primary key,member_id uuid not null references public.club_members on delete cascade,
 book_id uuid references public.club_books on delete set null,title text not null check(length(title)<=300),
 kind text not null check(kind in ('note','thought')),text text not null check(length(trim(text)) between 1 and 50000),
 page integer check(page between 0 and 1000000),chapter text not null default '' check(length(chapter)<=300),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index entries_book on public.public_entries(book_id,kind,updated_at desc);
create index entries_member on public.public_entries(member_id,kind,updated_at desc);
alter table public.public_entries enable row level security;
revoke all on public.public_entries from public,anon,authenticated;
grant select on public.public_entries to authenticated;
grant all on public.public_entries to service_role;
create policy entries_read on public.public_entries for select to authenticated using(public.my_member_id() is not null and public.active_member(member_id));
create view public.club_entries with(security_barrier=true) as select e.* from public.public_entries e where public.my_member_id() is not null and public.active_member(e.member_id);
revoke all on public.club_entries from public,anon,authenticated;
grant select on public.club_entries to authenticated;

create function private.validate_library_payload(k text,p jsonb) returns void language plpgsql set search_path='' as $$
declare value jsonb;
begin
 if k='book' then
  if length(trim(coalesce(p->>'title','')))=0 or length(p->>'title')>300 or p->>'status' not in ('planned','reading','finished','paused','abandoned') or coalesce(p->>'totalPages','') !~ '^[0-9]{1,7}$' or (p->>'totalPages')::integer>1000000 then raise exception 'Неверные параметры книги'; end if;
  if p ? 'shelfIds' then
   if jsonb_typeof(p->'shelfIds')<>'array' or jsonb_array_length(p->'shelfIds')>100 then raise exception 'Неверные полки';end if;
   for value in select * from jsonb_array_elements(p->'shelfIds') loop perform (value#>>'{}')::uuid;end loop;
  end if;
 elsif k='entry' then
  if p->>'kind' not in ('note','thought') or length(trim(coalesce(p->>'text',''))) not between 1 and 50000 or length(coalesce(p->>'chapter',''))>300 or jsonb_typeof(p->'published') is distinct from 'boolean' then raise exception 'Неверная запись'; end if;
  perform (p->>'bookId')::uuid;
 elsif k='quote' then
  if length(trim(coalesce(p->>'text',''))) not between 1 and 20000 or length(coalesce(p->>'attribution',''))>300 then raise exception 'Неверная цитата';end if;
 elsif k='progress' then
  if coalesce(p->>'pages','') !~ '^[0-9]{1,7}$' or (p->>'pages')::integer>1000000 then raise exception 'Неверные страницы';end if;
 end if;
end $$;
revoke all on function private.validate_library_payload(text,jsonb) from public,anon,authenticated;
create or replace function public.sync_private_library(p_changes jsonb,p_device uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.my_member_id(); change jsonb; current_record public.private_library_records;
 result jsonb:='[]'; incoming jsonb; base bigint; k text; entity text; saved public.private_library_records;
begin
 if actor is null then raise exception 'Нет доступа к клубу' using errcode='42501'; end if;
 if p_device is null or p_changes is null or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>200 or octet_length(p_changes::text)>900000 then raise exception 'Неверный пакет синхронизации'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||'private_library',5));
 for change in select value from jsonb_array_elements(p_changes) order by value->>'kind',value->>'entity_id' loop
  k:=change->>'kind';entity:=change->>'entity_id';base:=(change->>'base_revision')::bigint;incoming:=nullif(change->'payload','null'::jsonb);
  if k is null or k not in ('book','progress','review','quote','entry','setting') or entity is null or length(entity) not between 1 and 100 or base is null or base<0 or not(change ? 'payload') then raise exception 'Неверная запись библиотеки'; end if;
  if k<>'setting' then perform entity::uuid; end if;
  if k='setting' and (left(entity,1)='_' or entity='privacy') then raise exception 'Служебные настройки не синхронизируются'; end if;
  if incoming is not null then
   if jsonb_typeof(incoming)<>'object' or octet_length(incoming::text)>250000 then raise exception 'Неверный формат записи'; end if;
   perform private.validate_library_payload(k,incoming);
   if k in ('book','quote','entry') and (incoming->>'id' is distinct from entity) then raise exception 'UUID записи не совпадает'; end if;
   if k in ('progress','review') and (incoming->>'bookId' is distinct from entity) then raise exception 'UUID книги не совпадает'; end if;
   if k='setting' and (incoming->>'key' is distinct from entity) then raise exception 'Ключ настройки не совпадает'; end if;
   if (k in ('progress','review','entry') or (k='quote' and incoming->>'bookId' is not null)) and not exists (
    select 1 from public.private_library_records where member_id=actor and kind='book' and entity_id=incoming->>'bookId' and payload is not null
   ) then raise exception 'Книга удалена на другом устройстве. Повторите синхронизацию'; end if;
  end if;
  if k='book' and incoming is null and exists (
   select 1 from public.private_library_records child
   where child.member_id=actor and child.kind in ('progress','review','quote','entry') and child.payload->>'bookId'=entity
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
create or replace function private.refresh_club_progress(owner_id uuid, personal_id text) returns void
language plpgsql security definer set search_path='' as $$
declare b jsonb; p jsonb; shared_id uuid; target_book uuid; total integer; page_count integer; state text; started date; finished date; chosen_cover text;
begin
 shared_id:=md5(owner_id::text||':'||personal_id)::uuid;
 select payload into b from public.private_library_records where member_id=owner_id and kind='book' and entity_id=personal_id;
 delete from public.public_reading_progress where member_id=owner_id and (id=shared_id or id::text=personal_id);
 if b is null or coalesce(b->>'deletedAt','')<>'' or coalesce(b->>'clubBookId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return; end if;
 target_book:=(b->>'clubBookId')::uuid;
 if exists(select 1 from public.club_readings r join public.reading_participation c on c.reading_id=r.id where r.book_id=target_book and r.status='active' and c.member_id=owner_id and c.choice='declined') then return; end if;
 if not exists(select 1 from public.club_books where id=target_book) then return; end if;
 select payload into p from public.private_library_records where member_id=owner_id and kind='progress' and entity_id=personal_id;
 total:=case when coalesce(b->>'totalPages','') ~ '^[0-9]{1,7}$' then least((b->>'totalPages')::integer,1000000) else 0 end;
 page_count:=case when coalesce(p->>'pages','') ~ '^[0-9]{1,7}$' then least((p->>'pages')::integer,total) else 0 end;
 state:=case when b->>'status' in ('planned','reading','finished','paused','abandoned') then b->>'status' else 'planned' end;
 started:=private.reading_date(p->>'startedOn');finished:=private.reading_date(p->>'finishedOn');
 if finished<started then finished:=null; end if;
 chosen_cover:=case
  when length(coalesce(b->>'coverData',''))<=60000 and b->>'coverData' ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$' then b->>'coverData'
  when length(coalesce(b->>'cover',''))<=2048 and b->>'cover' ~ '^https://' then b->>'cover'
  else coalesce((select cover from public.club_books where id=target_book and length(cover)<=2048 and cover ~ '^https://'),'') end;
 update public.reading_participation set pages=case when choice='already_read' then total else page_count end,total_pages=total,status=case when choice='already_read' then 'finished' else state end where member_id=owner_id and reading_id=(select id from public.club_readings where book_id=target_book and status in ('active','finished') order by (status='active') desc,starts_on desc,completed_at desc nulls last,id desc limit 1);
 insert into public.public_reading_progress(id,member_id,book_id,title,status,pages,total_pages,chapter,started_on,finished_on,cover)
 values(shared_id,owner_id,target_book,left(coalesce(b->>'title','Книга'),300),state,page_count,total,left(coalesce(p->>'chapter',''),300),started,finished,chosen_cover)
 on conflict(member_id,book_id) do update set id=excluded.id,title=excluded.title,status=excluded.status,pages=excluded.pages,total_pages=excluded.total_pages,chapter=excluded.chapter,started_on=excluded.started_on,finished_on=excluded.finished_on,cover=excluded.cover,updated_at=now();
end $$;

create function private.refresh_entry(owner_id uuid,entity text) returns void language plpgsql security definer set search_path='' as $$
declare e jsonb;b jsonb;club_id uuid;
begin
 select payload into e from public.private_library_records where member_id=owner_id and kind='entry' and entity_id=entity;
 select payload into b from public.private_library_records where member_id=owner_id and kind='book' and entity_id=e->>'bookId';
 if e is null or b is null or coalesce(e->>'deletedAt','')<>'' or coalesce(b->>'deletedAt','')<>'' or e->>'published' is distinct from 'true' then
  delete from public.public_entries where member_id=owner_id and id::text=entity;return;
 end if;
 club_id:=nullif(b->>'clubBookId','')::uuid;
 if not private.can_share_book(owner_id,club_id) then return;end if;
 if club_id is not null and not exists(select 1 from public.club_books where id=club_id) then club_id:=null;end if;
 if exists(select 1 from public.public_entries where id::text=entity and member_id<>owner_id) then raise exception 'Чужая запись';end if;
 if exists(select 1 from public.public_entries where id::text=entity and kind<>e->>'kind') then delete from public.public_entries where id::text=entity and member_id=owner_id;end if;
 insert into public.public_entries(id,member_id,book_id,title,kind,text,page,chapter,created_at)
 values(entity::uuid,owner_id,club_id,left(b->>'title',300),e->>'kind',e->>'text',(e->>'page')::integer,coalesce(e->>'chapter',''),coalesce((e->>'createdAt')::timestamptz,now()))
 on conflict(id) do update set book_id=excluded.book_id,title=excluded.title,text=excluded.text,page=excluded.page,chapter=excluded.chapter,updated_at=now();
end $$;
revoke all on function private.refresh_entry(uuid,text) from public,anon,authenticated;
create function private.entry_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare child record;
begin
 if new.kind='entry' then perform private.refresh_entry(new.member_id,new.entity_id);
 elsif new.kind='book' then
  for child in select entity_id from public.private_library_records where member_id=new.member_id and kind='entry' and payload->>'bookId'=new.entity_id loop perform private.refresh_entry(new.member_id,child.entity_id);end loop;
 end if;
 return new;
end $$;
revoke all on function private.entry_changed() from public,anon,authenticated;
create trigger entry_changed after insert or update on public.private_library_records for each row execute function private.entry_changed();

alter function public.sync_public(text,uuid,jsonb,bigint) rename to sync_public_v12;
revoke all on function public.sync_public_v12(text,uuid,jsonb,bigint) from public,anon,authenticated;
create function public.sync_public(p_kind text,p_entity uuid,p_payload jsonb,p_version bigint) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.my_member_id();e jsonb;b jsonb;r jsonb;target_book uuid;previous bigint;
begin
 if actor is null then raise exception 'Нет доступа к клубу' using errcode='42501';end if;
 if p_version is null or p_version<=0 then raise exception 'Неверная версия';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_kind||p_entity::text,0));
 select version into previous from private.sync_versions where member_id=actor and kind=p_kind and entity_id=p_entity;
 if previous is not null and previous>=p_version then return;end if;
 if p_kind='entry' then
  select payload into e from public.private_library_records where member_id=actor and kind='entry' and entity_id=p_entity::text;
  select payload into b from public.private_library_records where member_id=actor and kind='book' and entity_id=e->>'bookId';
  if p_payload is not null and e->>'published'='true' and not private.can_share_book(actor,nullif(b->>'clubBookId','')::uuid) then raise exception 'Чтобы делиться записями во время чтения клуба, смените статус «Не буду читать»';end if;
  perform private.refresh_entry(actor,p_entity::text);
  insert into private.sync_versions values(actor,p_kind,p_entity,p_version) on conflict(member_id,kind,entity_id) do update set version=excluded.version;
  return;
 end if;
 if p_payload is not null and p_kind in ('quote','review') then
  if p_kind='quote' then
   select payload into e from public.private_library_records where member_id=actor and kind='quote' and entity_id=p_entity::text;
   if e is null or e->>'published' is distinct from 'true' or coalesce(e->>'deletedAt','')<>'' then p_payload:=null;
   else
    select payload into b from public.private_library_records where member_id=actor and kind='book' and entity_id=e->>'bookId';
    if e->>'bookId' is not null and (b is null or coalesce(b->>'deletedAt','')<>'') then p_payload:=null;
    else
     target_book:=nullif(b->>'clubBookId','')::uuid;
     p_payload:=jsonb_build_object('book_id',target_book,'title',coalesce(b->>'title',''),'text',e->>'text','page',e->'page','chapter',coalesce(e->>'chapter',''),'comment',coalesce(e->>'comment',''),'source_id',e->'sourceId','source_author',e->'sourceAuthor','source_label',coalesce(e->>'attribution',''),'explicit_share',true);
    end if;
   end if;
  else
   select payload into b from public.private_library_records where member_id=actor and kind='book' and entity_id=p_entity::text;
   select payload into r from public.private_library_records where member_id=actor and kind='review' and entity_id=p_entity::text;
   if b is null or r is null or b->>'publishReview' is distinct from 'true' or coalesce(b->>'deletedAt','')<>'' or b->>'status' not in ('finished','abandoned') then p_payload:=null;
   else
    target_book:=nullif(b->>'clubBookId','')::uuid;
    p_payload:=jsonb_build_object('book_id',target_book,'title',b->>'title','rating',r->'rating','text',r->>'text','spoilers',coalesce(r->'spoilers','false'::jsonb),'explicit_share',true);
   end if;
  end if;
  if p_payload is not null and not private.can_share_book(actor,target_book) then raise exception 'Чтобы делиться записями во время чтения клуба, смените статус «Не буду читать»';end if;
 end if;
 perform public.sync_public_v12(p_kind,p_entity,p_payload,p_version);
 if p_kind='quote' and p_payload is not null then update public.public_quotes set source_label=coalesce(p_payload->>'source_label','') where id=p_entity and member_id=actor;end if;
end $$;
revoke all on function public.sync_public(text,uuid,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.sync_public(text,uuid,jsonb,bigint) to authenticated;
create or replace view public.club_quotes as select q.* from public.public_quotes q left join public.member_privacy_settings p on p.member_id=q.member_id
 where public.my_member_id() is not null and public.active_member(q.member_id) and (q.explicit_consent or coalesce(p.show_quotes,false));
revoke all on public.club_quotes from public,anon,authenticated;grant select on public.club_quotes to authenticated;

alter function public.club_action(text,jsonb) rename to club_action_v12;
revoke all on function public.club_action_v12(text,jsonb) from public,anon,authenticated;
create function public.club_action(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.my_member_id();r public.club_readings;b public.club_books;c public.reading_participation;v bigint;result jsonb;child record;
begin
 if actor is null then raise exception 'Нет доступа к клубу' using errcode='42501';end if;
 if p_action like 'admin.%' and not public.is_admin() then raise exception 'Требуется администратор' using errcode='42501';end if;
 if p_action='reading.participation' then
  select * into r from public.club_readings where id=(p_data->>'reading_id')::uuid;
  if r.id is null or r.status<>'active' or not exists(select 1 from public.club_books where id=r.book_id and status not in ('finished','archived')) then raise exception 'Это чтение клуба уже завершено';end if;
  if p_data->>'choice' not in ('reading','already_read','declined') or p_data->>'choice' is null then raise exception 'Выберите статус чтения';end if;
  v:=coalesce((p_data->>'version')::bigint,floor(extract(epoch from clock_timestamp())*1000000)::bigint);
  if v<=0 or v>floor(extract(epoch from clock_timestamp()+interval '5 minutes')*1000000)::bigint then raise exception 'Неверное время изменения';end if;
  insert into public.reading_participation(reading_id,member_id,choice,version) values(r.id,actor,p_data->>'choice',v)
  on conflict(reading_id,member_id) do update set choice=excluded.choice,version=excluded.version,updated_at=now() where reading_participation.version<excluded.version;
  update public.reading_participation set pages=null,total_pages=null,status=null where reading_id=r.id and member_id=actor and choice='declined';
  for child in select entity_id from public.private_library_records where member_id=actor and kind='book' and payload->>'clubBookId'=r.book_id::text loop perform private.refresh_club_progress(actor,child.entity_id);end loop;
  select * into c from public.reading_participation where reading_id=r.id and member_id=actor;
  return to_jsonb(c)-'version';
 elsif p_action='admin.reading' then
  select * into r from public.club_readings where id=(p_data->>'id')::uuid for update;
  result:=public.club_action_v12(p_action,p_data);
  if p_data->>'status'='active' then update public.club_books set status='reading' where id=(p_data->>'book_id')::uuid;
  elsif r.status='active' and not exists(select 1 from public.club_readings where book_id=r.book_id and status='active') then
   update public.club_books set status=case when p_data->>'status'='finished' then 'finished' else 'planned' end where id=r.book_id and status='reading';
  end if;
  if p_data->>'status'='finished' then update public.club_readings set completed_at=coalesce(completed_at,now()) where id=(p_data->>'id')::uuid;end if;
  return result;
 elsif p_action='admin.book' then
  result:=public.club_action_v12(p_action,p_data);
  select * into b from public.club_books where id=(p_data->>'id')::uuid;
  if b.status='reading' and not exists(select 1 from public.club_readings where book_id=b.id and status='active') then
   insert into public.club_readings(book_id,starts_on,position) select b.id,(now() at time zone 'Europe/Moscow')::date,coalesce(max(position)+1,0) from public.club_readings where status='active';
  elsif b.status in ('finished','planned','archived') then
   update public.club_readings set status=case when b.status='finished' then 'finished' else 'cancelled' end,completed_at=case when b.status='finished' then coalesce(completed_at,now()) else completed_at end where book_id=b.id and status='active';
  end if;
  return result;
 end if;
 return public.club_action_v12(p_action,p_data);
end $$;
revoke all on function public.club_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.club_action(text,jsonb) to authenticated;

-- Existing owners keep their current progress; no historical activity is invented.
insert into public.club_readings(book_id,starts_on,position)
 select b.id,(now() at time zone 'Europe/Moscow')::date,coalesce((select max(position)+1 from public.club_readings where status='active'),0)
 from public.club_books b where b.status='reading' and not exists(select 1 from public.club_readings r where r.book_id=b.id and r.status='active');
insert into public.reading_participation(reading_id,member_id,choice)
 select distinct r.id,p.member_id,case when p.payload->>'status'='finished' and private.reading_date(g.payload->>'finishedOn')<r.starts_on then 'already_read' else 'reading' end from public.club_readings r join public.private_library_records p on p.kind='book' and p.payload->>'clubBookId'=r.book_id::text and coalesce(p.payload->>'deletedAt','')='' left join public.private_library_records g on g.member_id=p.member_id and g.kind='progress' and g.entity_id=p.entity_id where r.status='active' on conflict do nothing;
do $$ declare row record;begin for row in select member_id,entity_id from public.private_library_records where kind='book' and payload is not null loop perform private.refresh_club_progress(row.member_id,row.entity_id);end loop;end $$;
commit;
