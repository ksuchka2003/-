begin;
create table private.reading_finishes(
 book_id uuid not null references public.club_books on delete cascade,
 member_id uuid not null references public.club_members on delete cascade,
 generation bigint not null, completed_at timestamptz not null default clock_timestamp(),
 primary key(book_id,member_id,generation)
);
create function private.record_reading_finish() returns trigger language plpgsql security definer set search_path='' as $$
declare old_book uuid;new_book uuid;round bigint;
begin
 if new.kind<>'book' then return null; end if;
 if tg_op='UPDATE' and old.payload->>'clubBookId' ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then old_book:=(old.payload->>'clubBookId')::uuid;end if;
 if new.payload->>'clubBookId' ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then new_book:=(new.payload->>'clubBookId')::uuid;end if;
 if old_book is not null and (old_book is distinct from new_book or new.payload->>'status' is distinct from 'finished') then
  delete from private.reading_finishes f using private.book_announcement_state s
  where f.book_id=old_book and f.member_id=new.member_id and s.book_id=f.book_id and s.generation=f.generation;
 end if;
 if new_book is null or new.payload->>'status' is distinct from 'finished' then return null; end if;
 if tg_op='UPDATE' and old_book=new_book and old.payload->>'status'='finished' then return null; end if;
 select generation into round from private.book_announcement_state where book_id=new_book and is_current;
 if round is not null then
  insert into private.reading_finishes(book_id,member_id,generation) values(new_book,new.member_id,round) on conflict do nothing;
 end if;
 return null;
end $$;
revoke all on function private.record_reading_finish() from public,anon,authenticated;
create trigger reading_finish after insert or update of payload on public.private_library_records for each row execute function private.record_reading_finish();

create view public.club_reading_awards with(security_barrier=true) as
 with eligible as (
  select f.* from private.reading_finishes f
  join private.book_announcement_state s on s.book_id=f.book_id and s.generation=f.generation and s.is_current
  join public.club_members m on m.id=f.member_id and m.active
  where public.my_member_id() is not null and exists(select 1 from public.public_reading_progress p where p.member_id=f.member_id and p.book_id=f.book_id and p.status='finished')
 ), ranked as (
  select *,row_number() over(partition by book_id,generation order by completed_at,member_id) as first_place,
   row_number() over(partition by book_id,generation order by completed_at desc,member_id desc) as last_place,
   count(*) over(partition by book_id,generation) as finished_count from eligible
 ), awards as (
  select book_id,member_id,'first'::text as kind from ranked where first_place=1
  union all
  select book_id,member_id,'last'::text as kind from ranked where last_place=1 and finished_count>=2
    and finished_count=(select count(*) from public.club_members where active)
 )
 select book_id::text||':'||member_id::text||':'||kind as id,book_id,member_id,kind from awards;
revoke all on public.club_reading_awards from public,anon,authenticated;
grant select on public.club_reading_awards to authenticated;
commit;
