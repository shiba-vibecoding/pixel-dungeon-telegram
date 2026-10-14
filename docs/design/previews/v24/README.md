# Design v24 · снимки до и после

Снимки самой игры, а не макеты: Vite (`VITE_SERVER_URL=` — локальный забег без сервера), Chromium, `devicePixelRatio` 2, один и тот же сид в обоих наборах (`Math.random` в `v24-shots.js` засеян), эффекты «полные» (`pd-fx=full`), подсказки выключены.

- `before/` — ветка `main` на dd31230 (до v24), `after/` — те же коммиты с файлами из архива.
- `<lang>-375x812/`, `<lang>-1280x800/` — RU и EN, телефон и монитор.
- Сцены: `camp`, `camp-huntress` (привал), `mart` (Пиксель-Март, образы), `region01/06/11/16/21` (пять регионов: герой у высокой травы, четыре монстра региона), `folk` (торговец, бес, Крысиный король, овца, волшебник, призрак, кузнец), `king` (Король гномов и нежить), `buffs` (полоса бафов HUD), `inventory`, `hero`, `badges`.
- `cards/` — карточки «Арт v24» системы на RU и EN.

Повторить: `tools/art/v24-shots.sh` (Playwright). Скрипт зовёт `window.__pd` (`startSolo`, `session`, `core`, `play`, `openBackpack`) и четыре открывалки окон, которых в `__pd` пока нет — для снимков добавьте их в `main.ts` (только в dev-сборке):

```ts
Object.assign(window, { __pd: { get session() { return session; }, openHero, openMenu, openJournal, badges: () => showBadges(hideOverlay, []), openAlchemy, /* … как было */ } });
```
