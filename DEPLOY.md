# Как выложить игру

Игра состоит из двух частей:

- **клиент** — статический сайт, его отдаёт GitHub Pages этого репозитория
  (`https://shiba-vibecoding.github.io/pixel-dungeon-telegram/`, тот же адрес,
  что был у Java-версии: бот открывает новую игру без перенастройки);
- **сервер** — Cloudflare Worker `pd-coop` с Durable Objects: комнаты
  кооператива, рекорды «Подземелья дня», кошельки Пиксель-Марта и вебхук бота
  (оплата звёздами, `/start`, `/paysupport`, `/terms`).

Обе части бесплатны (у Cloudflare 100 000 запросов к Durable Objects в сутки).
Одиночная игра работает и без сервера.

Команды ниже — для PowerShell, из папки `C:\pixel_dungeon\pd-ts`. Токен бота
и секреты вводятся только в консоли и никуда не пишутся.

## 1. Сервер (Cloudflare)

1. Войдите в Cloudflare (откроется браузер):

   ```powershell
   npx wrangler login
   ```

2. Выложите сервер:

   ```powershell
   npm run deploy:server
   ```

   Wrangler напечатает адрес вида `https://pd-coop.<поддомен>.workers.dev`.
   В браузере по нему должно быть написано `Pixel Dungeon co-op server`.

3. Секреты сервера. Токен — тот же, что у бота (@BotFather → `/mybots` → бот →
   API Token). Секрет вебхука — случайная строка до 256 символов из `A-Z a-z 0-9 _ -`
   (не из примеров), он нужен ещё в шаге 2. Сгенерировать:
   `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.

   ```powershell
   npx wrangler secret put BOT_TOKEN --config packages/server/wrangler.jsonc
   npx wrangler secret put WEBHOOK_SECRET --config packages/server/wrangler.jsonc
   npx wrangler secret put DAILY_SECRET --config packages/server/wrangler.jsonc   # любая длинная случайная строка: из неё сервер выводит секретное зерно ежедневного подземелья
   ```

4. Поддержка и возвраты. Узнайте свой Telegram ID (например, у @userinfobot) и
   впишите его в `packages/server/wrangler.jsonc` в `vars`:
   `"ADMIN_CHAT_ID": "123456789"` (можно и id группы, он начинается с `-`).
   Это не секрет, но без него сообщения игроков после `/paysupport` никуда не
   уходят: бот лишь советует написать @barboskich. С ним бот пересылает вам
   каждое такое сообщение вместе с ID игрока, @username и номерами его последних
   платежей, а в этом чате (и только в нём) работают команды:
   - `/payments <user_id>` — платежи игрока, новые сверху;
   - `/refund <user_id> <charge_id>` — вернуть звёзды (Bot API `refundStarPayment`)
     и забрать покупку из кошелька;
   - `/reply <user_id> <текст>` — ответить игроку от имени бота.

   `TERMS_URL` в том же `vars` — адрес страницы условий (`terms.html` клиента),
   на неё ссылается `/terms`. После правки `vars` выложите сервер заново.

Сервер сам удаляет комнаты, в которых 30 дней никто не играл, и таблицы
«Подземелья дня» через 60 дней после их дня. Журналы вызовов Cloudflare
(invocation logs) выключены в `wrangler.jsonc`: в адресе WebSocket комнаты
передаются данные входа Telegram, и записывать их нельзя.

## 2. Вебхук бота

У бота один вебхук. Сейчас его принимает Worker Java-версии
(`telegram-pixel-dungeon-gamebot`). Переводим на новый сервер: он умеет то же
(отвечает кнопкой «Играть») плюс оплату и команды.

```powershell
node packages/server/scripts/set-webhook.mjs https://pd-coop.<поддомен>.workers.dev --new-secret
```

С `--new-secret` скрипт сам придумает секрет вебхука и запишет его на сервер
(`npx wrangler secret put WEBHOOK_SECRET` тогда не нужен). Без флага он спросит
секрет, заданный вручную. Токен бота спрашивается скрыто. В конце скрипт стучится
на сервер с секретом и пишет `Check: the server accepts this secret`, если всё
сходится. Он напишет также `Webhook: https://pd-coop…/telegram/webhook`. Проверка: напишите
боту что угодно — он ответит фразой и кнопкой «Играть». Старый Worker после
этого можно удалить в панели Cloudflare.

## 3. Клиент (GitHub Pages)

1. На GitHub: **Settings → Secrets and variables → Actions → Variables** —
   добавьте три переменные:
   - `PD_SERVER_URL` = `wss://pd-coop.<поддомен>.workers.dev`
   - `PD_TG_APP_LINK` = `https://t.me/pixel_dungeon_gamebot/pixel_dungeon`
   - `PD_PUBLISH` = `true` — без неё сборка только тестирует и ничего не выкладывает.
2. **Settings → Pages → Source** должен стоять на **GitHub Actions** (так было и
   для Java-версии).
3. **Actions → CI and deploy → Run workflow** (ветка `main`). Через пару минут
   по адресу GitHub Pages откроется новая игра — и в боте тоже.

Сохранения Java-версии в новую не переносятся: формат другой. Сама Java-версия
лежит в ветке `java-gwt`; вернуть её — запустить там старую сборку.

Если добавить секреты `CLOUDFLARE_API_TOKEN` (право «Edit Cloudflare Workers») и
`CLOUDFLARE_ACCOUNT_ID`, сервер будет обновляться сам при каждом push в `main`.

## 4. Telegram

