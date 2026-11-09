begin;
create or replace view public.club_reading_awards with(security_barrier=true) as
 with eligible as(
  select f.*,row_number() over(partition by f.reading_id order by f.completed_at,f.member_id) as first_place,
   row_number() over(partition by f.reading_id order by f.completed_at desc,f.member_id desc) as last_place,
   count(*) over(partition by f.reading_id) as finished_count
  from public.reading_completions f join public.club_readings r on r.id=f.reading_id and r.status='active'
  join public.club_members m on m.id=f.member_id and m.active
  left join public.reading_participation c on c.reading_id=f.reading_id and c.member_id=f.member_id
  where public.my_member_id() is not null and coalesce(c.choice,'reading')='reading'
   and exists(select 1 from public.visible_progress p where p.book_id=f.book_id and p.member_id=f.member_id and p.status='finished')
 ),awards as(
  select book_id,member_id,'first'::text as kind from eligible where first_place=1
  union all select book_id,member_id,'last'::text from eligible e where last_place=1 and finished_count>=2
   and finished_count=(select count(*) from public.reading_participation c join public.club_members m on m.id=c.member_id and m.active where c.reading_id=e.reading_id and c.choice='reading')
 )select book_id::text||':'||member_id::text||':'||kind as id,book_id,member_id,kind from awards;
revoke all on public.club_reading_awards from public,anon,authenticated;grant select on public.club_reading_awards to authenticated;

create view public.club_achievements with(security_barrier=true) as
 with members as(select id from public.club_members where active and public.my_member_id() is not null),
 earned as(
  select m.id as member_id,'quotes_5'::text as code from members m where (select count(*) from public.club_quotes q where q.member_id=m.id)>=5
  union all select m.id,'quotes_20' from members m where (select count(*) from public.club_quotes q where q.member_id=m.id)>=20
  union all select m.id,'thoughts_3' from members m where (select count(*) from public.club_entries e where e.member_id=m.id and e.kind='thought')>=3
  union all select m.id,'notes_5' from members m where (select count(*) from public.club_entries e where e.member_id=m.id and e.kind='note')>=5
  union all select m.id,'popular_quote' from members m where exists(select 1 from public.club_quotes q where q.member_id=m.id and (select count(*) from public.content_reactions v where v.target_kind='quote' and v.target_id=q.id and v.value=1 and public.active_member(v.member_id))>=5)
  union all select m.id,'divisive' from members m where exists(select 1 from public.club_publications p where p.member_id=m.id and (select count(*) from public.content_reactions v where v.target_kind=p.kind and v.target_id=p.id and v.value=1 and public.active_member(v.member_id))>=3 and (select count(*) from public.content_reactions v where v.target_kind=p.kind and v.target_id=p.id and v.value=-1 and public.active_member(v.member_id))>=3)
  union all select m.id,'abandoned_critic' from members m where exists(select 1 from public.club_reviews r join public.visible_progress p on p.member_id=r.member_id and p.book_id=r.book_id where r.member_id=m.id and r.rating<=4 and p.status='abandoned')
  union all select m.id,'stubborn_reader' from members m where exists(select 1 from public.club_reviews r join public.visible_progress p on p.member_id=r.member_id and p.book_id=r.book_id where r.member_id=m.id and r.rating<=4 and p.status='finished')
  union all select m.id,'defender' from members m where exists(select 1 from public.club_reviews r join public.club_book_stats s on s.book_id=r.book_id where r.member_id=m.id and r.rating>=8 and s.rating_count>=3 and s.average_rating<=5)
  union all select m.id,'questions_3' from members m where (select count(*) from public.meeting_questions q where q.member_id=m.id)>=3
  union all select m.id,'reflections_3' from members m where (select count(*) from public.meeting_reflections r where r.member_id=m.id)>=3
  union all select m.id,'proposals_3' from members m where (select count(*) from public.book_proposals p where p.member_id=m.id and p.status='approved')>=3
 ),rules(code,title,description,icon) as(values
  ('quotes_5','Цитатный фонд','Поделился пятью цитатами','quote'),
  ('quotes_20','Ещё одну выпишу — и всё','Поделился двадцатью цитатами','quote'),
  ('thoughts_3','Есть соображения','Опубликовал три законченные мысли','thought'),
  ('notes_5','Пришёл с уликами','Поделился пятью заметками по ходу чтения','note'),
  ('popular_quote','Поставщик прекрасного','Цитата получила пять лайков','heart'),
  ('divisive','Кажется, мы поспорим','Публикация собрала и лайки, и дизлайки','discussion'),
  ('abandoned_critic','Не дочитал, но осуждаю','Бросил книгу и поделился низкой оценкой','book'),
  ('stubborn_reader','Дочитал назло автору','Закончил книгу, которая не понравилась','book'),
  ('defender','А мне понравилось','Защитил оценкой непопулярную в клубе книгу','heart'),
  ('questions_3','Небольшой вопросик','Добавил три вопроса к встречам','discussion'),
  ('reflections_3','Клубный хроникёр','Поделился итогами трёх встреч','note'),
  ('proposals_3','Литературный разведчик','Три предложения приняты в каталог','book')
 ) select e.member_id::text||':'||e.code as id,e.member_id,e.code,r.title,r.description,r.icon from earned e join rules r on r.code=e.code;
revoke all on public.club_achievements from public,anon,authenticated;
grant select on public.club_achievements to authenticated;
commit;
