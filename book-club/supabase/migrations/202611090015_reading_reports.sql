begin;
create table private.progress_tracking_state(
 member_id uuid not null references public.club_members on delete cascade,personal_id text not null,
 book_id uuid not null references public.club_books on delete cascade,reading_id uuid references public.club_readings on delete cascade,
 pages integer not null,total_pages integer not null,has_progress boolean not null,edition_changed boolean not null default false,
 primary key(member_id,personal_id)
);
revoke all on private.progress_tracking_state from public,anon,authenticated;
create table public.reading_activity(
 id uuid primary key default gen_random_uuid(),member_id uuid not null references public.club_members on delete cascade,
 book_id uuid not null references public.club_books on delete cascade,reading_id uuid not null references public.club_readings on delete cascade,
 revision bigint not null,kind text not null check(kind in ('progress','baseline','correction','status')),
 pages_before integer not null check(pages_before between 0 and 1000000),pages_after integer not null check(pages_after between 0 and 1000000),
 total_pages integer not null check(total_pages between 0 and 1000000),pages_delta integer not null check(pages_delta between 0 and 1000000),
 status text not null,occurred_at timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),unique(member_id,revision)
);
create index activity_report on public.reading_activity(book_id,reading_id,occurred_at,member_id);
create table public.reading_completions(
 reading_id uuid not null references public.club_readings on delete cascade,book_id uuid not null references public.club_books on delete cascade,
 member_id uuid not null references public.club_members on delete cascade,completed_at timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),
 primary key(reading_id,member_id)
);
alter table public.reading_activity enable row level security;
alter table public.reading_completions enable row level security;
revoke all on public.reading_activity,public.reading_completions from public,anon,authenticated;
grant select on public.reading_activity,public.reading_completions to authenticated;
grant all on public.reading_activity,public.reading_completions to service_role;
create policy activity_read on public.reading_activity for select to authenticated using(public.my_member_id() is not null and (member_id=public.my_member_id() or public.is_admin()));
create policy completions_read on public.reading_completions for select to authenticated using(public.my_member_id() is not null and (member_id=public.my_member_id() or public.is_admin()));
create function private.reading_event_time(raw text) returns timestamptz language plpgsql set search_path='' as $$
declare value timestamptz;
begin
 value:=raw::timestamptz;
 if value is null or value>clock_timestamp()+interval '5 minutes' or value<clock_timestamp()-interval '10 years' then return clock_timestamp();end if;
 return value;
exception when others then return clock_timestamp();
end $$;
revoke all on function private.reading_event_time(text) from public,anon,authenticated;

create function private.capture_reading_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare b jsonb;p jsonb;selected uuid;r public.club_readings;s private.progress_tracking_state;c public.reading_participation;
 total integer;page_count integer;before_pages integer;delta integer;event_kind text;occurred timestamptz;finished timestamptz;eligible boolean;has_p boolean;book_status text;
