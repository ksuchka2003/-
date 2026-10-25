begin;
create schema if not exists private;
revoke create on schema public from public;
revoke all on schema private from public, anon, authenticated;

create table public.club_members (
 id uuid primary key default gen_random_uuid(), telegram_id bigint not null unique check(telegram_id>0),
 auth_user_id uuid unique references auth.users(id) on delete set null, role text not null default 'member' check(role in ('admin','member')),
 active boolean not null default true, joined_at timestamptz not null default now()
);
create table public.member_profiles (
 member_id uuid primary key references public.club_members on delete cascade, name text not null check(length(name) between 1 and 200),
 username text, avatar_url text check(avatar_url is null or avatar_url ~ '^https://'), bio text not null default '' check(length(bio)<=2000), genres text not null default '' check(length(genres)<=500), joined_at timestamptz not null default now()
);
create table public.member_privacy_settings (
 member_id uuid primary key references public.club_members on delete cascade,
 show_finished boolean not null default false,show_current boolean not null default false,show_progress boolean not null default false,
 show_ratings boolean not null default false,show_reviews boolean not null default false,show_quotes boolean not null default false
);
create table public.club_books (
 id uuid primary key default gen_random_uuid(),title text not null check(length(title) between 1 and 300),authors text not null default '' check(length(authors)<=500),description text not null default '' check(length(description)<=10000),
 genre text not null default '' check(length(genre)<=150),year integer check(year between 0 and 3000),isbn text not null default '' check(length(isbn)<=30),cover text not null default '' check(cover='' or cover ~ '^https://'),
 default_pages integer not null default 0 check(default_pages between 0 and 1000000),status text not null default 'planned' check(status in ('planned','reading','finished','archived')),created_at timestamptz not null default now()
);
create unique index club_books_isbn on public.club_books(isbn) where isbn<>'';
create unique index club_books_title_author on public.club_books(lower(trim(title)),lower(trim(authors)));
create index club_books_filters on public.club_books(status,genre);
create table public.club_readings (
 id uuid primary key default gen_random_uuid(),book_id uuid not null references public.club_books on delete cascade,
 starts_on date not null,ends_on date,position integer not null default 0 check(position>=0),status text not null default 'active' check(status in ('active','finished','cancelled')),check(ends_on is null or ends_on>=starts_on)
);
create unique index one_active_reading_per_book on public.club_readings(book_id) where status='active';
create index club_readings_order on public.club_readings(status,position);
create table public.book_proposals (
 id uuid primary key, member_id uuid not null references public.club_members on delete cascade, metadata jsonb not null check(jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=50000),
 status text not null default 'draft' check(status in ('draft','pending','approved','rejected')),reason text not null default '' check(length(reason)<=2000),book_id uuid references public.club_books on delete set null,created_at timestamptz not null default now()
);
create index proposals_pending on public.book_proposals(status,created_at);
create table public.public_reading_progress (
 id uuid primary key,member_id uuid not null references public.club_members on delete cascade,book_id uuid not null references public.club_books on delete cascade,title text not null check(length(title)<=300),
 status text not null check(status in ('planned','reading','finished','paused')),pages integer not null check(pages>=0),total_pages integer not null check(total_pages between 0 and 1000000),updated_at timestamptz not null default now(),check(pages<=total_pages),unique(member_id,book_id)
);
create table public.public_reviews (
 id uuid primary key,member_id uuid not null references public.club_members on delete cascade,book_id uuid not null references public.club_books on delete cascade,title text not null check(length(title)<=300),
 rating integer check(rating between 1 and 10),text text not null check(length(text)<=30000),spoilers boolean not null default false,updated_at timestamptz not null default now(),unique(member_id,book_id)
);
create table public.public_quotes (
 id uuid primary key,member_id uuid not null references public.club_members on delete cascade,book_id uuid not null references public.club_books on delete cascade,title text not null check(length(title)<=300),
 text text not null check(length(text) between 1 and 20000),page integer check(page>=0),chapter text not null default '' check(length(chapter)<=300),comment text not null default '' check(length(comment)<=10000),updated_at timestamptz not null default now()
);
create index public_progress_member on public.public_reading_progress(member_id);
create index public_reviews_member on public.public_reviews(member_id);
create index public_quotes_member on public.public_quotes(member_id);
create index public_quotes_book on public.public_quotes(book_id);
create index public_quotes_feed on public.public_quotes(updated_at desc);
create table public.quote_likes (
 quote_id uuid not null references public.public_quotes on delete cascade,member_id uuid not null references public.club_members on delete cascade,created_at timestamptz not null default now(),primary key(quote_id,member_id)
);
create table public.meetings (
 id uuid primary key,title text not null check(length(title) between 1 and 300),starts_at timestamptz not null,place text not null default '' check(length(place)<=1000),description text not null default '' check(length(description)<=10000),cancelled boolean not null default false,version integer not null default 1
);
create table public.meeting_books (meeting_id uuid not null references public.meetings on delete cascade,book_id uuid not null references public.club_books on delete cascade,primary key(meeting_id,book_id));
create table public.meeting_attendance (meeting_id uuid not null references public.meetings on delete cascade,member_id uuid not null references public.club_members on delete cascade,response text not null check(response in ('yes','no','maybe')),primary key(meeting_id,member_id));
create table public.notification_jobs (
 id uuid primary key default gen_random_uuid(),meeting_id uuid not null references public.meetings on delete cascade,member_id uuid not null references public.club_members on delete cascade,
 meeting_version integer not null,kind text not null check(kind in ('new','changed','cancelled','24h','1h')),run_at timestamptz not null,status text not null default 'pending' check(status in ('pending','processing','sent','failed','skipped')),
 attempts integer not null default 0,locked_at timestamptz,lock_token uuid,last_error text,sent_at timestamptz,unique(meeting_id,member_id,meeting_version,kind)
);
create index notification_due on public.notification_jobs(run_at) where status in ('pending','processing');
create table public.club_settings (key text primary key,value jsonb not null);
insert into public.club_settings values ('name','"Между строк"');
create table private.sync_versions (member_id uuid references public.club_members on delete cascade,kind text,entity_id uuid,version bigint not null,primary key(member_id,kind,entity_id));

