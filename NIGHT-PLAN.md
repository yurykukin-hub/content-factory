# 🌙 NIGHT-PLAN — Content Factory (2026-06-03/04)

Автономная ночная сессия. Приоритет: **A → C → B → D**. Каждая фаза = рабочий инкремент (deploy + test + commit).
Старт: ~01:15 UTC. ⏰ Критический VK-таймер: **08:00 UTC** (не сломать).

---

## 📸 Снимок состояния (что РЕАЛЬНО работает на старте)

- **Git:** `main`, чисто. WIP «AI-видео в сторис» закоммичен как baseline (`73381bd`), typecheck зелёный.
- **Прод:** `content-factory-backend-1` healthy, postgres healthy. Деплой: `/home/dev/projects/content-factory` → rsync → `/opt/content-factory` → build.
- **Критическая отложка:** таймер `vk-story-morning` жив (NEXT 08:00 UTC). Скрипт `/app/uploads/_scripts/vk_publish.js` + `story_video_final.mp4` на месте. Бэкап скрипта: `.night-backup/vk_publish.js.bak`.
  - Контракт (НЕ менять): `db` из `/app/src/db`; `getPublisher("VK").publish({ text, mediaFiles, platformAccount, postType:"STORIES", storiesOptions:{ skipOverlay, linkText, linkUrl } })`; `PlatformAccount.{businessId,platform,isActive}`.

### Эпик A (Сторис) — состояние
- **A1 БАГ подтверждён:** `/schedule` (`publish.ts:104`) принимает только `{scheduledAt}`, Zod нет. `scheduler.ts:55` хардкодит `storiesOptions:{skipOverlay:true}` → **кнопка ВК и музыка теряются** при отложке. Нет поля под опции в БД.
- **A2:** `isPublished` (`StoryEditorView.vue:293`) считает SCHEDULED = locked → путает запланированное с опубликованным. Есть cancel, нет edit/reschedule, нет общего списка.
- **A3:** `StoryTemplate` — только per-business (`businessId` обязателен, нет `isSystem`). Нет глобальных пресетов, нет shadow/outline/opacity.
- **A4:** Музыка (Sound Studio, `GenerationSession type=music`, `audioUrl`/`results[]`) НЕ связана со StoryEditor. Функции мукса аудио в видео НЕТ (`video-overlay.ts` только `overlayImageOnVideo`).

### Эпик C (Утренний агент) — состояние
- **Бэкбон ЕСТЬ:** `auto-poster.ts` (`checkAndRunAutoPost()` вызывается из `scheduler.ts:18` каждые 60с, gated `autopost_enabled='true'`, идемпотентно по `autopost_last_run`). Сейчас он **фото-driven** (Google Photos → Vision → Sonnet → `AutoPostTask` → Telegram). Для НаWоде нужен **data-driven** сиблинг.
- **Reuse:** `AutoPostTask` (модель), `sendApprovalToTelegram()` (`telegram-approval.ts`), `telegram-bot.ts` (webhook), eventBus (`post_created`/`session_updated`).
- **Конфиг НЕ настроен:** в `app_config` нет ни `autopost_*`, ни `telegram_*` ключей → авто-постер спит (не мешает). ⚠️ Telegram-бот токен/chat_id отсутствуют — создать бота автономно нельзя.

### Данные НаWоде (развилка ФАЗЫ 0 — РЕШЕНО)
- `daily-summary` endpoint существует (`/api/public/daily-summary`) но **auth-gated (401)**; `erp_base_url`/`erp_api_key` у НаWоде в CF **пустые**.
- **РЕШЕНИЕ:** прямой **read-only доступ к nawode PostgreSQL** через `Bun.sql` (встроен в Bun 1.3.11, 0 новых зависимостей). Контейнер CF дотягивается до `155.212.219.88:5436` (TCP_OK). Инкапсулировать в `services/nawode-data.ts`, конфиг `NAWODE_DATABASE_URL`.
  - ⚠️ *Обсудить с Юрием:* долгосрочно лучше HTTP `daily-summary` (расцепить схемы). Прямой доступ выбран ради надёжности и чтобы не трогать прод на другом VPS ночью.
- **Таблицы:** `bookings` (date, start_time, end_time, group_size, total_price, status, service_type, source, notes), `weather_forecasts` (date, hour, temperature, wind_speed, wind_gusts, precipitation, weather_code, fetched_at, location_id) — почасовой, дедуп по последнему `fetched_at`/локации. НаWоде businessId в CF = `cmntz1kuw0006nt2qptk8yhpc`.

---

## ✅ Чеклист по фазам (обновляется по ходу)

### Phase 0 — Research & Plan
- [x] Прочитан night-prompt, орг-проверки, бэкап критического скрипта
- [x] Аудит Эпика A (полный отчёт), Эпик C backbone, данные НаWоде, топология
- [x] Решена развилка данных (прямой Bun.sql к nawode)
- [x] NIGHT-PLAN.md создан

### Эпик A — Сторис под ключ
- [ ] **A1** Отложка сохраняет кнопку ВК + музыку (migration `post_versions.publish_options Json?`, Zod на `/schedule`, scheduler читает опции, StoryEditor шлёт) → deploy+test+commit
- [ ] **A2** Управление запланированными (split isPublished/isScheduled, список + cancel + reschedule/edit) → deploy+test+commit
- [ ] **A3** Дизайн-пресеты оверлея (StoryTemplate глобальные + shadow/outline/opacity, seed 3–5, apply) → deploy+test+commit
- [ ] **A4** Музыка в сторис (`overlayAudioOnVideo()`, мукс в bake-пайплайн, picker в редакторе, persist в publish_options) → deploy+test+commit

### Эпик C — Утренний AI-агент
- [ ] **C0** Контент-план НаWоде в CF (рубрики в BrandProfile/план на июнь) — прочитать strategic docs
- [ ] **C1** `nawode-data.ts` (bookings + weather через Bun.sql) + конфиг
- [ ] **C2** `daily-digest.ts` (данные + план + недавние посты → Sonnet → структурированные предложения)
- [ ] **C3** Доставка: web-UI карточки (SSE) + Telegram (graceful если нет токена)
- [ ] **C4** Одобрение → создаёт Post, виден в UI, перехват ручного управления
- [ ] **C5** Ежедневный триггер в scheduler (AppConfig время, идемпотентно)
- [ ] **C6** Агент умеет все форматы (помечает недоступные)

### Эпик B — Все форматы (если время)
- [ ] B1 PostsView все типы · B2 PostEditor смена типа · B3 Scheduler для всех типов · B4 IG Reels UI · B5 VK Клипы · B6 TG видео

### Эпик D — Интеллект плана (если время)
- [ ] История публикаций в контекст · ERP-события · рубрики с примерами · regenerate ячейки

---

## 🧭 Принятые решения (дефолты, ⚠️ = обсудить)
- WIP «AI-видео в сторис» закоммичен как baseline (typecheck ок).
- Хранилище опций публикации: `PostVersion.publishOptions Json?` (`{ skipOverlay, linkText, linkUrl, photoPosition, audioUrl?, musicSessionId? }`).
- ⚠️ Данные агента — прямой read-only Postgres к nawode (не HTTP-эндпоинт).
- ⚠️ Telegram-доставка агента — graceful: работает в web-UI; Telegram включится, когда Юрий добавит `telegram_approval_bot_token` + `telegram_approval_chat_id` в Settings/AppConfig.
- Все миграции — additive/backwards-compatible, с бэкапом БД до применения.