begin
 if new.kind not in ('book','progress') then return new;end if;
 select payload into b from public.private_library_records where member_id=new.member_id and kind='book' and entity_id=new.entity_id;
 if b is null or coalesce(b->>'deletedAt','')<>'' or coalesce(b->>'clubBookId','') !~* '^[a-f0-9-]{36}$' then
  delete from private.progress_tracking_state where member_id=new.member_id and personal_id=new.entity_id;return new;
 end if;
 selected:=(b->>'clubBookId')::uuid;
 select * into r from public.club_readings where book_id=selected and status in ('active','finished') order by (status='active') desc,starts_on desc,completed_at desc nulls last,id desc limit 1;
 if r.id is null then return new;end if;
 select payload into p from public.private_library_records where member_id=new.member_id and kind='progress' and entity_id=new.entity_id;
 total:=least(coalesce((b->>'totalPages')::integer,0),1000000);page_count:=least(coalesce((p->>'pages')::integer,0),total);has_p:=p is not null;
 book_status:=case when b->>'status' in ('planned','reading','finished','paused','abandoned') then b->>'status' else 'planned' end;
 if r.status='active' then
  insert into public.reading_participation(reading_id,member_id,choice) values(r.id,new.member_id,
   case when book_status='finished' and (b->>'completedAt' is null or private.reading_event_time(b->>'completedAt')<(r.starts_on::timestamp at time zone 'Europe/Moscow')) then 'already_read' else 'reading' end) on conflict do nothing;
 end if;
 select * into c from public.reading_participation where reading_id=r.id and member_id=new.member_id;
 eligible:=coalesce(c.choice,'reading')<>'already_read' and not(r.status='active' and c.choice='declined');
 select * into s from private.progress_tracking_state where member_id=new.member_id and personal_id=new.entity_id;
 if s.member_id is null or s.book_id<>selected or s.reading_id is distinct from r.id then
  insert into private.progress_tracking_state(member_id,personal_id,book_id,reading_id,pages,total_pages,has_progress)
  values(new.member_id,new.entity_id,selected,r.id,case when new.kind='progress' then coalesce((case when tg_op='UPDATE' then old.payload->>'pages' end)::integer,page_count) else page_count end,total,
   case when new.kind='progress' then tg_op='UPDATE' and old.payload is not null else has_p end)
  on conflict(member_id,personal_id) do update set book_id=excluded.book_id,reading_id=excluded.reading_id,pages=excluded.pages,total_pages=excluded.total_pages,has_progress=excluded.has_progress,edition_changed=false;
  select * into s from private.progress_tracking_state where member_id=new.member_id and personal_id=new.entity_id;
 end if;
 if new.kind='book' then
  if s.total_pages<>total then update private.progress_tracking_state set total_pages=total,edition_changed=true where member_id=new.member_id and personal_id=new.entity_id;end if;
  if tg_op='UPDATE' and old.payload is not null and old.payload->>'status' is distinct from book_status and eligible then
   insert into public.reading_activity(member_id,book_id,reading_id,revision,kind,pages_before,pages_after,total_pages,pages_delta,status,occurred_at)
   values(new.member_id,selected,r.id,new.revision,'status',page_count,page_count,total,0,book_status,private.reading_event_time(b->>'updatedAt')) on conflict do nothing;
  end if;
  if book_status='finished' and eligible then
   if b->>'completedAt' is not null then finished:=private.reading_event_time(b->>'completedAt');
   elsif tg_op='UPDATE' and old.payload is not null and old.payload->>'status' is distinct from 'finished' then finished:=clock_timestamp();end if;
   if finished is not null and finished>=(r.starts_on::timestamp at time zone 'Europe/Moscow') then
    insert into public.reading_completions(reading_id,book_id,member_id,completed_at) values(r.id,selected,new.member_id,finished) on conflict do nothing;
   end if;
  elsif book_status<>'finished' then delete from public.reading_completions where reading_id=r.id and member_id=new.member_id;end if;
 else
  before_pages:=s.pages;occurred:=private.reading_event_time(p->>'updatedAt');
  event_kind:=case when not s.has_progress then 'baseline' when s.edition_changed or s.total_pages<>total or page_count<before_pages then 'correction' else 'progress' end;
  delta:=case when event_kind='progress' then greatest(page_count-before_pages,0) else 0 end;
  if occurred<(r.starts_on::timestamp at time zone 'Europe/Moscow') then event_kind:='baseline';delta:=0;end if;
  if eligible and (page_count<>before_pages or (not s.has_progress and page_count>0)) then
   insert into public.reading_activity(member_id,book_id,reading_id,revision,kind,pages_before,pages_after,total_pages,pages_delta,status,occurred_at)
   values(new.member_id,selected,r.id,new.revision,event_kind,before_pages,page_count,total,delta,book_status,occurred) on conflict do nothing;
  end if;
  update private.progress_tracking_state set pages=page_count,total_pages=total,has_progress=has_p,edition_changed=false where member_id=new.member_id and personal_id=new.entity_id;
 end if;
 if c.reading_id is null and r.status='finished' and has_p then
  insert into public.reading_participation(reading_id,member_id,choice) values(r.id,new.member_id,'reading') on conflict do nothing;
 end if;
 if eligible or c.choice='already_read' then
  update public.reading_participation set pages=case when choice='already_read' then total else page_count end,total_pages=total,status=case when choice='already_read' then 'finished' else book_status end where reading_id=r.id and member_id=new.member_id;
 end if;
 return new;
end $$;
revoke all on function private.capture_reading_activity() from public,anon,authenticated;
create trigger reading_activity_changed after insert or update on public.private_library_records for each row execute function private.capture_reading_activity();

-- Baselines describe current known pages, not invented past reading sessions.
update public.reading_participation c set pages=case when c.choice='already_read' then p.total_pages else p.pages end,total_pages=p.total_pages,status=case when c.choice='already_read' then 'finished' else p.status end
 from public.club_readings r,public.public_reading_progress p where c.reading_id=r.id and p.book_id=r.book_id and p.member_id=c.member_id and r.status='active' and c.choice<>'declined';
insert into private.progress_tracking_state(member_id,personal_id,book_id,reading_id,pages,total_pages,has_progress)
 select b.member_id,b.entity_id,c.id,r.id,least(coalesce((p.payload->>'pages')::integer,0),coalesce((b.payload->>'totalPages')::integer,0)),coalesce((b.payload->>'totalPages')::integer,0),p.payload is not null
 from public.private_library_records b join public.club_books c on c.id::text=b.payload->>'clubBookId'
 join lateral(select * from public.club_readings where book_id=c.id and status in ('active','finished') order by (status='active') desc,starts_on desc,id desc limit 1)r on true
 left join public.private_library_records p on p.member_id=b.member_id and p.kind='progress' and p.entity_id=b.entity_id
 where b.kind='book' and b.payload is not null and coalesce(b.payload->>'deletedAt','')='' on conflict do nothing;
