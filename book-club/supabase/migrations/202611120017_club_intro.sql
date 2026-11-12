begin;
insert into public.club_settings(key,value) values ('intro',jsonb_build_object(
 'title','Книжный клуб',
 'text',E'Мы — книжный клуб, который зародился в Санкт-Петербурге. Мы учились на программистов, а теперь собираемся, чтобы обсуждать книги и авторов.\n\nЗдесь рождаются споры, восхищение новыми историями и разговоры о том, кто мы и что нам важно. Читаем, ищем себя, делимся идеями и находим в книгах что-то своё.'
)) on conflict (key) do nothing;

create function public.set_club_intro(p_title text,p_text text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_admin() then raise exception 'Требуется администратор' using errcode='42501'; end if;
 if p_title is null or p_text is null or length(trim(p_title)) not between 1 and 100 or length(trim(p_text)) not between 1 and 4000 then
   raise exception 'Введите заголовок до 100 символов и текст до 4000 символов';
 end if;
 result:=jsonb_build_object('title',trim(p_title),'text',trim(p_text));
 insert into public.club_settings(key,value) values('intro',result) on conflict(key) do update set value=excluded.value;
 return result;
end $$;
revoke all on function public.set_club_intro(text,text) from public,anon;
grant execute on function public.set_club_intro(text,text) to authenticated;
commit;
