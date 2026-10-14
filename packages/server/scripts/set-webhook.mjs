// Points the bot's webhook at this server and sets its commands.
//
//   node packages/server/scripts/set-webhook.mjs https://pd-coop.<subdomain>.workers.dev
//   node packages/server/scripts/set-webhook.mjs https://pd-coop.<subdomain>.workers.dev --new-secret
//
// The bot token and the webhook secret are asked for with hidden input (or taken
// from BOT_TOKEN / WEBHOOK_SECRET in the environment), never from the command
// line, so they stay off the screen and out of the shell's history. With
// --new-secret the script makes a random secret itself and stores it in the
// Worker with `wrangler secret put`, so the two sides always hold the same value
// and nobody ever sees it. At the end it knocks on the webhook with the secret to
// prove the server accepts it. Telegram keeps one webhook per bot: this one
// replaces the old version's.

import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      if (text.startsWith(question)) process.stdout.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const args = process.argv.slice(2);
const newSecret = args.includes('--new-secret');
const SERVER_URL = args.find((arg) => !arg.startsWith('--')) ?? process.env.SERVER_URL;
if (!SERVER_URL) {
  console.error('Usage: node packages/server/scripts/set-webhook.mjs https://pd-coop.<subdomain>.workers.dev [--new-secret]');
  process.exit(1);
}
if (process.env.BOT_TOKEN) console.log('Using BOT_TOKEN from the environment.');
if (process.env.WEBHOOK_SECRET && !newSecret) console.log('Using WEBHOOK_SECRET from the environment.');
const BOT_TOKEN = process.env.BOT_TOKEN || (await askHidden('Bot token (hidden): '));
const WEBHOOK_SECRET = newSecret
  ? randomBytes(24).toString('base64url')
  : process.env.WEBHOOK_SECRET || (await askHidden('Webhook secret (hidden): '));
if (!BOT_TOKEN || !WEBHOOK_SECRET) {
  console.error('Both the bot token and the webhook secret are needed.');
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{1,256}$/.test(WEBHOOK_SECRET)) {
  console.error('WEBHOOK_SECRET may hold only A-Z, a-z, 0-9, _ and -, up to 256 characters.');
  process.exit(1);
}

async function call(method, params) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await response.json();
  if (!body.ok) {
    console.error(`${method}: ${body.description}`);
    if (response.status === 401) {
      console.error('Telegram does not accept this bot token: it is mistyped or was revoked in @BotFather.');
      if (process.env.BOT_TOKEN) console.error('It came from $env:BOT_TOKEN; clear it with: Remove-Item Env:BOT_TOKEN');
    }
    process.exit(1);
  }
  return body.result;
}

// Check the token before touching the Worker, so a bad token changes nothing.
const bot = await call('getMe', {});
console.log(`Bot: @${bot.username}`);

if (newSecret) {
  console.log('Storing a new WEBHOOK_SECRET in the Worker...');
  const config = join(dirname(fileURLToPath(import.meta.url)), '..', 'wrangler.jsonc');
  let stored = false;
  for (let attempt = 1; attempt <= 3 && !stored; attempt++) {
    const result = spawnSync('npx', ['wrangler', 'secret', 'put', 'WEBHOOK_SECRET', '--config', `"${config}"`], {
      input: WEBHOOK_SECRET,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: true,
    });
    stored = result.status === 0;
    if (!stored && attempt < 3) console.log('wrangler failed, trying again...');
  }
  if (!stored) {
    console.error('Could not store the secret; nothing else was changed. Run the script again.');
    process.exit(1);
  }
}

const url = `${SERVER_URL.replace(/\/+$/, '')}/telegram/webhook`;
await call('setWebhook', {
  url,
  secret_token: WEBHOOK_SECRET,
  allowed_updates: ['message', 'pre_checkout_query'],
  drop_pending_updates: false,
});
for (const [language, commands] of [
  ['', [['start', 'Play'], ['paysupport', 'Help with a purchase'], ['terms', 'Terms of Pixel-Mart']]],
  ['ru', [['start', 'Играть'], ['paysupport', 'Помощь с покупкой'], ['terms', 'Условия Пиксель-Марта']]],
]) {
  await call('setMyCommands', {
    commands: commands.map(([command, description]) => ({ command, description })),
    ...(language ? { language_code: language } : {}),
  });
}
// What the bot says about itself: the profile's text, the line in the share card and the chat list,
// and the button beside the message field that opens the game.
for (const [language, description, short] of [
  ['', 'Pixel Dungeon, grown into Shattered Pixel Dungeon 4.0.2, right in Telegram. Six classes with talents and subclasses, alchemy, five bosses and every quest across 26 depths. Take on the daily dungeon: the same for everyone, a new challenge every day, one attempt counts. Climb the daily, weekly and all-time boards; every run is checked by the server. Tap «Play».', 'Shattered Pixel Dungeon in Telegram: six classes, a daily dungeon, fair rankings.'],
  ['ru', 'Pixel Dungeon, выросший до Shattered Pixel Dungeon 4.0.2, — прямо в Telegram. Шесть классов с талантами и подклассами, алхимия, пять боссов и все квесты на 26 глубинах. Подземелье дня: одно на всех, каждый день новое испытание, засчитывается одна попытка. Поднимайтесь на досках дня, недели и всех времён — каждый забег проверяет сервер. Нажмите «Играть».', 'Shattered Pixel Dungeon в Telegram: шесть классов, подземелье дня, честный рейтинг.'],
]) {
  const lang = language ? { language_code: language } : {};
  await call('setMyDescription', { description, ...lang });
  await call('setMyShortDescription', { short_description: short, ...lang });
}
if (process.env.PD_APP_URL) {
  await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Играть', web_app: { url: process.env.PD_APP_URL } } });
}
const info = await call('getWebhookInfo', {});
console.log(`Webhook: ${info.url}`);
console.log('Commands set: /start, /paysupport, /terms.');

// An empty update with the secret: the server answers 200 only if its
// WEBHOOK_SECRET matches (a new secret can take a few seconds to reach it).
let status = 0;
for (let attempt = 1; attempt <= 6; attempt++) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET },
    body: JSON.stringify({ update_id: 0 }),
  });
  status = response.status;
  if (status === 200) break;
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
if (status === 200) {
  console.log('Check: the server accepts this secret. The bot is ready.');
} else {
  console.error(`Check FAILED: the server answered ${status}. Its WEBHOOK_SECRET differs from the one given here.`);
  console.error('Run again with --new-secret to make both sides match.');
  process.exit(1);
}
