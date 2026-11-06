// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
let db: PGlite;
const admin = '10000000-0000-4000-8000-000000000001',
  member = '10000000-0000-4000-8000-000000000002',
  book = '20000000-0000-4000-8000-000000000001',
  reading = '30000000-0000-4000-8000-000000000001',
  meeting = '40000000-0000-4000-8000-000000000001';
const rows = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows;
const connect = (chat = -123) =>
  db.query("select public.connect_notification_chat(1,$1,'Наш клуб')", [chat]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;",
  );
  for (const file of readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql') && f <= '202611060008_group_notifications.sql')
    .sort())
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  await db.query('insert into auth.users values($1),($2)', [admin, member]);
  await db.query(
    "insert into public.club_members(id,auth_user_id,telegram_id,role) values($1,$1,1,'admin'),($2,$2,2,'member')",
    [admin, member],
  );
  await db.query(
    "insert into public.club_books(id,title,authors,status) values($1,'Охота на овец','Харуки Мураками','reading')",
    [book],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential('Групповые уведомления', () => {
  it('до подключения группы не создаёт заданий; участник и anon не могут привязать чат', async () => {
    expect(await rows('select * from public.notification_jobs')).toHaveLength(0);
    await expect(
      db.query("select public.connect_notification_chat(2,-123,'Чужая группа')"),
    ).rejects.toThrow('администратор');
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${member}';`);
    await expect(connect()).rejects.toThrow('permission denied');
    expect(await rows('select * from public.notification_chat')).toHaveLength(0);
    await expect(
      db.exec(
        "insert into public.notification_chat(chat_id,title,connected_by) values(-456,'Подмена','" +
          member +
          "')",
      ),
    ).rejects.toThrow('permission denied');
    await db.exec('reset role;set role anon;');
    await expect(db.query('select * from public.notification_chat')).rejects.toThrow(
      'permission denied',
    );
    await db.exec('reset role;');
  });
  it('подключает группу, объявляет текущую книгу один раз, повтор команды идемпотентен', async () => {
    await connect();
    await connect();
    const jobs = await rows('select * from public.notification_jobs');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      chat_id: -123,
      member_id: null,
      book_id: book,
      kind: 'selected_book',
    });
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${member}';`);
    expect(await rows('select * from public.notification_chat')).toHaveLength(0);
    await db.exec(`set request.jwt.claim.sub='${admin}';`);
    expect(await rows('select * from public.notification_chat')).toHaveLength(1);
    await db.exec('reset role;');
  });
  it('повтор сохранения и назначение главной книги не дублируют объявление', async () => {
    await db.query(
      "update public.club_books set status='reading',title='Охота на овец' where id=$1",
      [book],
    );
    await db.query(
      'insert into public.club_readings(id,book_id,starts_on) values($1,$2,current_date)',
      [reading, book],
    );
    await db.query('update public.club_readings set position=2 where id=$1', [reading]);
    expect(
      await rows("select * from public.notification_jobs where kind='selected_book'"),
    ).toHaveLength(1);
  });
  it('завершение отменяет старое задание, повторное чтение создаёт новую версию', async () => {
    await db.query("update public.club_books set status='finished' where id=$1", [book]);
    expect((await rows('select status from public.notification_jobs'))[0].status).toBe('skipped');
    expect(
      (await rows('select public.book_announcement_current($1,1) as current', [book]))[0].current,
    ).toBe(false);
    await db.query("update public.club_books set status='reading' where id=$1", [book]);
    expect(
      await rows(
        "select * from public.notification_jobs where kind='selected_book' and status='pending'",
      ),
    ).toHaveLength(1);
  });
  it('встреча даёт одно сообщение и напоминание за сутки на группу; перенос отменяет старую версию', async () => {
    await db.query(
      "insert into public.meetings(id,title,starts_at,place) values($1,'Книжный клуб',now()+interval '3 days','Кафе')",
      [meeting],
    );
    let jobs = await rows(
      'select *,extract(epoch from (m.starts_at-j.run_at)) as delta from public.notification_jobs j join public.meetings m on m.id=j.meeting_id where j.meeting_id=$1',
      [meeting],
    );
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.member_id === null && j.chat_id === -123)).toBe(true);
    expect(Number(jobs.find((j) => j.kind === '24h').delta)).toBe(86400);
    await db.query(
      "update public.meetings set starts_at=starts_at+interval '1 day',version=version+1 where id=$1",
      [meeting],
    );
    jobs = await rows('select * from public.notification_jobs where meeting_id=$1', [meeting]);
    expect(jobs.filter((j) => j.status === 'skipped')).toHaveLength(2);
    expect(jobs.filter((j) => j.status === 'pending')).toHaveLength(2);
    await db.query('update public.meetings set cancelled=true,version=version+1 where id=$1', [
      meeting,
    ]);
    jobs = await rows(
      "select * from public.notification_jobs where meeting_id=$1 and status='pending'",
      [meeting],
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe('cancelled');
  });
  it('старые ответы о посещении не принимаются сервером', async () => {
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${member}';`);
    await expect(
      db.query("select public.club_action('attendance',$1::jsonb)", [
        JSON.stringify({ meeting_id: meeting, response: 'yes' }),
      ]),
    ).rejects.toThrow('в чате');
    await db.exec('reset role;');
  });
  it('смена группы отменяет старые задания; преобразование в супергруппу сохраняет очередь', async () => {
    await connect(-456);
    await connect(-456);
    expect(
      await rows("select * from public.notification_jobs where chat_id=-123 and status='pending'"),
    ).toHaveLength(0);
    expect(
      await rows(
        "select * from public.notification_jobs where chat_id=-456 and kind='selected_book' and status='pending'",
      ),
    ).toHaveLength(1);
    await db.exec('select public.migrate_notification_chat(-456,-100456);');
    expect((await rows('select chat_id from public.notification_chat'))[0].chat_id).toBe(-100456);
    expect(
      await rows("select * from public.notification_jobs where chat_id=-456 and status='pending'"),
    ).toHaveLength(0);
    await db.exec("select public.connect_notification_chat(1,-100456,'Наш клуб',false);");
    expect(
      await rows("select * from public.notification_jobs where status='pending'"),
    ).toHaveLength(0);
  });
});
