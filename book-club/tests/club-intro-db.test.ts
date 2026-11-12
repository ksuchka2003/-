// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, it, expect } from 'vitest';
let db: PGlite;
const admin = '10000000-0000-4000-8000-000000000001',
  member = '10000000-0000-4000-8000-000000000002';
const actor = async (id: string) =>
  db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}'`);
const save = (title: unknown, text: unknown) =>
  db.query('select public.set_club_intro($1,$2) as value', [title, text]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  await db.exec(readFileSync('supabase/migrations/202610250001_club.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202611120017_club_intro.sql', 'utf8'));
  for (const [id, role, tg] of [
    [admin, 'admin', 1],
    [member, 'member', 2],
  ]) {
    await db.query('insert into auth.users values($1)', [id]);
    await db.query(
      'insert into public.club_members(id,auth_user_id,telegram_id,role) values($1,$1,$2,$3)',
      [id, tg, role],
    );
  }
}, 30000);
afterAll(async () => db?.close());
it('участник читает вступление, но не может изменить его ни через функцию, ни напрямую', async () => {
  await actor(member);
  expect(
    (await db.query("select value from public.club_settings where key='intro'")).rows,
  ).toHaveLength(1);
  await expect(save('Подмена', 'Чужой текст')).rejects.toThrow('администратор');
  await expect(
    db.exec("update public.club_settings set value='{}' where key='intro'"),
  ).rejects.toThrow();
});
it('администратор сохраняет русские буквы и абзацы; некорректный текст не портит сохранённый', async () => {
  await actor(admin);
  const value = { title: 'Наши истории', text: 'Первый абзац.\n\nВторой абзац — со смыслом.' };
  expect((await save(value.title, value.text)).rows[0]).toEqual({ value });
  await expect(save('', 'Текст')).rejects.toThrow();
  await expect(save('Название', 'я'.repeat(4001))).rejects.toThrow();
  await expect(save(null, 'Текст')).rejects.toThrow();
  expect(
    (await db.query("select value from public.club_settings where key='intro'")).rows[0],
  ).toEqual({ value });
});
it('посторонний и отключённый администратор не получают доступ', async () => {
  await actor('10000000-0000-4000-8000-000000000099');
  expect((await db.query('select * from public.club_settings')).rows).toHaveLength(0);
  await expect(save('Подмена', 'Текст')).rejects.toThrow();
  await db.exec(`reset role;update public.club_members set active=false where id='${admin}'`);
  await actor(admin);
  await expect(save('Подмена', 'Текст')).rejects.toThrow();
});
