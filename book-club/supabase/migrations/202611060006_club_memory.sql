begin;
create table public.meeting_questions (
 id uuid primary key, meeting_id uuid not null references public.meetings(id) on delete cascade,
 member_id uuid not null references public.club_members(id) on delete cascade,
 text text not null check(length(trim(text)) between 1 and 2000), answered boolean not null default false,
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index meeting_questions_meeting on public.meeting_questions(meeting_id,created_at);
create table public.meeting_reflections (
 id uuid primary key, meeting_id uuid not null references public.meetings(id) on delete cascade,
 member_id uuid not null references public.club_members(id) on delete cascade,
 favorite_thought text not null default '' check(length(favorite_thought)<=5000),
 debate text not null default '' check(length(debate)<=5000), impression text not null default '' check(length(impression)<=5000),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(length(trim(favorite_thought||debate||impression))>0),unique(meeting_id,member_id)
);
create index meeting_reflections_meeting on public.meeting_reflections(meeting_id,created_at);
alter table public.meeting_questions enable row level security;
alter table public.meeting_reflections enable row level security;
revoke all on public.meeting_questions,public.meeting_reflections from public,anon,authenticated;
grant select on public.meeting_questions,public.meeting_reflections to authenticated;
grant all on public.meeting_questions,public.meeting_reflections to service_role;
create policy questions_read on public.meeting_questions for select to authenticated using(public.my_member_id() is not null and public.active_member(member_id));
create policy reflections_read on public.meeting_reflections for select to authenticated using(public.my_member_id() is not null and public.active_member(member_id));

alter function public.club_action(text,jsonb) rename to club_action_v5;
revoke all on function public.club_action_v5(text,jsonb) from public,anon,authenticated;
create function public.club_action(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.my_member_id(); m public.meetings; q public.meeting_questions; r public.meeting_reflections; selected_id uuid;
begin
 if actor is null then raise exception 'Нет доступа к клубу' using errcode='42501'; end if;
 if p_action='meeting.question' then
  select * into m from public.meetings where id=(p_data->>'meeting_id')::uuid for share;
  if m.id is null or m.cancelled or m.starts_at+make_interval(mins=>m.duration_minutes)<=now() then raise exception 'Сбор вопросов к этой встрече завершён'; end if;
  selected_id:=(p_data->>'id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(selected_id::text||'question',0));
  select * into q from public.meeting_questions where id=selected_id for update;
  if q.id is not null and (q.member_id<>actor or q.meeting_id<>m.id) then raise exception 'Можно редактировать только свой вопрос'; end if;
  if q.id is not null and (p_data->>'version')::integer is distinct from q.version then raise exception 'Вопрос уже изменён. Обновите страницу'; end if;
  insert into public.meeting_questions(id,meeting_id,member_id,text) values(selected_id,m.id,actor,trim(p_data->>'text'))
  on conflict(id) do update set text=excluded.text,updated_at=now(),version=meeting_questions.version+1;
  return jsonb_build_object('ok',true);
 elsif p_action in ('meeting.question.delete','meeting.question.answered') then
  select * into q from public.meeting_questions where id=(p_data->>'id')::uuid for update;
  if q.id is null then return jsonb_build_object('ok',true); end if;
  if p_action='meeting.question.answered' then
   if not public.is_admin() then raise exception 'Требуется администратор'; end if;
   if (p_data->>'version')::integer is distinct from q.version then raise exception 'Вопрос уже изменён. Обновите страницу'; end if;
   update public.meeting_questions set answered=(p_data->>'answered')::boolean,version=version+1,updated_at=now() where id=q.id;
  else
   if q.member_id<>actor and not public.is_admin() then raise exception 'Можно удалить только свой вопрос'; end if;
   delete from public.meeting_questions where id=q.id;
  end if;
  return jsonb_build_object('ok',true);
 elsif p_action='meeting.reflection' then
  select * into m from public.meetings where id=(p_data->>'meeting_id')::uuid for share;
  if m.id is null or m.cancelled or m.starts_at+make_interval(mins=>m.duration_minutes)>now() then raise exception 'Итоги можно добавить после окончания встречи'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||m.id::text||'reflection',0));
  select * into r from public.meeting_reflections where meeting_id=m.id and member_id=actor for update;
  if r.id is not null and (p_data->>'version')::integer is distinct from r.version then raise exception 'Итоги уже изменены. Обновите страницу'; end if;
  if exists(select 1 from public.meeting_reflections where id=(p_data->>'id')::uuid and (member_id<>actor or meeting_id<>m.id)) then raise exception 'Чужие итоги нельзя изменять'; end if;
  insert into public.meeting_reflections(id,meeting_id,member_id,favorite_thought,debate,impression)
  values(coalesce(r.id,(p_data->>'id')::uuid),m.id,actor,coalesce(p_data->>'favorite_thought',''),coalesce(p_data->>'debate',''),coalesce(p_data->>'impression',''))
  on conflict(meeting_id,member_id) do update set favorite_thought=excluded.favorite_thought,debate=excluded.debate,impression=excluded.impression,updated_at=now(),version=meeting_reflections.version+1;
  return jsonb_build_object('ok',true);
 elsif p_action='meeting.reflection.delete' then
  select * into r from public.meeting_reflections where id=(p_data->>'id')::uuid for update;
  if r.id is null then return jsonb_build_object('ok',true); end if;
  if r.member_id<>actor and not public.is_admin() then raise exception 'Можно удалить только свои итоги'; end if;
  delete from public.meeting_reflections where id=r.id;
  return jsonb_build_object('ok',true);
 end if;
 return public.club_action_v5(p_action,p_data);
end $$;
revoke all on function public.club_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.club_action(text,jsonb) to authenticated;

alter table public.public_reading_progress add column chapter text not null default '' check(length(chapter)<=300);
alter table public.public_reading_progress add column started_on date;
alter table public.public_reading_progress add column finished_on date;
alter table public.public_reading_progress add constraint reading_dates check(finished_on>=started_on);
create function private.reading_date(value text) returns date language plpgsql immutable set search_path='' as $$
begin
 if value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
 return value::date;
exception when others then return null;
end $$;
create or replace function private.refresh_club_progress(owner_id uuid, personal_id text) returns void
language plpgsql security definer set search_path='' as $$
declare b jsonb; p jsonb; shared_id uuid; target_book uuid; total integer; page_count integer; state text; started date; finished date;
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
 started:=private.reading_date(p->>'startedOn');finished:=private.reading_date(p->>'finishedOn');
 if finished<started then finished:=null; end if;
 insert into public.public_reading_progress(id,member_id,book_id,title,status,pages,total_pages,chapter,started_on,finished_on)
 values(shared_id,owner_id,target_book,left(coalesce(b->>'title','Книга'),300),state,page_count,total,left(coalesce(p->>'chapter',''),300),started,finished)
 on conflict(member_id,book_id) do update set id=excluded.id,title=excluded.title,status=excluded.status,pages=excluded.pages,total_pages=excluded.total_pages,chapter=excluded.chapter,started_on=excluded.started_on,finished_on=excluded.finished_on,updated_at=now();
end $$;
revoke all on function private.reading_date(text) from public,anon,authenticated;
create or replace view public.visible_progress as select id,member_id,book_id,title,status,pages,total_pages,updated_at,chapter,started_on,finished_on
 from public.public_reading_progress where public.my_member_id() is not null and public.active_member(member_id);
do $$ declare r record; begin
 for r in select member_id,entity_id from public.private_library_records where kind='book' loop perform private.refresh_club_progress(r.member_id,r.entity_id); end loop;
end $$;

alter table public.public_quotes add column source_id uuid;
alter table public.public_quotes add column source_author text check(length(source_author)<=200);
alter function public.sync_public(text,uuid,jsonb,bigint) rename to sync_public_v5;
revoke all on function public.sync_public_v5(text,uuid,jsonb,bigint) from public,anon,authenticated;
create function public.sync_public(p_kind text,p_entity uuid,p_payload jsonb,p_version bigint) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.my_member_id(); previous bigint;
begin
 if actor is null then raise exception 'Нет доступа к клубу' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_kind||p_entity::text,0));
 select version into previous from private.sync_versions where member_id=actor and kind=p_kind and entity_id=p_entity;
 if previous is not null and previous>=p_version then return; end if;
 perform public.sync_public_v5(p_kind,p_entity,p_payload,p_version);
 if p_kind='quote' and p_payload is not null and p_payload ? 'source_id' then
  update public.public_quotes set source_id=(p_payload->>'source_id')::uuid,source_author=p_payload->>'source_author' where id=p_entity and member_id=actor;
 end if;