create function public.my_member_id() returns uuid language sql stable security definer set search_path='' as $$
 select id from public.club_members where auth_user_id=auth.uid() and active
$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.club_members where id=public.my_member_id() and role='admin')
$$;
create function public.can_see(p_member uuid,p_flag text) returns boolean language sql stable security definer set search_path='' as $$
 select public.my_member_id() is not null and exists(select 1 from public.club_members m join public.member_privacy_settings p on p.member_id=m.id where m.id=p_member and m.active and (p_member=public.my_member_id() or coalesce((to_jsonb(p)->>p_flag)::boolean,false)))
$$;

do $$ declare t text; begin
 foreach t in array array['club_members','member_profiles','member_privacy_settings','club_books','club_readings','book_proposals','public_reading_progress','public_reviews','public_quotes','quote_likes','meetings','meeting_books','meeting_attendance','notification_jobs','club_settings'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public, anon, authenticated',t);
 end loop;
end $$;
create policy own_member on public.club_members for select to authenticated using(id=public.my_member_id() or public.is_admin());
create policy profiles on public.member_profiles for select to authenticated using(public.my_member_id() is not null and exists(select 1 from public.club_members m where m.id=member_id and m.active));
-- The profile policy above cannot rely on member-table RLS for other members. Use a definer helper.
create function public.active_member(p_member uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.club_members where id=p_member and active)$$;
drop policy profiles on public.member_profiles;
create policy profiles on public.member_profiles for select to authenticated using(public.my_member_id() is not null and public.active_member(member_id));
create policy own_privacy on public.member_privacy_settings for select to authenticated using(member_id=public.my_member_id());
create policy books_read on public.club_books for select to authenticated using(public.my_member_id() is not null);
create policy readings_read on public.club_readings for select to authenticated using(public.my_member_id() is not null);
create policy proposals_read on public.book_proposals for select to authenticated using(member_id=public.my_member_id() or public.is_admin());
create policy progress_read on public.public_reading_progress for select to authenticated using(public.can_see(member_id,'show_progress') and (member_id=public.my_member_id() or (status='reading' and public.can_see(member_id,'show_current')) or (status='finished' and public.can_see(member_id,'show_finished'))));
create policy reviews_read on public.public_reviews for select to authenticated using(public.can_see(member_id,'show_reviews'));
create policy quotes_read on public.public_quotes for select to authenticated using(public.can_see(member_id,'show_quotes'));
create policy likes_read on public.quote_likes for select to authenticated using(public.my_member_id() is not null and exists(select 1 from public.public_quotes q where q.id=quote_id));
create policy meetings_read on public.meetings for select to authenticated using(public.my_member_id() is not null);
create policy meeting_books_read on public.meeting_books for select to authenticated using(public.my_member_id() is not null);
create policy attendance_read on public.meeting_attendance for select to authenticated using(public.my_member_id() is not null and public.active_member(member_id));
create policy settings_read on public.club_settings for select to authenticated using(public.my_member_id() is not null);
create policy jobs_admin on public.notification_jobs for select to authenticated using(public.is_admin());
grant select on public.notification_jobs to authenticated;
-- Ratings need column-level privacy. Clients have no table SELECT; this guarded view is the read surface.
create view public.visible_reviews as select id,member_id,book_id,title,case when public.can_see(member_id,'show_ratings') then rating else null end as rating,case when public.can_see(member_id,'show_reviews') then text else '' end as text,case when public.can_see(member_id,'show_reviews') then spoilers else false end as spoilers,updated_at from public.public_reviews where public.can_see(member_id,'show_reviews') or public.can_see(member_id,'show_ratings');
create view public.visible_progress as select id,member_id,book_id,title,status,case when public.can_see(member_id,'show_progress') then pages else null end as pages,case when public.can_see(member_id,'show_progress') then total_pages else null end as total_pages,updated_at from public.public_reading_progress where member_id=public.my_member_id() or (status='reading' and public.can_see(member_id,'show_current')) or (status='finished' and public.can_see(member_id,'show_finished'));
revoke all on public.visible_reviews,public.visible_progress from public,anon,authenticated;
grant select on public.club_members,public.member_profiles,public.member_privacy_settings,public.club_books,public.club_readings,public.book_proposals,public.public_quotes,public.quote_likes,public.meetings,public.meeting_books,public.meeting_attendance,public.club_settings,public.visible_reviews,public.visible_progress to authenticated;

create function public.sync_public(p_kind text,p_entity uuid,p_payload jsonb,p_version bigint) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.my_member_id(); old_version bigint;
begin
 if actor is null then raise exception 'Нет доступа к клубу' using errcode='42501'; end if;
 if p_kind not in ('progress','review','quote','privacy') or p_version<=0 then raise exception 'Неверная операция'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_kind||p_entity::text,0));
 select version into old_version from private.sync_versions where member_id=actor and kind=p_kind and entity_id=p_entity;
 if old_version is not null and old_version>=p_version then return; end if;
 if p_kind='privacy' then
  if p_entity<>actor or jsonb_typeof(p_payload)<>'object' then raise exception 'Неверные настройки'; end if;
  update public.member_privacy_settings set show_finished=coalesce((p_payload->>'show_finished')::boolean,false),show_current=coalesce((p_payload->>'show_current')::boolean,false),show_progress=coalesce((p_payload->>'show_progress')::boolean,false),show_ratings=coalesce((p_payload->>'show_ratings')::boolean,false),show_reviews=coalesce((p_payload->>'show_reviews')::boolean,false),show_quotes=coalesce((p_payload->>'show_quotes')::boolean,false) where member_id=actor;
 elsif p_kind='progress' then
  if exists(select 1 from public.public_reading_progress where id=p_entity and member_id<>actor) then raise exception 'Чужая запись'; end if;
  if p_payload is null then delete from public.public_reading_progress where id=p_entity and member_id=actor;
  else insert into public.public_reading_progress(id,member_id,book_id,title,status,pages,total_pages) values(p_entity,actor,(p_payload->>'book_id')::uuid,p_payload->>'title',p_payload->>'status',(p_payload->>'pages')::integer,(p_payload->>'total_pages')::integer) on conflict(id) do update set book_id=excluded.book_id,title=excluded.title,status=excluded.status,pages=excluded.pages,total_pages=excluded.total_pages,updated_at=now(); end if;
 elsif p_kind='review' then
  if exists(select 1 from public.public_reviews where id=p_entity and member_id<>actor) then raise exception 'Чужая запись'; end if;
  if p_payload is null then delete from public.public_reviews where id=p_entity and member_id=actor;
  else insert into public.public_reviews(id,member_id,book_id,title,rating,text,spoilers) values(p_entity,actor,(p_payload->>'book_id')::uuid,p_payload->>'title',(p_payload->>'rating')::integer,p_payload->>'text',coalesce((p_payload->>'spoilers')::boolean,false)) on conflict(id) do update set book_id=excluded.book_id,title=excluded.title,rating=excluded.rating,text=excluded.text,spoilers=excluded.spoilers,updated_at=now(); end if;
 elsif p_kind='quote' then
  if exists(select 1 from public.public_quotes where id=p_entity and member_id<>actor) then raise exception 'Чужая запись'; end if;
  if p_payload is null then delete from public.public_quotes where id=p_entity and member_id=actor;
  else insert into public.public_quotes(id,member_id,book_id,title,text,page,chapter,comment) values(p_entity,actor,(p_payload->>'book_id')::uuid,p_payload->>'title',p_payload->>'text',(p_payload->>'page')::integer,coalesce(p_payload->>'chapter',''),coalesce(p_payload->>'comment','')) on conflict(id) do update set book_id=excluded.book_id,title=excluded.title,text=excluded.text,page=excluded.page,chapter=excluded.chapter,comment=excluded.comment,updated_at=now(); end if;
 end if;
 insert into private.sync_versions values(actor,p_kind,p_entity,p_version) on conflict(member_id,kind,entity_id) do update set version=excluded.version;
