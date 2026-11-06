begin;
alter function public.club_action(text,jsonb) rename to club_action_v8;
revoke all on function public.club_action_v8(text,jsonb) from public,anon,authenticated;
create function public.club_action(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare selected uuid; target public.club_books; desired boolean; today date:=(now() at time zone 'Europe/Moscow')::date;
begin
 if p_action='admin.current_book' then
  if not public.is_admin() then raise exception 'Требуется администратор'; end if;
  selected:=(p_data->>'book_id')::uuid;
  if jsonb_typeof(p_data->'active') is distinct from 'boolean' then raise exception 'Укажите, читаем ли книгу сейчас'; end if;
  desired:=(p_data->>'active')::boolean;
  select * into target from public.club_books where id=selected for update;
  if target.id is null then raise exception 'Книга не найдена'; end if;
  if desired then
   update public.club_books set status='reading' where id=selected and status<>'reading';
   insert into public.club_readings(book_id,starts_on,position)
   select selected,today,coalesce((select max(position)+1 from public.club_readings where status='active'),0)
   where not exists(select 1 from public.club_readings where book_id=selected and status='active')
   on conflict do nothing;
  else
   update public.club_readings set status='cancelled' where book_id=selected and status='active';
   update public.club_books set status='planned' where id=selected and status='reading';
  end if;
  return jsonb_build_object('ok',true);
 end if;
 return public.club_action_v8(p_action,p_data);
end $$;
revoke all on function public.club_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.club_action(text,jsonb) to authenticated;
commit;
