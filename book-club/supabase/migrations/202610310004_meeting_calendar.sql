begin;
alter table public.meetings add column duration_minutes integer not null default 120 check(duration_minutes between 30 and 720);
alter table public.meetings add column schedule_version integer not null default 1;
alter table public.meeting_attendance add column comment text not null default '' check(length(comment)<=2000);
alter table public.meeting_attendance add column interested boolean not null default true;
alter table public.meeting_attendance add column schedule_version integer not null default 1;
alter table public.meeting_attendance add constraint attendance_interest check(interested or response='no');
alter table public.meeting_attendance add column updated_at timestamptz not null default now();

create function private.valid_busy_ranges(ranges jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; start_min integer; end_min integer; previous_end integer:=-1;
begin
 if jsonb_typeof(ranges)<>'array' or jsonb_array_length(ranges)>12 then return false; end if;
 for item in select value from jsonb_array_elements(ranges) loop
  if jsonb_typeof(item)<>'array' or jsonb_array_length(item)<>2 then return false; end if;
  if jsonb_typeof(item->0)<>'number' or jsonb_typeof(item->1)<>'number' then return false; end if;
  if (item->>0)::numeric<>trunc((item->>0)::numeric) or (item->>1)::numeric<>trunc((item->>1)::numeric) then return false; end if;
  start_min:=(item->>0)::integer; end_min:=(item->>1)::integer;
  if start_min<0 or end_min>1440 or start_min>=end_min or start_min<previous_end then return false; end if;
  previous_end:=end_min;
 end loop;
 return true;
exception when others then return false;
end $$;
create table public.meeting_availability (
 member_id uuid not null references public.club_members(id) on delete cascade,
 day date not null, status text not null check(status in ('free','partial','busy')),
 busy_ranges jsonb not null default '[]', comment text not null default '' check(length(comment)<=1000),
 updated_at timestamptz not null default now(), primary key(member_id,day),
 check(private.valid_busy_ranges(busy_ranges)),
 check((status='partial' and jsonb_array_length(busy_ranges)>0) or (status<>'partial' and busy_ranges='[]'::jsonb))
);
create index availability_day on public.meeting_availability(day);
alter table public.meeting_availability enable row level security;
revoke all on public.meeting_availability from public,anon,authenticated;
grant select on public.meeting_availability to authenticated;
grant all on public.meeting_availability to service_role;
create policy calendar_read on public.meeting_availability for select to authenticated
 using(public.my_member_id() is not null and public.active_member(member_id));
create view public.meeting_participants as
 select m.id as member_id,coalesce(nullif(p.name,''),'Участник') as name
 from public.club_members m left join public.member_profiles p on p.member_id=m.id
 where m.active and public.my_member_id() is not null;
revoke all on public.meeting_participants from public,anon,authenticated;
grant select on public.meeting_participants to authenticated;

alter function public.club_action(text,jsonb) rename to club_action_v3;
revoke all on function public.club_action_v3(text,jsonb) from public,anon,authenticated;
create function public.club_action(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.my_member_id(); selected_day date; target public.meetings;
 selected_meeting uuid; starts timestamptz; duration integer; first_min integer; last_min integer;
 schedule_changed boolean; ranges jsonb; state text;
begin
 if actor is null then raise exception 'Нет доступа к клубу' using errcode='42501'; end if;
 if p_action like 'admin.%' and not public.is_admin() then raise exception 'Требуется администратор' using errcode='42501'; end if;
 if p_action='availability' then
  perform pg_advisory_xact_lock(2147482999);
  selected_day:=(p_data->>'day')::date;
  if selected_day is null or selected_day<(now() at time zone 'Europe/Moscow')::date or selected_day>(now() at time zone 'Europe/Moscow')::date+366 then raise exception 'Выберите день в ближайшие 12 месяцев'; end if;
  state:=p_data->>'status';
  if state is null then
   delete from public.meeting_availability where member_id=actor and day=selected_day;
  else
   ranges:=coalesce(p_data->'busy_ranges','[]'::jsonb);
   insert into public.meeting_availability(member_id,day,status,busy_ranges,comment)
   values(actor,selected_day,state,ranges,coalesce(p_data->>'comment',''))
   on conflict(member_id,day) do update set status=excluded.status,busy_ranges=excluded.busy_ranges,comment=excluded.comment,updated_at=now();
  end if;
  return jsonb_build_object('ok',true);
 elsif p_action='attendance' then
  select * into target from public.meetings where id=(p_data->>'meeting_id')::uuid for update;
  if target.id is null or target.cancelled or target.starts_at<=now() then raise exception 'Встреча завершена или отменена'; end if;
  if (p_data->>'schedule_version')::integer is distinct from target.schedule_version then raise exception 'Время встречи изменилось. Обновите страницу и ответьте заново'; end if;
  insert into public.meeting_attendance(meeting_id,member_id,response,comment,interested,schedule_version)
  values(target.id,actor,p_data->>'response',coalesce(p_data->>'comment',''),coalesce((p_data->>'interested')::boolean,true),target.schedule_version)
  on conflict(meeting_id,member_id) do update set response=excluded.response,comment=excluded.comment,interested=excluded.interested,schedule_version=excluded.schedule_version,updated_at=now();
  return jsonb_build_object('ok',true);
 elsif p_action='admin.meeting' then
  perform pg_advisory_xact_lock(2147482999);
  selected_meeting:=(p_data->>'id')::uuid;
  select * into target from public.meetings where id=selected_meeting for update;
  if target.id is not null and (p_data->>'version')::integer is distinct from target.version then raise exception 'Встречу уже изменили. Обновите страницу'; end if;
  starts:=(p_data->>'starts_at')::timestamptz;
  duration:=coalesce((p_data->>'duration_minutes')::integer,120);
  schedule_changed:=target.id is null or target.starts_at is distinct from starts or target.duration_minutes<>duration or (target.cancelled and not coalesce((p_data->>'cancelled')::boolean,false));
  if not coalesce((p_data->>'cancelled')::boolean,false) and schedule_changed then
   if starts is null or starts<=now() then raise exception 'Выберите будущее время встречи'; end if;
   selected_day:=(starts at time zone 'Europe/Moscow')::date;
   if selected_day<>((starts+make_interval(mins=>duration)) at time zone 'Europe/Moscow')::date then raise exception 'Встреча должна закончиться в тот же день (МСК)'; end if;
   first_min:=extract(hour from starts at time zone 'Europe/Moscow')::integer*60+extract(minute from starts at time zone 'Europe/Moscow')::integer;
   last_min:=first_min+duration;
   if exists(select 1 from public.meeting_availability a where a.day=selected_day and public.active_member(a.member_id) and
    (a.status='busy' or (a.status='partial' and exists(select 1 from jsonb_array_elements(a.busy_ranges) r where (r->>0)::integer<last_min and (r->>1)::integer>first_min)))) then
    raise exception 'В это время кто-то занят. Выберите общий свободный интервал';
   end if;
   if exists(select 1 from public.meetings m where m.id<>selected_meeting and not m.cancelled and m.starts_at<starts+make_interval(mins=>duration) and m.starts_at+make_interval(mins=>m.duration_minutes)>starts) then
    raise exception 'Это время уже занято другой встречей клуба';
   end if;
  end if;
  insert into public.meetings(id,title,starts_at,place,description,cancelled,duration_minutes)
  values(selected_meeting,p_data->>'title',starts,coalesce(p_data->>'place',''),coalesce(p_data->>'description',''),coalesce((p_data->>'cancelled')::boolean,false),duration)
  on conflict(id) do update set title=excluded.title,starts_at=excluded.starts_at,place=excluded.place,description=excluded.description,cancelled=excluded.cancelled,duration_minutes=excluded.duration_minutes,
   version=meetings.version+1,schedule_version=meetings.schedule_version+case when schedule_changed then 1 else 0 end;
  delete from public.meeting_books where meeting_books.meeting_id=selected_meeting;
  insert into public.meeting_books(meeting_id,book_id) select selected_meeting,value::uuid from jsonb_array_elements_text(coalesce(p_data->'book_ids','[]'::jsonb)) on conflict do nothing;
  return jsonb_build_object('ok',true);
 end if;
 return public.club_action_v3(p_action,p_data);
end $$;
revoke all on function public.club_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.club_action(text,jsonb) to authenticated;
revoke all on function private.valid_busy_ranges(jsonb) from public,anon,authenticated;
commit;
