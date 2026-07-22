# Публикация Pixel Dungeon как Telegram Mini App через GitHub Pages

Проект уже содержит production-сборку и workflow
`.github/workflows/deploy-pages.yml`. После каждого push в `master` или `main`
GitHub автоматически:

1. устанавливает Temurin JDK 8 и Node.js;
2. собирает GWT-версию игры;
3. добавляет Telegram-интеграцию и пользовательские сохранения;
4. проверяет готовый каталог;
5. публикует его в GitHub Pages.

## 1. Создание репозитория

Создайте на GitHub пустой репозиторий, например `pixel-dungeon-telegram`. Не
добавляйте README или `.gitignore` через сайт — они уже находятся в проекте.

Затем из корня проекта выполните:

```bash
git remote rename origin upstream
git remote add origin https://github.com/ВАШ_ЛОГИН/pixel-dungeon-telegram.git
git add .
git commit -m "Prepare Pixel Dungeon Telegram Mini App"
git push -u origin master
```

Если новый репозиторий использует ветку `main`, переименуйте ветку перед push:

```bash
git branch -M main
git push -u origin main
```

`upstream` сохранит ссылку на исходный GDX-порт, а `origin` будет указывать на
ваш репозиторий.

## 2. Включение GitHub Pages

Откройте **Settings → Pages → Build and deployment** и выберите
**Source: GitHub Actions**. Затем откройте вкладку **Actions** и дождитесь
успешного workflow `Build and deploy Telegram Mini App`.

Адрес игры будет выглядеть так:

```text
https://ВАШ_ЛОГИН.github.io/pixel-dungeon-telegram/
```

Все пути в сборке относительные, поэтому игра работает как в корне домена, так
и в подпапке GitHub Pages.

## 3. Подключение к Telegram

В [@BotFather](https://t.me/BotFather):

1. выберите бота через `/mybots`;
2. откройте **Bot Settings → Menu Button** или **Configure Mini App**;
3. вставьте полный HTTPS-адрес GitHub Pages;
4. запускайте игру только через этого бота, чтобы использовать его персональный
   Telegram CloudStorage.

## 4. Сохранения и настройки

В Telegram используются два слоя:

- `localStorage` — мгновенная рабочая копия, раздельная по Telegram user ID;
- `Telegram.WebApp.CloudStorage` — персональная облачная копия прогресса,
  настроек, языка, достижений и таблицы результатов.

Облако восстанавливается **до запуска GWT-игры**, после чего изменения
синхронизируются примерно раз в две секунды и при сворачивании Mini App. При
временной недоступности Telegram API игра запускается с локальной копией и не
удаляет её. Старые несегментированные сохранения автоматически переносятся
первому Telegram-пользователю на устройстве только один раз.

CloudStorage привязан к паре «бот + пользователь», поэтому перенос работает
между устройствами при запуске через одного и того же бота. Не рекомендуется
одновременно продолжать одну игру на двух устройствах: используется принцип
«последняя успешно синхронизированная версия побеждает».

При открытии прямой GitHub Pages-ссылки вне Telegram доступна только локальная
копия браузера — у обычной веб-страницы нет подтверждённого Telegram user ID.

## 5. Локальная production-сборка

Нужны JDK 8 и Node.js:

```bash
./gradlew --no-daemon html:dist
node telegram/build-telegram.mjs html/build/dist dist-telegram
node --test telegram/test-*.mjs
node telegram/serve.mjs dist-telegram 8080
```

Откройте `http://127.0.0.1:8080/`. Прямая браузерная проверка использует
локальное хранилище; настоящий Telegram CloudStorage проверяется через бота.

## Перед публикацией

- GitHub Actions завершился без ошибок.
- В Pages выбран источник **GitHub Actions**.
- URL открывается по HTTPS и игра загружается без `SuperDev Refresh`.
- Mini App запускается через нужного бота.
- После хода в игре и повторного открытия прогресс сохраняется.
- В репозитории и клиентских файлах нет bot token или других секретов.
