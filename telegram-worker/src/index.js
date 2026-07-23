const GAME_URL = "https://t.me/pixel_dungeon_gamebot/pixel_dungeon";

export const BUTTON_TEXT = "Play Telegram Pixel Dungeon";

export const REPLIES = Object.freeze([
	"The dungeon heard you. Something just moved in the dark...",
	"A rat stole my reply. Chase it into the dungeon!",
	"The dungeon says: less chatting, more looting.",
	"Hero wanted. Equipment optional. Courage recommended.",
	"Careful: this button may contain monsters.",
	"The Amulet will not find itself. Your adventure awaits!",
	"Torches lit. Doors unlocked. Adventure waiting.",
	"Your backpack looks suspiciously empty. Time for a quest.",
	"One more step. One more room. One more story.",
	"Your message echoed all the way down to the next floor.",
	"Treasure, traps, and terrible decisions are one tap away.",
	"The dungeon accepted your message as an offering.",
]);

export function pickReply(randomValue) {
	let value = randomValue;
	if (!Number.isSafeInteger(value) || value < 0) {
		const randomValues = new Uint32Array(1);
		crypto.getRandomValues(randomValues);
		value = randomValues[0];
	}
	return REPLIES[value % REPLIES.length];
}

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}

function secretsMatch(received, expected) {
	if (typeof received !== "string" || typeof expected !== "string") {
		return false;
	}
	if (received.length !== expected.length || expected.length > 256) {
		return false;
	}

	let difference = 0;
	for (let index = 0; index < expected.length; index += 1) {
		difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
	}
	return difference === 0;
}

function isPrivateHumanMessage(message) {
	return Boolean(
		message &&
		message.chat &&
		message.chat.type === "private" &&
		message.from &&
		message.from.is_bot !== true &&
		Number.isSafeInteger(message.chat.id),
	);
}

async function sendGameButton(message, botToken, fetchImpl) {
	const telegramResponse = await fetchImpl(
		`https://api.telegram.org/bot${botToken}/sendMessage`,
		{
			method: "POST",
			headers: { "content-type": "application/json; charset=utf-8" },
			body: JSON.stringify({
				chat_id: message.chat.id,
				text: pickReply(),
				reply_parameters: {
					message_id: message.message_id,
					allow_sending_without_reply: true,
				},
				reply_markup: {
					inline_keyboard: [[{ text: BUTTON_TEXT, url: GAME_URL }]],
				},
			}),
		},
	);

	if (!telegramResponse.ok) {
		throw new Error("Telegram Bot API rejected sendMessage");
	}
	const telegramResult = await telegramResponse.json();
	if (telegramResult?.ok !== true) {
		throw new Error("Telegram Bot API did not confirm sendMessage");
	}
}

export async function handleRequest(request, env, fetchImpl = fetch) {
	const url = new URL(request.url);

	if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
		return jsonResponse({
			ok: true,
			service: "telegram-pixel-dungeon-gamebot",
		});
	}

	if (request.method !== "POST" || url.pathname !== "/webhook") {
		return jsonResponse({ ok: false, error: "not_found" }, 404);
	}

	if (!env?.BOT_TOKEN || !env?.WEBHOOK_SECRET) {
		return jsonResponse({ ok: false, error: "not_configured" }, 503);
	}

	const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token");
	if (!secretsMatch(receivedSecret, env.WEBHOOK_SECRET)) {
		return jsonResponse({ ok: false, error: "unauthorized" }, 401);
	}

	let update;
	try {
		update = await request.json();
	} catch {
		return jsonResponse({ ok: false, error: "invalid_json" }, 400);
	}

	if (!isPrivateHumanMessage(update?.message)) {
		return jsonResponse({ ok: true, ignored: true });
	}

	try {
		await sendGameButton(update.message, env.BOT_TOKEN, fetchImpl);
		return jsonResponse({ ok: true });
	} catch {
		// Do not include Telegram's response, request contents, or secrets in the reply.
		return jsonResponse({ ok: false, error: "telegram_unavailable" }, 502);
	}
}

export default {
	fetch(request, env) {
		return handleRequest(request, env);
	},
};