end $$;
revoke all on function public.sync_public(text,uuid,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.sync_public(text,uuid,jsonb,bigint) to authenticated;

-- Community surfaces never count an owner's legacy hidden publications as public.
create view public.club_quotes as select q.* from public.public_quotes q
 left join public.member_privacy_settings p on p.member_id=q.member_id
 where public.my_member_id() is not null and public.active_member(q.member_id) and (q.explicit_consent or coalesce(p.show_quotes,false));
create view public.club_reviews as select r.id,r.member_id,r.book_id,r.title,
 case when r.explicit_consent or coalesce(p.show_ratings,false) then r.rating else null end as rating,
 case when r.explicit_consent or coalesce(p.show_reviews,false) then r.text else '' end as text,
 case when r.explicit_consent or coalesce(p.show_reviews,false) then r.spoilers else false end as spoilers,r.updated_at
 from public.public_reviews r left join public.member_privacy_settings p on p.member_id=r.member_id
 where public.my_member_id() is not null and public.active_member(r.member_id) and (r.explicit_consent or coalesce(p.show_reviews,false) or coalesce(p.show_ratings,false));
create view public.club_book_stats as select b.id as book_id,
 (select avg(r.rating) from public.club_reviews r where r.book_id=b.id) as average_rating,
 (select count(r.rating) from public.club_reviews r where r.book_id=b.id) as rating_count,
 (select count(*) from public.visible_progress p where p.book_id=b.id and p.status='finished') as finished_readers,
 (select count(*) from public.visible_progress p where p.book_id=b.id and p.status='finished' and p.total_pages>0 and p.started_on is not null and p.finished_on<= (now() at time zone 'Europe/Moscow')::date) as pace_count,
 (select avg(p.finished_on-p.started_on+1) from public.visible_progress p where p.book_id=b.id and p.status='finished' and p.total_pages>0 and p.started_on is not null and p.finished_on<= (now() at time zone 'Europe/Moscow')::date) as average_days,
 (select avg(p.total_pages::numeric/(p.finished_on-p.started_on+1)) from public.visible_progress p where p.book_id=b.id and p.status='finished' and p.total_pages>0 and p.started_on is not null and p.finished_on<= (now() at time zone 'Europe/Moscow')::date) as pages_per_day
 from public.club_books b where public.my_member_id() is not null;
revoke all on public.club_quotes,public.club_reviews,public.club_book_stats from public,anon,authenticated;
grant select on public.club_quotes,public.club_reviews,public.club_book_stats to authenticated;
create index public_progress_book on public.public_reading_progress(book_id);
create index public_reviews_book on public.public_reviews(book_id);
commit;
