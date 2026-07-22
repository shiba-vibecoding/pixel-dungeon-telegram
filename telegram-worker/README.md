# Telegram Stars worker

This Worker keeps the bot token off GitHub Pages, creates a reusable 50 Stars
invoice and answers Telegram `pre_checkout_query` updates in time.

Required Cloudflare Worker secrets:

- `BOT_TOKEN` — token from BotFather;
- `WEBHOOK_SECRET` — a random 32+ character value containing only letters,
  digits, `_` and `-`.

Recommended KV binding:

- `PAYMENTS` — stores the Telegram charge id and payment receipt needed for
  support and possible refunds. Create a Workers KV namespace and bind it to
  the Worker under this exact name in Cloudflare Settings > Bindings.

Deploy from this directory with Wrangler, then set the public Worker origin as
the GitHub repository variable `STARS_API_URL`. The first invoice request sets
the bot webhook automatically.

Never commit `.dev.vars`, bot tokens or webhook secrets.
