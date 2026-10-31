import { endpoint, body, service, checked } from '../_shared/http.ts';
import { validateInitData } from '../_shared/telegram.ts';
Deno.serve(
  endpoint(async (req) => {
    const input = await body(req);
    if (typeof input.initData !== 'string') throw new Error('Нужны initData Telegram');
    const tg = await validateInitData(input.initData, Deno.env.get('TELEGRAM_BOT_TOKEN')!);
    const admin = service();
    const invitation = tg.startParam?.startsWith('join_')
      ? tg.startParam.slice(5)
      : input.inviteToken;
    if (invitation) {
      if (typeof invitation !== 'string' || !/^[a-f0-9]{48}$/.test(invitation))
        throw new Error('Неверное приглашение');
      const hash = [
        ...new Uint8Array(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(invitation)),
        ),
      ]
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');
      checked(await admin.rpc('redeem_member_invite', { p_hash: hash, p_telegram_id: tg.id }));
    }
    const resolution = await admin.rpc('resolve_telegram_member', {
      p_telegram_id: tg.id,
      p_bootstrap_admin: String(tg.id) === Deno.env.get('INITIAL_ADMIN_TELEGRAM_ID')?.trim(),
    });
    if (resolution.error?.message === 'Вы не включены в список участников клуба')
      throw new Error(
        `Вы не включены в список участников клуба. Ваш Telegram ID: ${tg.id}. Передайте его владельцу клуба для настройки доступа.`,
      );
    const member = checked(resolution);
    if (!member?.active) throw new Error('Вы не включены в список участников клуба');
    // GoTrue issues a normal short-lived Supabase JWT. OTP and refresh token stay on the server.
    const link = checked(
      await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: `${member.id}@telegram.bookclub.invalid`,
      }),
    );
    if (!link.user || !link.properties) throw new Error('Не удалось создать учётную запись');
    if (member.auth_user_id && member.auth_user_id !== link.user.id)
      throw new Error('Конфликт учётной записи');
    checked(
      await admin.from('club_members').update({ auth_user_id: link.user.id }).eq('id', member.id),
    );
    const auth = checked(
      await service().auth.verifyOtp({
        type: 'magiclink',
        token_hash: link.properties.hashed_token,
      }),
    );
    if (!auth.session) throw new Error('Не удалось создать сессию');
    const name = [tg.first_name, tg.last_name].filter(Boolean).join(' ').slice(0, 200);
    checked(
      await admin.from('member_profiles').upsert(
        {
          member_id: member.id,
          name,
          username: tg.username || null,
          avatar_url: tg.photo_url?.startsWith('https://') ? tg.photo_url : null,
          joined_at: member.joined_at,
        },
        { onConflict: 'member_id', ignoreDuplicates: true },
      ),
    );
    checked(
      await admin
        .from('member_privacy_settings')
        .upsert({ member_id: member.id }, { onConflict: 'member_id', ignoreDuplicates: true }),
    );
    checked(
      await admin
        .from('member_profiles')
        .update({
          username: tg.username || null,
          avatar_url: tg.photo_url?.startsWith('https://') ? tg.photo_url : null,
        })
        .eq('member_id', member.id),
    );
    return {
      access_token: auth.session.access_token,
      expires_at: auth.session.expires_at,
      member: { id: member.id, role: member.role, telegramId: String(tg.id) },
    };
  }),
);
