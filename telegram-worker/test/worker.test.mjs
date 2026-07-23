import assert from "node:assert/strict";
import test from "node:test";

import worker, {
	BUTTON_TEXT,
	REPLIES,
	handleRequest,
	pickReply,
} from "../src/index.js";

const ENV = Object.freeze({
	BOT_TOKEN: "123456:test-token",
	WEBHOOK_SECRET: "test_webhook_secret",
});

function webhookRequest(update, secret = ENV.WEBHOOK_SECRET) {
	return new Request("https://worker.example/webhook", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-telegram-bot-api-secret-token": secret,
		},
		body: JSON.stringify(update),
	});
}

function privateMessage(languageCode = "en") {
	return {
		update_id: 101,
		message: {
			message_id: 202,
			chat: { id: 303, type: "private" },
			from: { id: 404, is_bot: false, language_code: languageCode },
			text: "hello",
		},
	};
}

test("health endpoint does not expose configuration", async () => {
	const response = await worker.fetch(new Request("https://worker.example/health"), ENV);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		ok: true,
		service: "telegram-pixel-dungeon-gamebot",
	});
});

test("rejects webhook requests with the wrong secret before calling Telegram", async () => {
	let calls = 0;
	const response = await handleRequest(
		webhookRequest(privateMessage(), "wrong"),
		ENV,
		async () => {
			calls += 1;
			return new Response();
		},
	);

	assert.equal(response.status, 401);
	assert.equal(calls, 0);
});

test("ignores group messages and messages sent by bots", async () => {
	const updates = [
		{
			message: {
				chat: { id: -1001, type: "supergroup" },
				from: { id: 1, is_bot: false, language_code: "ru" },
			},
		},
		{
			message: {
				chat: { id: 2, type: "private" },
				from: { id: 3, is_bot: true, language_code: "ru" },
			},
		},
	];

	for (const update of updates) {
		let calls = 0;
		const response = await handleRequest(
			webhookRequest(update),
			ENV,
			async () => {
				calls += 1;
				return new Response();
			},
		);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { ok: true, ignored: true });
		assert.equal(calls, 0);
	}
});

test("answers a private message in English with the Mini App URL button", async () => {
	let capturedUrl;
	let capturedInit;
	const response = await handleRequest(
		webhookRequest(privateMessage("ru-RU")),
		ENV,
		async (url, init) => {
			capturedUrl = url;
			capturedInit = init;
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		},
	);

	assert.equal(response.status, 200);
	assert.match(capturedUrl, /^https:\/\/api\.telegram\.org\/bot[^/]+\/sendMessage$/);
	assert.equal(capturedInit.method, "POST");

	const payload = JSON.parse(capturedInit.body);
	assert.equal(payload.chat_id, 303);
	assert.ok(REPLIES.includes(payload.text));
	assert.deepEqual(payload.reply_parameters, {
		message_id: 202,
		allow_sending_without_reply: true,
	});
	assert.deepEqual(payload.reply_markup.inline_keyboard, [[{
		text: BUTTON_TEXT,
		url: "https://t.me/pixel_dungeon_gamebot/pixel_dungeon",
	}]]);
	assert.equal(Object.hasOwn(payload, "parse_mode"), false);
});

test("picks every English dungeon reply from a bounded random value", () => {
	assert.ok(REPLIES.length >= 8);
	assert.equal(pickReply(0), REPLIES[0]);
	assert.equal(pickReply(REPLIES.length), REPLIES[0]);
	for (let index = 0; index < REPLIES.length; index += 1) {
		assert.equal(pickReply(index), REPLIES[index]);
		assert.match(REPLIES[index], /^[\x20-\x7E]+$/);
	}
});

test("returns a sanitized error when Telegram is unavailable", async () => {
	const response = await handleRequest(
		webhookRequest(privateMessage()),
		ENV,
		async () => new Response("sensitive upstream body", { status: 500 }),
	);

	assert.equal(response.status, 502);
	assert.deepEqual(await response.json(), {
		ok: false,
		error: "telegram_unavailable",
	});
});
