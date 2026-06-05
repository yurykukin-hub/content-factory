# Content Factory — POLISH session (хвосты до блеска)

> Источник правды по сессии. Обновляю чекбоксы по ходу. Полный контекст: `~/.claude/plans/hazy-zooming-lollipop.md`.
> 🚨 DEV-БД ТОЛЬКО standalone (`docker run --name cf-dev-pg -p 5441:5432 postgres:16-alpine`). НИКОГДА `docker compose up/down` из проекта. Бэкап перед миграциями.

## Locked decisions
- VK-постинг: гибрид — стена/фото → общий `PostmypostPublisher` (флаг `config.viaPostmypost`), сторис → прямой VK. Обратимо.
- VK-статы: ре-авторизация VK (scope `stats`) первым делом; Postmypost-VK-аналитика только если scope застрянет.
- Метрика: в CF только визиты по `utm_content=postId` (счётчик 92916147 + OAuth). Вебвизор/ERP-атрибуция — отдельно.
- Редактор: НЕ трогаем прод. UI «вау» → отдельный тоолед-заход.

## Gating-действия Юрия (для замыкания петли)
- [x] PMP `account_id` VK-канала НаWоде → **2164096** (взял через PMP API; chanel_id=2 VK, connection_status=1)
- [ ] **Greenlight VK-смоук:** опубликовать 1 тестовый PHOTO-пост в НаWоде VK (UI: Создать → Фото → канал VK → Опубликовать). Или скажи «постни» — сделаю сам.
- [ ] Ре-авторизация VK OAuth в Настройках (scope `stats`) — для VK-статов
- [ ] Метрика OAuth-токен + id цели «бронь» — для визитов/конверсий

## Phase 0 — актуализация
- [x] Прочитан бриф + MEMORY + ADR + под-брифы
- [x] Разведка кода: publishers/роутинг, analytics-петля, редактор
- [x] POLISH-PLAN.md создан

## 1. VK-постинг через Postmypost (разблокировка) — КОД ГОТОВ, в проде
- [x] Извлечён generic `PostmypostPublisher` (`postmypost.ts`); `instagram.ts` → тонкая обёртка
- [x] `getPublisher(platform, {postType, config})`: VK+неSTORIES+viaPostmypost → PMP; VK+STORIES → Vk; IG → PMP; TG → TG
- [x] Обновлены 3 вызова: `publish.ts` + `scheduler.ts` + `telegram-approval.ts`
- [x] VK-стена через PMP: account_id из `config.postmypostAccountId` (2164096), токен из env (не config — утечка во фронт)
- [x] +8 роутинг-тестов (159 всего зелёные); 0 новых tsc-ошибок
- [x] Прод-настройка: `.env.prod` POSTMYPOST_API_TOKEN+PROJECT_ID; VK-аккаунт config={viaPostmypost,postmypostAccountId}
- [x] deploy (commits 0299d95, a9eec46) — backend healthy, env подхвачен
- [ ] **smoke: реальный VK-пост с фото** (awaiting greenlight Юрия — публичный бренд)

## 2. Петля аналитики до конца
- [x] **Недельный агент включён** (`analytics_agent_enabled=true`, прод) — Mon 06:00 UTC
- [x] Данные живут: 18 IG-снапшотов, 1 отчёт (пайплайн подтверждён). metrics_enabled on (дефолт)
- [ ] (gated, Юрий) после ре-авторизации VK — stories.getStats/stats.get; smoke /analytics/collect
- [ ] (gated, Юрий) после Метрика-OAuth — визиты+цели по utm_content (site_traffic сейчас 0)
- [ ] (опц.) Postmypost account-level (/analytics/accounts, param metrics) — account_snapshots сейчас 0

## 3. Арх-долг Эпика B — ✅ СНЯТ (commit 4a0f822, в проде)
- [x] Phase 3 — strategy-as-data: модели `Rubric`+`Occasion` + `BrandProfile.contentStrategy`/`seasonHints`; generic `services/ai/strategy.ts`; сидер `seed-nawode-strategy.ts` (идемпотентный); убран литерал `erpType==='nawode'` в digest+plan
- [x] Phase 2 — `services/datasource/` (DataSourceAdapter + NawodeErpAdapter + Null + реестр); digest/plan берут данные через адаптер
- [x] migration `add_strategy_as_data` (аддитивная) → dev → прод; сидер в проде; **прод-смоук no-AI зелёный** (рубрики 10, поводы 8, стратегия 1097, погода 4)
- [x] +8 тестов (equivalence БД==код + datasource) = 167 зелёных; 0 новых tsc
- [ ] (Deferred, кросс-репо) HTTP-контракт `GET /public/daily-summary` на nawode-erp + `NawodeHttpAdapter`

## 4. Редактор — НЕ трогаем (decision)

## 5. Документация / уборка (в конце)
- [ ] MEMORY.md >100 → MEMORY-ARCHIVE.md
- [ ] Архив старых планов (38 в plans/)
- [ ] Vault last_verified + аудит
- [ ] Обновить CLAUDE.md / ADR / брифы по факту

## 6. (опц.) Telegram approval-бот для дайджеста
