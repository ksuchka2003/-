begin;
-- Preserve owner-only records; trash removes their public projections immediately.
create or replace function private.refresh_club_progress(owner_id uuid, personal_id text) returns void
language plpgsql security definer set search_path='' as $$
declare b jsonb; p jsonb; shared_id uuid; target_book uuid; total integer; page_count integer; state text; started date; finished date; chosen_cover text;
begin
 shared_id:=md5(owner_id::text||':'||personal_id)::uuid;
 select payload into b from public.private_library_records where member_id=owner_id and kind='book' and entity_id=personal_id;
 delete from public.public_reading_progress where member_id=owner_id and (id=shared_id or id::text=personal_id);
 if b is null or coalesce(b->>'deletedAt','')<>'' or coalesce(b->>'clubBookId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return; end if;
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
revoke all on function private.refresh_club_progress(uuid,text) from public,anon,authenticated;

create function private.hide_trashed_library() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.kind='book' and (new.payload is null or coalesce(new.payload->>'deletedAt','')<>'') then
  delete from public.public_reviews where member_id=new.member_id and id::text=new.entity_id;
  delete from public.public_quotes where member_id=new.member_id and id::text in
   (select entity_id from public.private_library_records where member_id=new.member_id and kind='quote' and payload->>'bookId'=new.entity_id);
 elsif new.kind='quote' and (new.payload is null or coalesce(new.payload->>'published','false')<>'true' or coalesce(new.payload->>'deletedAt','')<>'') then
  delete from public.public_quotes where member_id=new.member_id and id::text=new.entity_id;
 end if;
 return new;
end $$;
revoke all on function private.hide_trashed_library() from public,anon,authenticated;
create trigger hide_trashed_library after insert or update on public.private_library_records
 for each row execute function private.hide_trashed_library();

-- An older queued publication must not bring a trashed book's content back.
alter function public.sync_public(text,uuid,jsonb,bigint) rename to sync_public_v11;
revoke all on function public.sync_public_v11(text,uuid,jsonb,bigint) from public,anon,authenticated;
create function public.sync_public(p_kind text,p_entity uuid,p_payload jsonb,p_version bigint) returns void
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=public.my_member_id(); parent_id text;
begin
 if owner_id is null then raise exception 'Нет доступа к клубу' using errcode='42501'; end if;
 if p_kind='review' then parent_id:=p_entity::text;
 elsif p_kind='quote' then
  select payload->>'bookId' into parent_id from public.private_library_records where member_id=owner_id and kind='quote' and entity_id=p_entity::text;
 end if;
 if p_payload is not null and exists(
  select 1 from public.private_library_records where member_id=owner_id and kind='book' and entity_id=parent_id and coalesce(payload->>'deletedAt','')<>''
 ) then
  perform public.sync_public_v11(p_kind,p_entity,null,p_version);
  return;
 end if;
 perform public.sync_public_v11(p_kind,p_entity,p_payload,p_version);
end $$;
revoke all on function public.sync_public(text,uuid,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.sync_public(text,uuid,jsonb,bigint) to authenticated;
commit;
