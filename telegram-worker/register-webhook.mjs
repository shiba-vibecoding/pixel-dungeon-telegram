const required = ["BOT_TOKEN", "WEBHOOK_SECRET", "WEBHOOK_URL"];
for (const name of required) {
	if (!process.env[name]) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
}

const { BOT_TOKEN, WEBHOOK_SECRET, WEBHOOK_URL } = process.env;
const webhookUrl = new URL(WEBHOOK_URL);
const GAME_URL = "https://t.me/pixel_dungeon_gamebot/pixel_dungeon";
const BOT_NAME = "Telegram Pixel Dungeon";
const MENU_BUTTON_TEXT = "Play Telegram Pixel Dungeon";
const BOT_DESCRIPTION =
	"Enter Telegram Pixel Dungeon — a classic pixel-art roguelike with tactical " +
	"turn-based combat, 15 languages and cloud-synced progress. Tap Play to begin your descent.";
const BOT_SHORT_DESCRIPTION =
	"Telegram Pixel Dungeon — the classic pixel-art roguelike, rebuilt for Telegram Mini Apps.";

if (webhookUrl.protocol !== "https:") {
	throw new Error("WEBHOOK_URL must use HTTPS");
}

if (!/^[A-Za-z0-9_-]{1,256}$/.test(WEBHOOK_SECRET)) {
	throw new Error(
		"WEBHOOK_SECRET must contain 1-256 characters: A-Z, a-z, 0-9, _ or -",
	);
}

webhookUrl.pathname = "/webhook";
webhookUrl.search = "";
webhookUrl.hash = "";

async function telegram(method, body) {
	const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json; charset=utf-8" },
		body: JSON.stringify(body),
	});

	let result;
	try {
		result = await response.json();
	} catch {
		throw new Error(`Telegram returned a non-JSON response for ${method}`);
	}

	if (!response.ok || result.ok !== true) {
		throw new Error(`Telegram rejected ${method} (HTTP ${response.status})`);
	}
}

// These values live in Telegram, not in the repository. Keep the bot profile,
// default menu button and webhook aligned in one safe registration command.
await telegram("setMyName", { name: BOT_NAME });
await telegram("setMyDescription", { description: BOT_DESCRIPTION });
await telegram("setMyShortDescription", {
	short_description: BOT_SHORT_DESCRIPTION,
});
await telegram("setChatMenuButton", {
	menu_button: {
		type: "web_app",
		text: MENU_BUTTON_TEXT,
		web_app: { url: GAME_URL },
	},
});
await telegram("setWebhook", {
	url: webhookUrl.toString(),
	secret_token: WEBHOOK_SECRET,
	allowed_updates: ["message"],
	drop_pending_updates: false,
});

console.log(`Bot profile set to "${BOT_NAME}"`);
console.log(`Menu button set to "${MENU_BUTTON_TEXT}"`);
console.log(`Webhook registered for ${webhookUrl.origin}/webhook`);