insert into public.reading_completions(reading_id,book_id,member_id,completed_at,recorded_at)
 select r.id,f.book_id,f.member_id,f.completed_at,f.completed_at from private.reading_finishes f join private.book_announcement_state s on s.book_id=f.book_id and s.generation=f.generation
 join public.club_readings r on r.book_id=f.book_id and r.status='active' left join public.reading_participation c on c.reading_id=r.id and c.member_id=f.member_id
 where s.is_current and coalesce(c.choice,'reading') not in ('already_read','declined') on conflict do nothing;

create function private.book_reading_report(selected uuid,cycle uuid,all_cycles boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.club_books;r public.club_readings;people jsonb;finishers jsonb;activity jsonb;periods jsonb;weekdays jsonb;timeline jsonb;liked jsonb;disliked jsonb;
begin
 if not public.is_admin() then raise exception 'Требуется администратор' using errcode='42501';end if;
 select * into b from public.club_books where id=selected;
 if b.id is null then raise exception 'Книга не найдена';end if;
 if not all_cycles then
  select * into r from public.club_readings where book_id=selected and (cycle is null or id=cycle) order by (status='active') desc,starts_on desc,completed_at desc nulls last,id desc limit 1;
  if cycle is not null and r.id is null then raise exception 'Чтение не относится к этой книге';end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]') into people from(
  select m.id as member_id,coalesce(nullif(p.name,''),'Участник') as name,c.choice,c.status,c.pages,c.total_pages,f.completed_at,
   case when c.total_pages>0 then least(100,round(c.pages::numeric/c.total_pages*100)) else null end as percent
  from public.club_members m left join public.member_profiles p on p.member_id=m.id
  left join lateral(select c.* from public.reading_participation c join public.club_readings cr on cr.id=c.reading_id where c.member_id=m.id and cr.book_id=selected and (r.id is null or c.reading_id=r.id) order by cr.starts_on desc,cr.id desc limit 1)c on true
  left join lateral(select f.completed_at from public.reading_completions f where f.member_id=m.id and f.book_id=selected and (r.id is null or f.reading_id=r.id) order by f.completed_at desc limit 1)f on true
  where m.active
 )x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.completed_at,x.member_id),'[]') into finishers from(
  select f.member_id,coalesce(nullif(p.name,''),'Участник') as name,f.reading_id,f.completed_at from public.reading_completions f
  join public.club_members m on m.id=f.member_id and m.active left join public.member_profiles p on p.member_id=m.id
  left join public.reading_participation c on c.reading_id=f.reading_id and c.member_id=f.member_id
  where f.book_id=selected and (r.id is null or f.reading_id=r.id) and coalesce(c.choice,'reading')<>'already_read'
 )x;
 select jsonb_build_object('pages_logged',coalesce(sum(e.pages_delta),0),'updates',count(*) filter(where e.kind='progress' and e.pages_delta>0),'corrections',count(*) filter(where e.kind='correction'),'baselines',count(*) filter(where e.kind='baseline')) into activity
 from public.reading_activity e join public.club_members m on m.id=e.member_id and m.active where e.book_id=selected and (r.id is null or e.reading_id=r.id);
 with totals as(select case when extract(hour from e.occurred_at at time zone 'Europe/Moscow')<6 then 0 when extract(hour from e.occurred_at at time zone 'Europe/Moscow')<12 then 1 when extract(hour from e.occurred_at at time zone 'Europe/Moscow')<18 then 2 else 3 end as n,sum(e.pages_delta) as pages,count(*) as updates
  from public.reading_activity e join public.club_members m on m.id=e.member_id and m.active where e.book_id=selected and (r.id is null or e.reading_id=r.id) and e.kind='progress' and e.pages_delta>0 group by 1)
 select jsonb_agg(jsonb_build_object('label',(array['Ночь · 00–06','Утро · 06–12','День · 12–18','Вечер · 18–24'])[g+1],'pages',coalesce(t.pages,0),'updates',coalesce(t.updates,0)) order by g) into periods from generate_series(0,3)g left join totals t on t.n=g;
 with totals as(select extract(isodow from e.occurred_at at time zone 'Europe/Moscow')::integer as n,sum(e.pages_delta) as pages,count(*) as updates
  from public.reading_activity e join public.club_members m on m.id=e.member_id and m.active where e.book_id=selected and (r.id is null or e.reading_id=r.id) and e.kind='progress' and e.pages_delta>0 group by 1)
 select jsonb_agg(jsonb_build_object('label',(array['Пн','Вт','Ср','Чт','Пт','Сб','Вс'])[g],'pages',coalesce(t.pages,0),'updates',coalesce(t.updates,0)) order by g) into weekdays from generate_series(1,7)g left join totals t on t.n=g;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.date),'[]') into timeline from(
  select (e.occurred_at at time zone 'Europe/Moscow')::date as date,sum(e.pages_delta) as pages,count(*) as updates from public.reading_activity e join public.club_members m on m.id=e.member_id and m.active
  where e.book_id=selected and (r.id is null or e.reading_id=r.id) and e.kind='progress' and e.pages_delta>0 group by 1
 )x;
 with ranked as(select p.*,coalesce(nullif(a.name,''),'Участник') as author,
  (select count(*) from public.content_reactions v where v.target_kind=p.kind and v.target_id=p.id and v.value=1 and public.active_member(v.member_id)) as likes,
  (select count(*) from public.content_reactions v where v.target_kind=p.kind and v.target_id=p.id and v.value=-1 and public.active_member(v.member_id)) as dislikes,
  (select count(*) from public.content_comments c where c.target_kind=p.kind and c.target_id=p.id and public.active_member(c.member_id)) as comments
  from public.club_publications p left join public.member_profiles a on a.member_id=p.member_id where p.book_id=selected)
 select coalesce((select jsonb_agg(to_jsonb(x)) from(select * from ranked where likes>0 order by likes desc,dislikes,updated_at desc limit 10)x),'[]'),coalesce((select jsonb_agg(to_jsonb(x)) from(select * from ranked where dislikes>0 order by dislikes desc,likes,updated_at desc limit 10)x),'[]') into liked,disliked;
 return jsonb_build_object('book',to_jsonb(b),'reading',case when r.id is null then null else to_jsonb(r) end,'cycles',(select coalesce(jsonb_agg(to_jsonb(cr) order by cr.starts_on desc,cr.id desc),'[]') from public.club_readings cr where cr.book_id=selected),
  'generated_at',clock_timestamp(),'timezone','Europe/Moscow','readers',people,'finishers',finishers,'activity',activity,'periods',periods,'weekdays',weekdays,'timeline',timeline,
  'member_activity',(select coalesce(jsonb_agg(to_jsonb(x) order by x.date,x.name,x.period),'[]') from(
    select e.member_id,coalesce(nullif(p.name,''),'Участник') as name,(e.occurred_at at time zone 'Europe/Moscow')::date as date,
      case when extract(hour from e.occurred_at at time zone 'Europe/Moscow')<6 then 'Ночь · 00–06' when extract(hour from e.occurred_at at time zone 'Europe/Moscow')<12 then 'Утро · 06–12' when extract(hour from e.occurred_at at time zone 'Europe/Moscow')<18 then 'День · 12–18' else 'Вечер · 18–24' end as period,
      sum(e.pages_delta) as pages,count(*) as updates
    from public.reading_activity e join public.club_members m on m.id=e.member_id and m.active left join public.member_profiles p on p.member_id=e.member_id
    where e.book_id=selected and (r.id is null or e.reading_id=r.id) and e.kind='progress' and e.pages_delta>0 group by 1,2,3,4
  )x),'top_liked',liked,'top_disliked',disliked);
