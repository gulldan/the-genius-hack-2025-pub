# KvadricepsHub - Volunteer Platform

> 🏆 **Команда Квадрицепс**: MAX и RUSTAM  
> 🚀 **Стек**: Bun + Elysia + Eta + htmx + Tailwind CSS + SQLite  
> 🎯 **Цель**: Современная платформа для волонтёрских мероприятий

MVP волонтёрской платформы с поиском по событиям, системой заявок и статусов, чекином по QR/Telegram, панелью координатора, отчётами и управлением инцидентами.

## Быстрый старт

Требуется Bun 1.2+ (установка: https://bun.sh). База данных SQLite создаётся автоматически (файл `volunteer.db` в корне).

```bash
bun install                  # установка зависимостей
bun run seed                 # подготовка схемы и демо‑данных
bun run build:css            # сборка Tailwind CSS → public/style.css
bun run lint                 # проверка Biome

# режим разработки (watch для CSS + сервер)
bun run dev:all

# или одиночный запуск сервера
bun run dev
```

Сервер: http://localhost:3000

### Docker

```bash
# сборка образа
docker build -t volunteer-platform .

# запуск
docker run -p 3000:3000 volunteer-platform
```

Для сохранения базы данных можно смонтировать volume:

```bash
docker run -p 3000:3000 -v $(pwd)/volunteer.db:/app/volunteer.db volunteer-platform
```

### Переменные окружения

```bash
TELEGRAM_BOT_TOKEN=your_bot_token             # опционально для реальной интеграции
TELEGRAM_BOT_USERNAME=your_bot_username       # @username без @
QR_SECRET=random_string_for_qr                # подпись QR для чекина
SESSION_SECRET=random_session_secret          # сессии/подписи (упрощённо)
PORT=3000
```

Если `TELEGRAM_BOT_TOKEN` не задан, Telegram работает в демо‑режиме: сообщения логируются в консоль, вход через Telegram имитируется на странице входа (mock hash). Это удобно для локальной разработки.

### Telegram интеграция

1) Создайте бота через BotFather и получите токен и юзернейм.  
2) Установите переменные окружения (см. выше).  
3) В продакшне настройте вебхук на роут `/webhook/telegram`:

```
https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=https://<домен>/webhook/telegram
```

4) Мини‑приложение Telegram доступно по ссылке формата `https://t.me/<бот>/app` (deep‑links в коде генерируются через `TelegramMiniApp.generateLink`).

## 📁 Структура проекта

- `src/server.ts` — инициализация Elysia и статика
- `src/routes/*` — основные роуты: события, аккаунт, оргпанель, чекин, аналитика, инциденты, Telegram
- `src/lib/*` — утилиты: Telegram, аналитика, уведомления, валидация, CSRF, rate‑limit, шаблонизатор
- `src/sql/ddl.sql` — схема БД; `src/sql/queries.ts` — подготовленные запросы
- `src/views/*.eta` — HTML‑шаблоны Eta (страницы и фрагменты для htmx)
- `styles/tailwind.css` → `public/style.css` — стили
- `scripts/seed.ts` — сидинг демо‑данных
- `docs/deck.md` — презентация (Marp)

## 🚀 Скрипты

- `bun run dev` — запуск сервера для разработки
- `bun run seed` — сидинг БД (создание схемы и демо-данных)
- `bun run build:css` — сборка Tailwind CSS
- `bun run dev:css` — watch для CSS (автоперезборка при изменениях)
- `bun run dev:server` — сервер с портом из переменной `PORT`
- `bun run dev:all` — параллельно CSS watch + сервер (рекомендуется для разработки)
- `bun run lint` — проверка кода через Biome

## 🧪 Тесты

Есть базовые тесты маршрутов, Telegram‑утилит и перфоманса пагинации.

```bash
bun test
```

## ✨ Возможности

### 🙋‍♀️ Для волонтёров

- Поиск по событиям: категория, длительность смены, радиус от города, формат (онлайн/офлайн), возраст, навыки, интересы; сортировка по дате/новизне/популярности
- Каталог и избранное (`/events`, `/favorites`), страницу события с ролями и сменами, счётчики мест и лист ожидания
- Подача заявки с CSRF и базовой валидацией; статусы: pending/approved/waitlisted/declined
- Чекин через QR/Telegram: личная страница QR (`/my-qr`), киоск (`/events/:id/kiosk`), панель координатора (`/events/:id/live`)
- Личный кабинет (`/account`): заявки, ближайшие смены, статистика часов, бейджи, настройки уведомлений (`/account/notifications`)
- Сертификаты и открытые бейджи (`/certificates`, `/badges/:id`)

### 👨‍💼 Для организаторов и координаторов

- Организационная панель (`/org/:orgId`): список событий, фильтры и массовые действия (публикация/закрытие/удаление)
- Создание/редактирование событий, ролей, смен; генерация deep‑links для Telegram, настройка геозоны чекина
- Управление заявками (`/org/:orgId/applications`): approve/decline, массовые операции, фильтры по событию и статусу
- Чекин/чекаут участников: киоск, панель координатора, токены, учёт часов и верификация
- Отчёты и аналитика (`/org/:orgId/reports`, экспорт CSV), журнал инцидентов (`/api/incidents`)

## 🛣️ Маршруты (срез)

- Пользовательские: `/`, `/events`, `/events/:id`, `/favorites`, `/organizations`, `/account`, `/history`, `/my-qr`, `/login`, `/register`
- Чекин: `/events/:id/live`, `/events/:id/kiosk`, `/checkin/process`, `/checkin/token/:token`, `/checkin/qr/:applicationId/:shiftId`
- Организация: `/org/:orgId`, `/org/:orgId/events`, `/org/:orgId/applications`, `/org/:orgId/reports`
- Telegram: `/webhook/telegram`, `/tg/start/:payload`

## 🔐 Безопасность и производительность

- CSRF: cookie `csrf_token` + проверка в POST‑маршрутах
- Rate‑limit по IP для чувствительных действий
- Подписанные QR‑коды (`QR_SECRET`) и ограничение «срока жизни»
- Серверный рендеринг, минимальный клиентский JS (htmx) и Tailwind для быстрых страниц

## 🗄️ Данные и сидинг

`scripts/seed.ts` создаёт организации (психиатрическая помощь, помощь зависимым, детский центр), пользователей и набор событий в Санкт‑Петербурге, Перми и Покачах. Также генерируются роли, смены, тестовые заявки, посещаемость и несколько инцидентов. Повторный запуск перезапишет содержимое таблиц.

## 📊 Презентация

### Онлайн-презентация
🌐 **[Смотреть презентацию онлайн](https://kvadricepshub--ydo6xlb.gamma.site/)**

### PDF-файл
📄 **[Скачать презентацию (PDF)](./pres.pdf)**

### Исходники
Слайды в `docs/deck.md` (формат Marp).

```bash
# пример сборки (если установлен marp-cli)
bunx marp docs/deck.md -o deck.html
```

## Лицензия

MIT
