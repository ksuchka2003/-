begin;
alter table public.public_reading_progress add column cover text not null default ''
 check(length(cover)<=60000 and (cover='' or (length(cover)<=2048 and cover ~ '^https://') or cover ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$'));
create or replace function private.refresh_club_progress(owner_id uuid, personal_id text) returns void
language plpgsql security definer set search_path='' as $$
declare b jsonb; p jsonb; shared_id uuid; target_book uuid; total integer; page_count integer; state text; started date; finished date; chosen_cover text;
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
 chosen_cover:=case
  when length(coalesce(b->>'coverData',''))<=60000 and b->>'coverData' ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$' then b->>'coverData'
  when length(coalesce(b->>'cover',''))<=2048 and b->>'cover' ~ '^https://' then b->>'cover'
  else coalesce((select cover from public.club_books where id=target_book and length(cover)<=2048 and cover ~ '^https://'),'') end;
 insert into public.public_reading_progress(id,member_id,book_id,title,status,pages,total_pages,chapter,started_on,finished_on,cover)
 values(shared_id,owner_id,target_book,left(coalesce(b->>'title','Книга'),300),state,page_count,total,left(coalesce(p->>'chapter',''),300),started,finished,chosen_cover)
 on conflict(member_id,book_id) do update set id=excluded.id,title=excluded.title,status=excluded.status,pages=excluded.pages,total_pages=excluded.total_pages,chapter=excluded.chapter,started_on=excluded.started_on,finished_on=excluded.finished_on,cover=excluded.cover,updated_at=now();
end $$;

create or replace view public.visible_progress as
 select id,member_id,book_id,title,status,pages,total_pages,updated_at,chapter,started_on,finished_on,cover
 from public.public_reading_progress where public.my_member_id() is not null and public.active_member(member_id);

create function private.refresh_catalog_cover() returns trigger
language plpgsql security definer set search_path='' as $$
declare r record;
begin
 for r in select member_id,entity_id from public.private_library_records where kind='book' and payload->>'clubBookId'=new.id::text
  and (coalesce(payload->>'coverData','') !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$' or length(payload->>'coverData')>60000)
  and (coalesce(payload->>'cover','') !~ '^https://' or length(payload->>'cover')>2048) loop
  perform private.refresh_club_progress(r.member_id,r.entity_id);
 end loop;
 return new;
end $$;
revoke all on function private.refresh_catalog_cover() from public,anon,authenticated;
create trigger refresh_catalog_cover after update of cover on public.club_books
for each row when (old.cover is distinct from new.cover) execute function private.refresh_catalog_cover();

do $$ declare r record; begin
 for r in select member_id,entity_id from public.private_library_records where kind='book' loop perform private.refresh_club_progress(r.member_id,r.entity_id); end loop;
end $$;
commit;
