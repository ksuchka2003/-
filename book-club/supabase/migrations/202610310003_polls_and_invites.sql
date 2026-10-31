begin;
create table public.book_polls (
 id uuid primary key references public.book_proposals(id) on delete cascade,
 metadata jsonb not null, created_by uuid not null references public.club_members(id),
 created_at timestamptz not null default now(), closed_at timestamptz
);
create table public.book_votes (
 poll_id uuid not null references public.book_polls(id) on delete cascade,
 member_id uuid not null references public.club_members(id) on delete cascade,
 choice text not null check(choice in ('yes','later','no')),
 updated_at timestamptz not null default now(), primary key(poll_id,member_id)
);
create table public.member_invites (
 id uuid primary key, token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid not null references public.club_members(id), created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 max_uses integer not null default 1 check(max_uses between 1 and 19),
 uses integer not null default 0 check(uses between 0 and max_uses), revoked boolean not null default false
);
create index book_votes_member on public.book_votes(member_id);
alter table public.book_polls enable row level security;
alter table public.book_votes enable row level security;
alter table public.member_invites enable row level security;
revoke all on public.book_polls,public.book_votes,public.member_invites from public,anon,authenticated;
grant all on public.book_polls,public.book_votes,public.member_invites to service_role;
create policy polls_read on public.book_polls for select to authenticated using(public.my_member_id() is not null);
create policy own_vote on public.book_votes for select to authenticated using(member_id=public.my_member_id());
create policy invite_admin on public.member_invites for select to authenticated using(public.is_admin());

create view public.visible_book_polls as
 select p.id,p.metadata,p.created_at,p.closed_at,
 (select count(*) from public.club_members where active) as participants,
 (select count(*) from public.book_votes v where v.poll_id=p.id and v.choice='yes' and public.active_member(v.member_id)) as yes_votes,
 (select count(*) from public.book_votes v where v.poll_id=p.id and v.choice='later' and public.active_member(v.member_id)) as later_votes,
 (select count(*) from public.book_votes v where v.poll_id=p.id and v.choice='no' and public.active_member(v.member_id)) as no_votes,
 (select choice from public.book_votes v where v.poll_id=p.id and v.member_id=public.my_member_id()) as my_choice
 from public.book_polls p where public.my_member_id() is not null;
create view public.visible_member_invites as
 select id,created_at,expires_at,max_uses,uses,revoked from public.member_invites where public.is_admin();
revoke all on public.visible_book_polls,public.visible_member_invites from public,anon,authenticated;
grant select on public.visible_book_polls,public.visible_member_invites to authenticated;
create view public.visible_club_members as
 select m.id,m.role,m.active,p.name,p.username,p.avatar_url from public.club_members m
 left join public.member_profiles p on p.member_id=m.id where public.is_admin();
revoke all on public.visible_club_members from public,anon,authenticated;
grant select on public.visible_club_members to authenticated;

alter function public.club_action(text,jsonb) rename to club_action_v1;
revoke all on function public.club_action_v1(text,jsonb) from public,anon,authenticated;
create function public.club_action(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.my_member_id(); result jsonb; target public.club_members;
 proposal public.book_proposals; poll public.book_polls; invite_id uuid;
begin
 if actor is null then raise exception 'Нет доступа к клубу' using errcode='42501'; end if;
 if p_action like 'admin.%' and not public.is_admin() then raise exception 'Требуется администратор' using errcode='42501'; end if;
 if p_action='poll.vote' then
  select * into poll from public.book_polls where id=(p_data->>'id')::uuid for update;
  if poll.id is null or poll.closed_at is not null then raise exception 'Голосование завершено или недоступно'; end if;
  if p_data->>'choice' is null then delete from public.book_votes where poll_id=poll.id and member_id=actor;
  else
   insert into public.book_votes(poll_id,member_id,choice) values(poll.id,actor,p_data->>'choice')
   on conflict(poll_id,member_id) do update set choice=excluded.choice,updated_at=now();
  end if;
  return jsonb_build_object('ok',true);
 elsif p_action='admin.close_poll' then
  update public.book_polls set closed_at=coalesce(closed_at,now()) where id=(p_data->>'id')::uuid;
  return jsonb_build_object('ok',true);
 elsif p_action='admin.create_invite' then
  invite_id:=(p_data->>'id')::uuid;
  insert into public.member_invites(id,token_hash,created_by,max_uses)
  values(invite_id,p_data->>'token_hash',actor,coalesce((p_data->>'max_uses')::integer,1));
  return jsonb_build_object('id',invite_id,'expires_at',(select expires_at from public.member_invites where id=invite_id));
 elsif p_action='admin.revoke_invite' then
  update public.member_invites set revoked=true where id=(p_data->>'id')::uuid;
  return jsonb_build_object('ok',true);
 elsif p_action='admin.member' then
  perform pg_advisory_xact_lock(2147483000);
  select * into target from public.club_members where id=(p_data->>'id')::uuid for update;
  if target.id is null then raise exception 'Участник не найден'; end if;
  if target.id=actor or target.role='admin' then raise exception 'Нельзя удалить администратора'; end if;
  if (p_data->>'active')::boolean is null then raise exception 'Укажите состояние доступа'; end if;
  if (p_data->>'active')::boolean and not target.active and (select count(*) from public.club_members where active)>=20 then raise exception 'Лимит клуба: 20 участников'; end if;
  update public.club_members set active=(p_data->>'active')::boolean where id=target.id;
  return jsonb_build_object('ok',true);
 end if;
 result:=public.club_action_v1(p_action,p_data);
 if p_action='proposal' and p_data->>'status'='pending' then
  select * into proposal from public.book_proposals where id=(p_data->>'id')::uuid and member_id=actor and status='pending';
  if proposal.id is not null then
   insert into public.book_polls(id,metadata,created_by) values(proposal.id,proposal.metadata,actor)
   on conflict(id) do update set metadata=excluded.metadata;
  end if;
 elsif p_action='admin.proposal' then
  update public.book_polls set closed_at=coalesce(closed_at,now()) where id=(p_data->>'id')::uuid;
 end if;
 return result;
end $$;
revoke all on function public.club_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.club_action(text,jsonb) to authenticated;

-- Only the auth function can redeem a bearer invitation after verifying Telegram initData.
create function public.redeem_member_invite(p_hash text,p_telegram_id bigint) returns void
language plpgsql security definer set search_path='' as $$
declare invitation public.member_invites; member public.club_members;
begin
 if p_telegram_id is null or p_telegram_id<=0 then raise exception 'Неверный Telegram ID'; end if;
 perform pg_advisory_xact_lock(2147483000);
 select * into member from public.club_members where telegram_id=p_telegram_id;
 if member.id is not null then
  if member.active then return; end if;
  raise exception 'Доступ закрыт. Попросите администратора восстановить участие';
 end if;
 select * into invitation from public.member_invites where token_hash=p_hash for update;
 if invitation.id is null or invitation.revoked or invitation.expires_at<=now() or invitation.uses>=invitation.max_uses then raise exception 'Приглашение недействительно или уже использовано'; end if;
 if (select count(*) from public.club_members where active)>=20 then raise exception 'Лимит клуба: 20 участников'; end if;
 insert into public.club_members(telegram_id,role) values(p_telegram_id,'member');
 update public.member_invites set uses=uses+1 where id=invitation.id;
end $$;
revoke all on function public.redeem_member_invite(text,bigint) from public,anon,authenticated;
grant execute on function public.redeem_member_invite(text,bigint) to service_role;
commit;
