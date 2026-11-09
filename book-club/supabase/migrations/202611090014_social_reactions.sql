begin;
create view public.club_publications with(security_barrier=true) as
 select q.id,q.member_id,q.book_id,q.title,'quote'::text as kind,q.text,q.updated_at as created_at,q.updated_at from public.club_quotes q
 union all select e.id,e.member_id,e.book_id,e.title,e.kind,e.text,e.created_at,e.updated_at from public.club_entries e
 union all select r.id,r.member_id,r.book_id,r.title,'review'::text,r.text,r.updated_at,r.updated_at from public.club_reviews r;
revoke all on public.club_publications from public,anon,authenticated;
grant select on public.club_publications to authenticated;
create table public.content_comments(
 id uuid primary key,member_id uuid not null references public.club_members on delete cascade,
 target_kind text not null check(target_kind in ('quote','note','thought','review')),target_id uuid not null,
 text text not null check(length(trim(text)) between 1 and 5000),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index comments_target on public.content_comments(target_kind,target_id,created_at,id);
create table public.content_reactions(
 target_kind text not null check(target_kind in ('quote','note','thought','review','comment')),target_id uuid not null,
 member_id uuid not null references public.club_members on delete cascade,value smallint not null check(value in (-1,1)),updated_at timestamptz not null default now(),
 primary key(target_kind,target_id,member_id)
);
create index reactions_member on public.content_reactions(member_id);
create function public.can_view_content(k text,entity uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare c public.content_comments;
begin
 if public.my_member_id() is null then return false;end if;
 if k='comment' then
  select * into c from public.content_comments where id=entity;
  if c.id is null or not public.active_member(c.member_id) then return false;end if;
  return exists(select 1 from public.club_publications p where p.kind=c.target_kind and p.id=c.target_id);
 end if;
 return exists(select 1 from public.club_publications p where p.kind=k and p.id=entity);
end $$;
revoke all on function public.can_view_content(text,uuid) from public,anon,authenticated;
grant execute on function public.can_view_content(text,uuid) to authenticated;
alter table public.content_comments enable row level security;
alter table public.content_reactions enable row level security;
revoke all on public.content_comments,public.content_reactions from public,anon,authenticated;
grant select on public.content_comments,public.content_reactions to authenticated;
grant all on public.content_comments,public.content_reactions to service_role;
create policy comments_read on public.content_comments for select to authenticated using(public.active_member(member_id) and public.can_view_content(target_kind,target_id));
create policy reactions_read on public.content_reactions for select to authenticated using(public.active_member(member_id) and public.can_view_content(target_kind,target_id));
insert into public.content_reactions(target_kind,target_id,member_id,value,updated_at) select 'quote',quote_id,member_id,1,created_at from public.quote_likes on conflict do nothing;

create function private.remove_content_interactions() returns trigger language plpgsql security definer set search_path='' as $$
declare k text;
begin
 k:=case tg_table_name when 'public_quotes' then 'quote' when 'public_reviews' then 'review' when 'public_entries' then to_jsonb(old)->>'kind' else 'comment' end;
 if k<>'comment' then delete from public.content_comments where target_kind=k and target_id=old.id;end if;
 delete from public.content_reactions where target_kind=k and target_id=old.id;
 return old;
end $$;
revoke all on function private.remove_content_interactions() from public,anon,authenticated;
create trigger quote_interactions after delete on public.public_quotes for each row execute function private.remove_content_interactions();
create trigger review_interactions after delete on public.public_reviews for each row execute function private.remove_content_interactions();
create trigger entry_interactions after delete on public.public_entries for each row execute function private.remove_content_interactions();
create trigger comment_interactions after delete on public.content_comments for each row execute function private.remove_content_interactions();

alter function public.club_action(text,jsonb) rename to club_action_v13;
revoke all on function public.club_action_v13(text,jsonb) from public,anon,authenticated;
create function public.club_action(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.my_member_id();k text;entity uuid;reaction smallint;c public.content_comments;body text;
begin
 if actor is null then raise exception 'Нет доступа к клубу' using errcode='42501';end if;
 if p_action like 'admin.%' and not public.is_admin() then raise exception 'Требуется администратор' using errcode='42501';end if;
 if p_action in ('content.reaction','like') then
  k:=case when p_action='like' then 'quote' else p_data->>'target_kind' end;
  entity:=(case when p_action='like' then p_data->>'quote_id' else p_data->>'target_id' end)::uuid;
  reaction:=case when p_action='like' then case when (p_data->>'liked')::boolean then 1 else null end else (p_data->>'value')::smallint end;
  if k is null or k not in ('quote','note','thought','review','comment') or entity is null or (reaction is not null and reaction not in (-1,1)) then raise exception 'Неверная реакция';end if;
  if not public.can_view_content(k,entity) then raise exception 'Публикация недоступна';end if;
  if reaction is null then delete from public.content_reactions where target_kind=k and target_id=entity and member_id=actor;
  else insert into public.content_reactions(target_kind,target_id,member_id,value) values(k,entity,actor,reaction) on conflict(target_kind,target_id,member_id) do update set value=excluded.value,updated_at=now();end if;
  if k='quote' then
   delete from public.quote_likes where quote_id=entity and member_id=actor;
   if reaction=1 then insert into public.quote_likes(quote_id,member_id) values(entity,actor) on conflict do nothing;end if;
  end if;
  return jsonb_build_object('ok',true);
 elsif p_action='content.comment' then
  k:=p_data->>'target_kind';entity:=(p_data->>'target_id')::uuid;body:=trim(p_data->>'text');
  if k is null or k not in ('quote','note','thought','review') or entity is null or body is null or length(body) not between 1 and 5000 then raise exception 'Введите комментарий до 5000 символов';end if;
  if not public.can_view_content(k,entity) then raise exception 'Публикация недоступна';end if;
  select * into c from public.content_comments where id=(p_data->>'id')::uuid for update;
  if c.id is not null and (c.member_id<>actor or c.target_kind<>k or c.target_id<>entity) then raise exception 'Можно изменить только свой комментарий';end if;
  insert into public.content_comments(id,member_id,target_kind,target_id,text) values((p_data->>'id')::uuid,actor,k,entity,body)
  on conflict(id) do update set text=excluded.text,updated_at=now();
  return jsonb_build_object('ok',true);
 elsif p_action='content.comment.delete' then
  select * into c from public.content_comments where id=(p_data->>'id')::uuid for update;
  if c.id is null then return jsonb_build_object('ok',true);end if;
  if c.member_id<>actor and not public.is_admin() then raise exception 'Можно удалить только свой комментарий';end if;
  delete from public.content_comments where id=c.id;
  return jsonb_build_object('ok',true);
 end if;
 return public.club_action_v13(p_action,p_data);
end $$;
revoke all on function public.club_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.club_action(text,jsonb) to authenticated;
commit;
