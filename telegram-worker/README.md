# Telegram bot webhook

Бесплатный Cloudflare Worker для `@pixel_dungeon_gamebot`. На любое сообщение
пользователя в личном чате бот отвечает одной из коротких случайных атмосферных
фраз на английском и кнопкой `Play Telegram Pixel Dungeon`, открывающей Mini App:

<https://t.me/pixel_dungeon_gamebot/pixel_dungeon>

Группы, каналы и сообщения других ботов игнорируются. Язык Telegram намеренно не
учитывается: ответ и кнопка всегда остаются английскими.

## Требования

- бесплатный аккаунт [Cloudflare](https://dash.cloudflare.com/);
- Node.js 22+;
- токен бота от BotFather;
- случайный секрет webhook длиной до 256 символов из `A-Z`, `a-z`, `0-9`, `_`
  и `-`.

## Проверка

```powershell
cd telegram-worker
npm test
```

Тесты не обращаются к Telegram и не требуют настоящих секретов.

## Развёртывание

1. Авторизуй Wrangler:

   ```powershell
   npx wrangler@latest login
   ```

2. Сохрани секреты в Cloudflare. Значения вводятся интерактивно и не попадают
   ни в репозиторий, ни в историю команд:

   ```powershell
   npx wrangler@latest secret put BOT_TOKEN
   npx wrangler@latest secret put WEBHOOK_SECRET
   ```

3. Разверни Worker:

   ```powershell
   npm run deploy
   ```

   Wrangler выведет адрес наподобие
   `https://telegram-pixel-dungeon-gamebot.<account>.workers.dev`.

4. В текущем окне PowerShell временно задай те же значения и адрес Worker.
   Не вставляй токен в команду, скриншоты, чат или файлы проекта:

   ```powershell
   $env:BOT_TOKEN = Read-Host "Bot token"
   $env:WEBHOOK_SECRET = Read-Host "Webhook secret"
   $env:WEBHOOK_URL = Read-Host "Worker URL"
   npm run register-webhook
   Remove-Item Env:BOT_TOKEN, Env:WEBHOOK_SECRET, Env:WEBHOOK_URL
   ```

   Скрипт сам:

   - задаёт публичное имя бота `Telegram Pixel Dungeon`;
   - обновляет английские Description и About;
   - устанавливает кнопку меню `Play Telegram Pixel Dungeon`;
   - добавляет путь `/webhook`, передаёт `secret_token` Telegram и разрешает
     только обновления типа `message`.

   Заголовок самого Mini App хранится отдельно. Один раз открой
   **@BotFather → /mybots → Bot Settings → Configure Mini App**, выбери
   приложение `pixel_dungeon` и установи Title: `Telegram Pixel Dungeon`.

5. Проверка доступности не требует секрета:

   ```text
   GET https://telegram-pixel-dungeon-gamebot.<account>.workers.dev/health
   ```

   Ожидаемый ответ: `{"ok":true,"service":"telegram-pixel-dungeon-gamebot"}`.

## Безопасность

- `BOT_TOKEN` и `WEBHOOK_SECRET` существуют только как Cloudflare secrets и
  временные переменные окружения при регистрации webhook.
- Worker проверяет заголовок `X-Telegram-Bot-Api-Secret-Token` до чтения
  входящего JSON.
- Код не записывает в логи сообщения, токен, секрет и ответы Telegram.
- `.dev.vars`, `.env`, локальное состояние Wrangler и `node_modules` исключены
  из Git.
- Если токен когда-либо попал в скриншот, файл или чат, немедленно отзови его
  через BotFather и создай новый.
