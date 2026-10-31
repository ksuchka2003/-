# Настройка и развёртывание

Инструкция для первоначального развёртывания владельцем проекта. Для обновления существующей установки используйте UPDATE.md; повторно запускать исходную миграцию не нужно.

## Supabase Free

1. Создайте проект на бесплатном тарифе Supabase. Сохраните пароль БД в менеджере паролей.
2. В Authentication → Providers отключите публичную регистрацию и ненужные провайдеры. Email-провайдер нужен для внутреннего обмена серверного одноразового токена; реальные письма приложение не отправляет. В Auth Settings задайте JWT expiry **600 секунд**. Конфигурация `supabase/config.toml` применяется локальным CLI и не заменяет ручную проверку настроек Hosted Dashboard.
3. В новом проекте последовательно примените через SQL Editor `supabase/migrations/202610250001_club.sql`, затем `supabase/migrations/202610250002_private_library.sql`. Для существующего клуба с миграцией 001 примените только 002 — см. [UPDATE.md](UPDATE.md). Альтернатива с установленным Supabase CLI:

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Перед применением к существующему проекту проверьте имена таблиц и резервную копию. Миграция рассчитана на отдельный новый проект, выполняется один раз. Не вставляйте этот SQL поверх чужой схемы без адаптации.

4. Скопируйте URL проекта и legacy public anon key из API Settings. Не используйте service_role в frontend. Если Dashboard показывает новые publishable/secret keys, для этой конфигурации используйте совместимый legacy anon key — команды и секрет `SUPABASE_ANON_KEY` рассчитаны на него.
5. Создайте локальный `.env` из корневого `.env.example`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
VITE_BASE_PATH=./
```

Это обозначения мест для ваших значений. Реальных ключей в репозитории нет. Перезапустите Vite после изменения env.

6. В Edge Functions → Secrets добавьте:

| Секрет                      | Значение                                                        |
| --------------------------- | --------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`        | Токен вашего бота из BotFather                                  |
| `INITIAL_ADMIN_TELEGRAM_ID` | Числовой Telegram ID владельца клуба                            |
| `ALLOWED_ORIGINS`           | Разрешённые origins через запятую, без путей и завершающего `/` |
| `CRON_SECRET`               | Случайная строка минимум 32 байта из менеджера паролей          |

Для Pages origin: `https://YOUR_LOGIN.github.io`. Путь репозитория не входит в origin. Для локальной разработки отдельно разрешите `http://localhost:5173,http://127.0.0.1:5173`.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` доступны Edge Functions как встроенные переменные среды. Секреты не передавайте в чат, не коммитьте и не кладите в GitHub Variables с префиксом VITE.

7. Разверните функции:

```sh
npx supabase functions deploy telegram-auth
npx supabase functions deploy club-api
npx supabase functions deploy notifications
```

`verify_jwt=false` задан в config намеренно: `telegram-auth` проверяет HMAC, `club-api` проверяет настоящий access JWT через Auth `getUser`, `notifications` проверяет отдельный CRON_SECRET. Нельзя удалять эти проверки, полагаясь только на настройку gateway.

8. При авторизации аккаунт с Telegram ID из серверного секрета `INITIAL_ADMIN_TELEGRAM_ID` получает роль администратора, даже если раньше уже входил как member. Закройте и заново откройте Mini App. В **Профиль → Управление клубом** откроется панель; дополнительно есть шестерёнка сверху. В профиле видны проверенный Telegram ID и роль. Отдельного пароля нет. В панели управления добавьте Telegram ID остальных участников. Приглашение не отправляет личное сообщение: передайте участнику ссылку на бота самостоятельно. Лимит активных записей — 20, включая администратора.

## Telegram и BotFather

1. Откройте официального [@BotFather](https://t.me/BotFather), выполните `/newbot`, укажите имя и username.
2. Сохраните выданный Bot Token только в Supabase Edge Secrets.
3. Определите собственный числовой Telegram ID. Например, временно получите свой личный `/start` через Bot API `getUpdates` на своей машине и посмотрите `message.from.id`. Не используйте username вместо ID; не сохраняйте ответ с токеном в репозиторий. Если у бота уже есть webhook, `getUpdates` не используется одновременно с ним.
4. После публикации frontend настройте меню: `/setmenubutton` → ваш бот → подпись «Книжный клуб» → HTTPS-адрес GitHub Pages. Через `/mybots` → Bot Settings → Configure Mini App настройте Main Mini App, если нужен запуск по прямой ссылке `https://t.me/YOUR_BOT?startapp`.
5. Администратор и каждый участник должны открыть чат с ботом и нажать `/start`. Это даёт боту возможность писать в личный чат. Backend не нуждается в webhook или постоянно работающем polling-процессе: авторизация идёт через Mini App, напоминания отправляет worker.
6. Откройте Mini App из настроенной кнопки. Обычная вкладка с URL Pages не содержит подписанных initData и не даёт доступ к клубу.