end $$;

create function private.upsert_book(p_id uuid,p jsonb) returns uuid language plpgsql set search_path='' as $$
declare result uuid; begin
 insert into public.club_books(id,title,authors,description,genre,year,isbn,cover,default_pages,status) values(coalesce(p_id,gen_random_uuid()),trim(p->>'title'),coalesce(p->>'authors',''),coalesce(p->>'description',''),coalesce(p->>'genre',''),(p->>'year')::integer,coalesce(p->>'isbn',''),coalesce(p->>'cover',''),coalesce((p->>'totalPages')::integer,0),coalesce(p->>'status','planned'))
 on conflict(id) do update set title=excluded.title,authors=excluded.authors,description=excluded.description,genre=excluded.genre,year=excluded.year,isbn=excluded.isbn,cover=excluded.cover,default_pages=excluded.default_pages,status=excluded.status returning id into result; return result;
end $$;

create function public.club_action(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.my_member_id(); result uuid; proposal public.book_proposals; m public.meetings; n integer;
begin
 if actor is null then raise exception 'Нет доступа к клубу' using errcode='42501'; end if;
 if p_action like 'admin.%' and not public.is_admin() then raise exception 'Требуется администратор' using errcode='42501'; end if;
 case p_action
 when 'profile' then
  update public.member_profiles set name=trim(p_data->>'name'),bio=coalesce(p_data->>'bio',''),genres=coalesce(p_data->>'genres','') where member_id=actor;
 when 'like' then
  if not exists(select 1 from public.public_quotes q where q.id=(p_data->>'quote_id')::uuid and public.can_see(q.member_id,'show_quotes')) then raise exception 'Цитата недоступна'; end if;
  if (p_data->>'liked')::boolean then insert into public.quote_likes values((p_data->>'quote_id')::uuid,actor,now()) on conflict do nothing;
  else delete from public.quote_likes where quote_id=(p_data->>'quote_id')::uuid and member_id=actor; end if;
 when 'attendance' then
  if not exists(select 1 from public.meetings where id=(p_data->>'meeting_id')::uuid and not cancelled and starts_at>now()) then raise exception 'Встреча завершена или отменена'; end if;
  insert into public.meeting_attendance values((p_data->>'meeting_id')::uuid,actor,p_data->>'response') on conflict(meeting_id,member_id) do update set response=excluded.response;
 when 'proposal' then
  if p_data->>'status' not in ('draft','pending') then raise exception 'Неверный статус'; end if;
  insert into public.book_proposals(id,member_id,metadata,status) values((p_data->>'id')::uuid,actor,p_data->'metadata',p_data->>'status')
  on conflict(id) do update set metadata=excluded.metadata,status=excluded.status where book_proposals.member_id=actor and book_proposals.status in ('draft','rejected');
  if not found then raise exception 'Заявку нельзя изменить'; end if;
 when 'admin.book' then result:=private.upsert_book((p_data->>'id')::uuid,p_data);
 when 'admin.delete_book' then delete from public.club_books where id=(p_data->>'id')::uuid;
 when 'admin.reading' then
  insert into public.club_readings(id,book_id,starts_on,ends_on,position,status) values((p_data->>'id')::uuid,(p_data->>'book_id')::uuid,(p_data->>'starts_on')::date,(p_data->>'ends_on')::date,(p_data->>'position')::integer,p_data->>'status')
  on conflict(id) do update set starts_on=excluded.starts_on,ends_on=excluded.ends_on,position=excluded.position,status=excluded.status;
 when 'admin.proposal' then
  select * into proposal from public.book_proposals where id=(p_data->>'id')::uuid for update;
  if not found then raise exception 'Заявка отсутствует'; end if;
  if proposal.status='approved' then return jsonb_build_object('id',proposal.book_id); end if;
  if proposal.status<>'pending' then raise exception 'Заявка не на рассмотрении'; end if;
  if (p_data->>'approve')::boolean then
   select id into result from public.club_books where (isbn<>'' and isbn=p_data->'metadata'->>'isbn') or (lower(trim(title))=lower(trim(p_data->'metadata'->>'title')) and lower(trim(authors))=lower(trim(p_data->'metadata'->>'authors'))) limit 1;
   if result is null then result:=private.upsert_book(null,p_data->'metadata'); end if;
   update public.book_proposals set status='approved',book_id=result,metadata=p_data->'metadata',reason='' where id=proposal.id;
  else
   if length(trim(coalesce(p_data->>'reason','')))=0 then raise exception 'Укажите причину'; end if;
   update public.book_proposals set status='rejected',reason=p_data->>'reason' where id=proposal.id;
  end if;
 when 'admin.meeting' then
  insert into public.meetings(id,title,starts_at,place,description,cancelled) values((p_data->>'id')::uuid,p_data->>'title',(p_data->>'starts_at')::timestamptz,p_data->>'place',p_data->>'description',coalesce((p_data->>'cancelled')::boolean,false))
  on conflict(id) do update set title=excluded.title,starts_at=excluded.starts_at,place=excluded.place,description=excluded.description,cancelled=excluded.cancelled,version=meetings.version+1;
  delete from public.meeting_books where meeting_id=(p_data->>'id')::uuid;
  insert into public.meeting_books select (p_data->>'id')::uuid,value::uuid from jsonb_array_elements_text(coalesce(p_data->'book_ids','[]'::jsonb)) on conflict do nothing;
 when 'admin.invite' then
  perform pg_advisory_xact_lock(2147483000);
  select count(*) into n from public.club_members where active;
  if n>=20 and not exists(select 1 from public.club_members where telegram_id=(p_data->>'telegram_id')::bigint and active) then raise exception 'Лимит клуба: 20 участников'; end if;
  insert into public.club_members(telegram_id) values((p_data->>'telegram_id')::bigint) on conflict(telegram_id) do update set active=true;
 when 'admin.member' then
  if (p_data->>'active')::boolean then raise exception 'Для восстановления используйте приглашение'; end if;
  if (p_data->>'id')::uuid=actor then raise exception 'Нельзя отключить себя'; end if;
  update public.club_members set active=(p_data->>'active')::boolean where id=(p_data->>'id')::uuid and role<>'admin';
 when 'admin.retry_notifications' then
  update public.notification_jobs set status='pending',attempts=0,run_at=now(),last_error=null where status='failed';
 else raise exception 'Неизвестная операция'; end case;
 return jsonb_build_object('ok',true,'id',result);
end $$;

create function private.schedule_meeting() returns trigger language plpgsql security definer set search_path='' as $$
declare k text:=case when tg_op='INSERT' then 'new' when new.cancelled then 'cancelled' else 'changed' end;
begin
 update public.notification_jobs set status='skipped' where meeting_id=new.id and status in ('pending','processing');
 insert into public.notification_jobs(meeting_id,member_id,meeting_version,kind,run_at)
 select new.id,id,new.version,k,now() from public.club_members where active on conflict do nothing;
 if not new.cancelled then
  insert into public.notification_jobs(meeting_id,member_id,meeting_version,kind,run_at)
  select new.id,m.id,new.version,t.kind,new.starts_at-t.delta from public.club_members m cross join (values('24h',interval '24 hours'),('1h',interval '1 hour')) t(kind,delta) where m.active and new.starts_at-t.delta>now() on conflict do nothing;
 end if; return new;
end $$;
create trigger meeting_notifications after insert or update on public.meetings for each row execute function private.schedule_meeting();
create function public.claim_notifications() returns setof public.notification_jobs language plpgsql security definer set search_path='' as $$
begin
 update public.notification_jobs set status='failed',last_error='Истекла последняя попытка' where status='processing' and attempts>=6 and locked_at<now()-interval '5 minutes';
 return query
 update public.notification_jobs set status='processing',attempts=attempts+1,locked_at=now(),lock_token=gen_random_uuid()
 where id in(select id from public.notification_jobs where (status='pending' or(status='processing' and locked_at<now()-interval '5 minutes')) and run_at<=now() and attempts<6 order by run_at for update skip locked limit 5) returning *;
end;
$$;

revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.my_member_id(),public.is_admin(),public.can_see(uuid,text),public.active_member(uuid),public.sync_public(text,uuid,jsonb,bigint),public.club_action(text,jsonb) to authenticated;
grant execute on function public.claim_notifications() to service_role;
grant all on all tables in schema public to service_role;
commit;
