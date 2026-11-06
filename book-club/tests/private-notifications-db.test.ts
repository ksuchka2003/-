// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
let db: PGlite;
const admin = '10000000-0000-4000-8000-000000000001',
  member = '10000000-0000-4000-8000-000000000002',
  inactive = '10000000-0000-4000-8000-000000000003',
  book = '20000000-0000-4000-8000-000000000001',
  next = '20000000-0000-4000-8000-000000000002',
  other = '20000000-0000-4000-8000-000000000003',
  meeting = '30000000-0000-4000-8000-000000000001';
const rows = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows;
const actor = async (id: string) =>
  db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
const choose = (id: string, active: boolean) =>
  db.query("select public.club_action('admin.current_book',$1::jsonb)", [
    JSON.stringify({ book_id: id, active }),
  ]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;",
  );
  const files = readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
    if (file === '202611060008_group_notifications.sql') {
      await db.query('insert into auth.users values($1),($2),($3)', [admin, member, inactive]);
      await db.query(
        "insert into public.club_members(id,auth_user_id,telegram_id,role,active) values($1,$1,1,'admin',true),($2,$2,2,'member',true),($3,$3,3,'member',false)",
        [admin, member, inactive],
      );
      await db.query(
        "insert into public.club_books(id,title,status) values($1,'Старая текущая','reading'),($2,'Следующая','planned'),($3,'Ещё одна','planned')",
        [book, next, other],
      );
      await db.query(
        "insert into public.meetings(id,title,starts_at) values($1,'Будущая встреча',now()+interval '3 days')",
        [meeting],
      );
      await db.exec("select public.connect_notification_chat(1,-123,'Старая группа');");
    }
  }
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential('Личный бот и простой выбор книг', () => {
  it('миграция отключает группы и восстанавливает только будущие личные напоминания', async () => {
    expect(await rows('select * from public.notification_chat where active')).toHaveLength(0);
    expect(
      await rows(
        "select * from public.notification_jobs where chat_id is not null and status in ('pending','processing')",
      ),
    ).toHaveLength(0);
    const personal = await rows(
      "select * from public.notification_jobs where member_id is not null and status='pending'",
    );
    expect(personal).toHaveLength(2);
    expect(personal.every((j) => j.kind === '24h')).toBe(true);
    expect(personal.some((j) => j.member_id === inactive)).toBe(false);
  });
  it('группу нельзя повторно подключить даже через сервисный RPC', async () => {
    await db.exec('set role service_role;');
    await expect(
      db.exec("select public.connect_notification_chat(1,-123,'Группа')"),
    ).rejects.toThrow('permission denied');
    await db.exec('reset role;');
  });
  it('участник не может выбирать текущие книги или создавать уведомления напрямую', async () => {
    await actor(member);
    await expect(choose(next, true)).rejects.toThrow('администратор');
    await expect(
      db.query(
        "insert into public.notification_jobs(member_id,meeting_id,meeting_version,kind,run_at) values($1,$2,99,'new',now())",
        [member, meeting],
      ),
    ).rejects.toThrow('permission denied');
    await db.exec('reset role;');
  });
  it('галочка атомарно назначает книгу и создаёт одно личное объявление каждому активному участнику', async () => {
    await actor(admin);
    await choose(next, true);
    await choose(next, true);
    await db.exec('reset role;');
    const notices = await rows(
      "select * from public.notification_jobs where book_id=$1 and kind='selected_book'",
      [next],
    );
    expect(notices).toHaveLength(2);
    expect(notices.every((j) => j.chat_id === null && j.member_id !== inactive)).toBe(true);
    expect(
      await rows("select * from public.club_readings where book_id=$1 and status='active'", [next]),
    ).toHaveLength(1);
    expect((await rows('select status from public.club_books where id=$1', [next]))[0].status).toBe(
      'reading',
    );
  });
  it('поддерживает несколько выбранных книг; снятие галочки отменяет старое объявление и сохраняет историю', async () => {
    await actor(admin);
    await choose(other, true);
    await choose(next, false);
    await choose(next, false);
    await db.exec('reset role;');
    expect(
      (await rows('select status from public.club_books where id=$1', [other]))[0].status,
    ).toBe('reading');
    expect((await rows('select status from public.club_books where id=$1', [next]))[0].status).toBe(
      'planned',
    );
    expect(
      await rows("select * from public.notification_jobs where book_id=$1 and status='pending'", [
        next,
      ]),
    ).toHaveLength(0);
    expect(
      await rows("select * from public.club_readings where book_id=$1 and status='cancelled'", [
        next,
      ]),
    ).toHaveLength(1);
    await actor(admin);
    await choose(next, true);
    await db.exec('reset role;');
    expect(
      await rows("select * from public.notification_jobs where book_id=$1 and status='pending'", [
        next,
      ]),
    ).toHaveLength(2);
  });
  it('изменённая встреча получает личные сообщения и напоминания новой версии', async () => {
    await db.query(
      "update public.meetings set starts_at=starts_at+interval '1 day',version=version+1 where id=$1",
      [meeting],
    );
    let notices = await rows(
      "select * from public.notification_jobs where meeting_id=$1 and status='pending'",
      [meeting],
    );
    expect(notices).toHaveLength(4);
    expect(notices.filter((j) => j.kind === 'changed')).toHaveLength(2);
    expect(notices.every((j) => j.chat_id === null && j.meeting_version === 2)).toBe(true);
    await db.query('update public.meetings set cancelled=true,version=version+1 where id=$1', [
      meeting,
    ]);
    notices = await rows(
      "select * from public.notification_jobs where meeting_id=$1 and status='pending'",
      [meeting],
    );
    expect(notices).toHaveLength(2);
    expect(notices.every((j) => j.kind === 'cancelled')).toBe(true);
  });
  it('отзыв доступа снимает задания участника; новые события не включают удалённых', async () => {
    await db.query('update public.club_members set active=false where id=$1', [member]);
    expect(
      await rows("select * from public.notification_jobs where member_id=$1 and status='pending'", [
        member,
      ]),
    ).toHaveLength(0);
    await actor(admin);
    await choose(other, false);
    await choose(other, true);
    await db.exec('reset role;');
    const notices = await rows(
      "select * from public.notification_jobs where book_id=$1 and status='pending'",
      [other],
    );
    expect(notices).toHaveLength(1);
    expect(notices[0].member_id).toBe(admin);
  });
});