end $$;
revoke all on function private.book_reading_report(uuid,uuid,boolean) from public,anon,authenticated;

alter function public.club_action(text,jsonb) rename to club_action_v14;
revoke all on function public.club_action_v14(text,jsonb) from public,anon,authenticated;
create function public.club_action(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if public.my_member_id() is null then raise exception 'Нет доступа к клубу' using errcode='42501';end if;
 if p_action like 'admin.%' and not public.is_admin() then raise exception 'Требуется администратор' using errcode='42501';end if;
 if p_action='admin.reading_report' then return private.book_reading_report((p_data->>'book_id')::uuid,nullif(p_data->>'reading_id','')::uuid,coalesce((p_data->>'all_cycles')::boolean,false));end if;
 if p_action='admin.delete_book' and (exists(select 1 from public.meeting_books where book_id=(p_data->>'id')::uuid) or exists(select 1 from public.reading_activity where book_id=(p_data->>'id')::uuid) or exists(select 1 from public.club_readings where book_id=(p_data->>'id')::uuid and status='finished')) then raise exception 'У книги есть история клуба. Выберите статус «Архив», чтобы сохранить встречи и отчёты.';end if;
 return public.club_action_v14(p_action,p_data);
end $$;
revoke all on function public.club_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.club_action(text,jsonb) to authenticated;
commit;