Вход под администратором не имитируется параметрами URL или localStorage. Для проверки настоящей авторизации нужен запуск внутри Telegram с настроенным ботом. Рекомендуется отдельный тестовый бот и Supabase-проект.

## GitHub Pages

1. Создайте репозиторий и загрузите содержимое каталога `book-club` **в корень репозитория**, включая скрытую папку `.github`, `.env.example` и `package-lock.json`. `node_modules`, `.env`, тестовые отчёты и локальные браузеры загружать не нужно.
2. Для бесплатного GitHub Pages на личном бесплатном аккаунте используйте публичный репозиторий. Публичный исходный код не открывает данные клуба — доступ ограничен RLS и серверной авторизацией.
3. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
4. Settings → Secrets and variables → Actions → **Variables** создайте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` (только публичный anon key).
5. Обычный push запускает только проверки. Для публикации вручную запустите workflow **«Публикация GitHub Pages (вручную)»** через Actions → Run workflow. В этой разработке workflow не запускался.
6. Workflow соберёт приложение с `/имя-репозитория/` как base. Для специального репозитория `YOUR_LOGIN.github.io` измените `VITE_BASE_PATH` в workflow на `/`.
7. Используйте адрес из результата Pages, например `https://YOUR_LOGIN.github.io/book-club/`. Приложение использует HashRouter: ссылки вида `/#/books` работают без серверных rewrite-правил.
8. Добавьте origin Pages в `ALLOWED_ORIGINS` и задайте этот HTTPS URL в BotFather.

GitHub Pages обслуживает только `dist`. Edge Functions и секреты туда не попадают. Для другого имени/папки репозитория проверьте base path и отсутствие 404 на JS/CSS после сборки.

## Напоминания и Cron

1. В Supabase Dashboard включите Cron (`pg_cron`) и `pg_net` в Integrations/Extensions. Если Dashboard не даёт включить их в вашем проекте/регионе, расписание не считается настроенным; уведомления можно вручную вызывать через защищённую функцию. Бесплатной альтернативой является scheduled GitHub Actions с тем же секретом, но у него возможны задержки и отключение при неактивности; в проекте основное расписание — Supabase Cron.
2. В Vault создайте секреты через Dashboard:
   - `bookclub_project_url`: URL Supabase-проекта;
   - `bookclub_cron_secret`: **то же значение**, что `CRON_SECRET` у Edge Function;
   - `bookclub_anon_key`: public anon key.
3. Выполните `supabase/schedule.sql`. Повторная настройка с тем же именем Cron обновляет существующее задание.
4. Создайте тестовую встречу через админ-панель. В `notification_jobs` должны появиться задания `new`, `24h`, `1h` для каждого активного участника. Если до встречи меньше 24 часов, прошедшее напоминание не создаётся.
5. Проверьте Cron job history, Edge logs и статусы заданий в админ-панели. Отсутствие `/start`, блокировка бота или неверный токен не дают успешной доставки. Не вставляйте Bot Token в логи.

Worker обрабатывает максимум 5 заданий за запуск, до 6 попыток на задание; это уменьшает риск превышения времени работы бесплатной функции. Для 20 человек всплеск может обрабатываться несколько минут. Рекомендуемое расписание — раз в минуту. Время в форме — локальное для устройства, в уведомлении явно указано МСК.

Если процесс оборвался на последней попытке, после истечения пятиминутного lease следующее получение заданий переводит его в `failed`. Администратор может повторить неудачные отправки через панель. Не изменяйте свежие lease вручную, иначе возможны параллельные отправки.

## Перед приглашением клуба

На тестовом проекте проверьте два настоящих Telegram-аккаунта: администратор и member. Убедитесь, что посторонний ID не входит; member не может выполнить административную операцию; выключение разрешения скрывает публикации при чтении вторым аккаунтом; приватные заметки попадают только в owner-only хранилище и недоступны другому участнику/администратору через клиент; встреча приходит после `/start`; публичная операция с выключенной сетью остаётся в очереди. Откройте один аккаунт на двух устройствах: проверьте профиль, книги, заметки, цитаты, прогресс, удаление, офлайн и выбор конфликтующей версии. Создайте JSON-резервную копию и восстановите её в отдельной тестовой библиотеке.

В рамках локальной разработки реальные Bot API, Hosted Supabase Auth и доставка сообщений не проверялись — для этого необходимы ваши ресурсы и секреты.

## Ограничения и источники

- [GitHub Pages: статический хостинг](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [лимиты](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
- [Supabase Free: приостановка проектов](https://supabase.com/docs/guides/platform/free-project-pausing). Маленькая активность клуба не гарантирует исключение из паузы. Не пытайтесь считать Cron гарантией круглосуточной работы.
- [Supabase Cron](https://supabase.com/docs/guides/cron), [планирование Edge Functions и Vault](https://supabase.com/docs/guides/functions/schedule-functions).
- [Telegram: проверка initData](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app), [Bot API](https://core.telegram.org/bots/api).
- [Supabase Auth generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

Тарифы и интерфейсы Dashboard могут меняться. Эта архитектура не требует платной функции, но не обещает SLA бесплатных сервисов.
