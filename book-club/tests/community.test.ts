// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
let db: PGlite;
const admin = '10000000-0000-4000-8000-000000000001',
  alice = '10000000-0000-4000-8000-000000000002';
const proposal = '20000000-0000-4000-8000-000000000001';
async function actor(id: string) {
  await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
}
async function action(name: string, data: unknown) {
  return db.query('select public.club_action($1,$2::jsonb)', [name, JSON.stringify(data)]);
}
async function redeem(hash: string, id: number) {
  await db.exec('reset role;set role service_role;');
  return db.query('select public.redeem_member_invite($1,$2)', [hash, id]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;",
  );
  for (const file of [
    '202610250001_club.sql',
    '202610250002_private_library.sql',
    '202610310003_polls_and_invites.sql',
  ])
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  for (const [id, tg, role] of [
    [admin, 1, 'admin'],
    [alice, 2, 'member'],
  ] as const) {
    await db.query('insert into auth.users values($1)', [id]);
    await db.query(
      'insert into public.club_members(id,auth_user_id,telegram_id,role) values($1,$1,$2,$3)',
      [id, tg, role],
    );
    await db.query("insert into public.member_profiles(member_id,name) values($1,'Имя')", [id]);
  }
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential('Голосования и приглашения', () => {
  it('не раскрывает административный список обычному участнику',async()=>{
    await actor(alice);expect((await db.query('select * from public.visible_club_members')).rows).toHaveLength(0);
    await actor(admin);expect((await db.query('select * from public.visible_club_members')).rows).toHaveLength(2);
  });
  it('создаёт общее голосование только для отправленной заявки, скрывает черновик', async () => {
    await actor(alice);
    await action('proposal', {
      id: proposal,
      status: 'draft',
      metadata: { title: 'Солярис', authors: 'Лем', totalPages: 300 },
    });
    expect((await db.query('select * from public.visible_book_polls')).rows).toHaveLength(0);
    await action('proposal', {
      id: proposal,
      status: 'pending',
      metadata: { title: 'Солярис', authors: 'Лем', totalPages: 300 },
    });
    await actor(admin);
    expect((await db.query('select * from public.visible_book_polls')).rows).toHaveLength(1);
  });
  it('один участник имеет один изменяемый голос, другой видит только свой выбор', async () => {
    await actor(alice);
    await action('poll.vote', { id: proposal, choice: 'yes' });
    await action('poll.vote', { id: proposal, choice: 'yes' });
    await action('poll.vote', { id: proposal, choice: 'later' });
    const mine = (await db.query<any>('select * from public.visible_book_polls')).rows[0];
    expect(Number(mine.yes_votes)).toBe(0);
    expect(Number(mine.later_votes)).toBe(1);
    expect(mine.my_choice).toBe('later');
    await actor(admin);
    const other = (await db.query<any>('select * from public.visible_book_polls')).rows[0];
    expect(other.my_choice).toBeNull();
    expect(Number(other.later_votes)).toBe(1);
    await db.exec('reset role;set role anon;');
    await expect(db.query('select * from public.visible_book_polls')).rejects.toThrow();
    await actor('10000000-0000-4000-8000-000000000099');
    expect((await db.query('select * from public.visible_book_polls')).rows).toHaveLength(0);
    await expect(action('poll.vote', { id: proposal, choice: 'yes' })).rejects.toThrow();
  });
  it('не даёт участнику закрыть опрос или обойти новую RPC, закрывает при одобрении', async () => {
    await actor(alice);
    await expect(action('admin.close_poll', { id: proposal })).rejects.toThrow();
    await expect(db.query("select public.club_action_v1('admin.invite','{}')")).rejects.toThrow();
    await actor(admin);
    await action('admin.proposal', {
      id: proposal,
      approve: true,
      metadata: { title: 'Солярис', authors: 'Лем', totalPages: 300 },
    });
    await actor(alice);
    await expect(action('poll.vote', { id: proposal, choice: 'yes' })).rejects.toThrow('завершено');
  });
  it('выдаёт приглашения только администратору и не раскрывает хеши', async () => {
    await actor(alice);
    await expect(
      action('admin.create_invite', { id: proposal, token_hash: 'a'.repeat(64) }),
    ).rejects.toThrow();
    expect((await db.query('select * from public.visible_member_invites')).rows).toHaveLength(0);
    await expect(db.query('select * from public.member_invites')).rejects.toThrow();
    await expect(
      db.query('select public.redeem_member_invite($1,3)', ['a'.repeat(64)]),
    ).rejects.toThrow();
    await actor(admin);
    await action('admin.create_invite', { id: proposal, token_hash: 'a'.repeat(64), max_uses: 1 });
    const invitation = (await db.query<any>('select * from public.visible_member_invites')).rows[0];
    expect(invitation.token_hash).toBeUndefined();
  });
  it('однократная ссылка идемпотентна для того же аккаунта и не пропускает второго', async () => {
    await redeem('a'.repeat(64), 3);
    await redeem('a'.repeat(64), 3);
    await expect(redeem('a'.repeat(64), 4)).rejects.toThrow('использовано');
    await actor(admin);
    expect(
      Number((await db.query<any>('select uses from public.visible_member_invites')).rows[0].uses),
    ).toBe(1);
  });
  it('отозванные/истёкшие ссылки не работают, удалённый участник не может вернуться по ссылке', async () => {
    await actor(admin);
    await action('admin.create_invite', {
      id: '20000000-0000-4000-8000-000000000002',
      token_hash: 'b'.repeat(64),
      max_uses: 19,
    });
    await action('admin.revoke_invite', { id: '20000000-0000-4000-8000-000000000002' });
    await expect(redeem('b'.repeat(64), 4)).rejects.toThrow('недействительно');
    await actor(admin);
    await action('admin.create_invite', {
      id: '20000000-0000-4000-8000-000000000003',
      token_hash: 'c'.repeat(64),
      max_uses: 19,
    });
    await action('admin.member', { id: alice, active: false });
    await expect(redeem('c'.repeat(64), 2)).rejects.toThrow('Доступ закрыт');
    await actor(alice);
    expect((await db.query('select * from public.visible_book_polls')).rows).toHaveLength(0);
    await actor(admin);
    await action('admin.member', { id: alice, active: true });
    await expect(action('admin.member', { id: admin, active: false })).rejects.toThrow();
    await db.exec(
      "reset role;update public.member_invites set expires_at=now()-interval '1 second' where token_hash=repeat('c',64);",
    );
    await expect(redeem('c'.repeat(64), 4)).rejects.toThrow('недействительно');
  });
  it('атомарно ограничивает приглашения двадцатью участниками',async()=>{
    await actor(admin);await action('admin.create_invite',{id:'20000000-0000-4000-8000-000000000004',token_hash:'d'.repeat(64)});
    await db.exec('reset role;insert into public.club_members(telegram_id) select 1000+n from generate_series(1,17) n;');
    await expect(redeem('d'.repeat(64),4)).rejects.toThrow('20 участников');
    await actor(admin);const invite=(await db.query<any>("select uses from public.visible_member_invites where id='20000000-0000-4000-8000-000000000004'")).rows[0];expect(Number(invite.uses)).toBe(0);
  });
});