- Картинка мини-приложения 640×360: `docs/design/bot-cover-640x360.png`
  (@BotFather → `/myapps` → приложение → Edit Photo). Перерисовать:
  `python packages/client/scripts/bot-cover.py "Другая подпись"`.
- Политика конфиденциальности: `https://shiba-vibecoding.github.io/pixel-dungeon-telegram/privacy.html`
  (@BotFather → бот → Bot Settings → Privacy Policy).
- Условия использования: `https://shiba-vibecoding.github.io/pixel-dungeon-telegram/terms.html`
  (@BotFather → бот → Bot Settings → Terms of Service, если такой пункт есть; иначе
  достаточно команды `/terms`, которая на них ссылается). Обе страницы лежат в
  `packages/client/public/` и выкладываются вместе с клиентом.
- Команды бота (@BotFather → `/setcommands`): `start`, `paysupport`, `terms`.
- Оплата звёздами в Telegram отдельно не включается: звёзды работают у любого бота.
  Вывод заработанных звёзд — @BotFather → бот → Balance (через Fragment, в TON).

Приглашения: «Играть с друзьями» отправляет ссылку
`https://t.me/pixel_dungeon_gamebot/pixel_dungeon?startapp=room_<код>`.

## Обновление Shattered: мир с чистого листа

Обновление обнуляет мир: идущие забеги, все доски (дня, недели, за всё время), рекорды, историю, серии и
заморозки, значки и кубки. Остаётся только кубок «Первопроходец» (письмо в почте) у всех, кто играл до
обновления. Имя, облик, язык, согласие на напоминания, пройденное обучение и «Что нового» не трогаются.
Ничего не удаляется руками:

- доски лежат в Durable Objects с именем `s2:<доска>` (`SEASON` в `packages/server/src/boards.ts`), старые
  объекты просто больше никто не читает; при следующем сбросе мира поднимите `SEASON` и версию правил;
- профиль игрока сбрасывается при первом обращении после выкладки, если он записан в прошлом сезоне
  (`Profile.season`, `packages/server/src/season.ts`). **Это необратимо**: старый профиль в его объекте
  перезаписывается. Если нужна копия, снимите её до выкладки (как — в чек-листе релиза, «еженедельная копия»);
- клиент при первом запуске чистит локальные сохранения, значки и рейтинг (`packages/client/src/season.ts`),
  а в Telegram ещё и копии значков и рейтинга в облаке; настройки остаются;
- формат сохранений и правила поднимены (`RULES_VERSION` 18, `SAVE_VERSION`/`STATE_FORMAT`/`RUN_FORMAT` 32):
  старые клиенты получают «обновите игру», старые забеги и комнаты тихо отбрасываются.

Порядок выкладки:

1. За неделю: объявить сброс в канале и в игре, по-русски и по-английски (чек-лист в `docs/SHATTERED.md`).
2. Снять копию досок и профилей (если нужна).
3. Задать момент релиза в `packages/server/wrangler.jsonc`, в `vars`: `"RELEASE_AT": "2026-10-27T09:00:00Z"`
   (ISO, UTC; ставьте момент самой выкладки). Больше в коде менять нечего. Пустое значение допустимо: сброс и
   кубок «Первопроходец» от него не зависят, он лишь добавляет кубок тем, кто завёл профиль после выкладки, но до
   этого момента. Закоммитьте это **до** слияния в `main`: пуш в `main` выкладывает сервер сам, если заданы
   секреты Cloudflare.
4. Секрет ежедневного подземелья, один раз и до выкладки (сам секрет в репозиторий не пишется; без него сервер
   берёт публичное значение для разработки и пишет об этом в журнал). Менять его среди дня нельзя:

   ```powershell
   npx wrangler secret put DAILY_SECRET --config packages/server/wrangler.jsonc
   ```

   Это любая длинная случайная строка, например
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
5. Сервер: `npm run deploy:server` (или пуш в `main` с секретами Cloudflare). Сервер выкладывается **первым**:
   клиенты прежней версии сразу получают «обновите игру» вместо молчаливой порчи забега.
6. Клиент: пуш в `main` при `PD_PUBLISH=true` (или Actions → CI and deploy → Run workflow).
7. Проверка: откройте игру со старым профилем: «Что нового» говорит про чистый лист, в почте письмо
   «Первопроходец», доски пусты, серия 0; новый профиль письма не получает.

## Проверка после выкладки

- Бот отвечает на сообщение кнопкой «Играть», команды `/paysupport` и `/terms` работают.
- В игре: «Играть с друзьями» — друг заходит по ссылке, вы видите друг друга.
- «Подземелье дня» → конец забега → таблица дня с вашим местом.
- Пиксель-Март → купить облик → Telegram показывает оплату звёздами.
  Проверить можно на самом дешёвом товаре: напишите боту `/paysupport тест` —
  сообщение придёт в чат `ADMIN_CHAT_ID`; там `/payments <ваш id>` покажет платёж,
  а `/refund <ваш id> <charge_id>` вернёт звёзды.

## Запуск на своём компьютере

```powershell
npm install
npm run server   # сервер: ws://127.0.0.1:8787
npm run dev      # клиент: http://127.0.0.1:5173
```

Два игрока в одном браузере: откройте две вкладки
`http://127.0.0.1:5173/?room=test&player=a&name=Алиса` и
`http://127.0.0.1:5173/?room=test&player=b&name=Боб&hero=mage`.
В режиме разработки покупки в Пиксель-Марте проходят без оплаты.
