# Фаза A — Спека фундамента UI (токены + кит компонентов)

_Чекпоинт ДО сборки. Grounded в замерах CF + разбор донора + opus-скептик (анти-раздувание)._

## Контекст токенов
- **CF = Tailwind v3.4.17** (`tailwind.config.js`, `@tailwind` директивы). **Донор = v4** (`@theme` CSS-vars, indigo). → токены объявляем в v3-идиоме, бренд остаётся **fuchsia `#d946ef`** (не менять). См. `lessons/01`.
- Замер реального использования сырых цветов в `src/` (сколько раз встречается семейство):
  `gray 3051 · brand 383 · fuchsia 328 · emerald 262 · red 230 · green 210 · blue 170 · amber 142 · yellow 25`.
  → семантика назначается по факту, не выдумывается.

## 1. Токены (`tailwind.config.js`, extend.colors)
| Токен | Маппинг | Обоснование (замер) | Использование в классах |
|---|---|---|---|
| `brand` | fuchsia-шкала (текущая, 50–950) | 383+328 — основной | `bg-brand-600 focus-visible:ring-brand-500` |
| `success` | `colors.emerald` (полная шкала) | emerald 262 + green 210 = 472 | `text-success-700 dark:text-success-300` |
| `danger` | `colors.red` | 230 (+ UiButton danger) | `bg-danger-600 hover:bg-danger-700` |
| `warning` | `colors.amber` | amber 142 + yellow 25 = 167 | `bg-warning-500/15 text-warning-700` |
| `info` | `colors.blue` | 170 | `text-info-600` |
| нейтраль/поверхности | остаётся `gray` (дефолт Tailwind) + `dark:` варианты | 3051 — рабочая лошадь | `bg-white dark:bg-gray-800` |

- Реализация: `import colors from 'tailwindcss/colors'` → `success: colors.emerald, danger: colors.red, warning: colors.amber, info: colors.blue`. Чистые алиасы на полные шкалы (0 новых оттенков, консистентно с существующим кодом).
- **surface/muted НЕ вводим отдельным CSS-var слоем** (хрупко в v3) — поверхности через `gray` + `dark:`. Семантику даём только акцентам (success/danger/warning/info) — там реальная польза.
- Реконсиляция: `fuchsia-*` (328) постепенно → `brand-*` в ходе миграции экранов (не отдельной задачей — Boy Scout внутри миграции).
- Транзишены донора (`.fade`, `.slide-up`) добавить в `src/style.css` — UiModal/UiDropdown их требуют (в CF их нет).

## 2. Кит компонентов — ФИНАЛ (после скептика): 17 примитивов + обёртка тостов
KEEP (донор, адаптация к v3):
1. **UiButton** — variant primary/secondary/danger/ghost + **icon-only (требует aria-label)**; size sm/md/lg; `loading` (внутри UiSpinner); focus-visible ring. Заменяет 489 сырых `<button>`.
2. **UiInput** — + props `label/error/hint` (a11y-связка label↔input).
3. **UiSelect** — убивает native `<select>` в 11 файлах.
4. **UiTextarea** — autosize + maxlength-счётчик (пост/чат/сторис/lyrics).
5. **UiModal** — Teleport + focus-trap + Escape + scroll-lock. Заменяет 39 сырых модалок.
6. **UiConfirmDialog** — заменяет 11 `window.confirm`.
7. **UiDropdown** — «Опубликовать ▾», split-button enhance, меню.
8. **UiTabs** — + **`variant="segmented"`** (поглощает идею UiSegmented). Настройки/Лента-табы/превью каналов/студийные табы.
9. **UiTable** — ТОНКИЙ, только AI-логи + Аналитика. Без сортировок/виртуализации (анти-скоуп).
10. **UiBadge** — статусы/баланс/каналы/конкуренты.
11. **UiCard** — карточки предложений (Лента)/бизнесов/сессий/KPI.
12. **UiEmptyState** — пустые галерея/сессии/лента/поиск.
13. **UiSkeleton** — скелетоны на загрузку layout.
14. **UiSpinner** — атом indeterminate (agent typing, «генерируется»); используется внутри Button/Input loading (не дублирует).
15. **UiTooltip** — сквозная боль «навёл — непонятно что кнопка делает». Обязателен для icon-кнопок (↺↻, enhance, publish).
16. **UiSwitch** ⟵ ДОБАВЛЕН скептиком (MUST) — панель настроек дайджеста = сплошь тумблеры: вкл/выкл, утро/день/вечер, **human↔автопилот**, flash/roles/utm/analytics.
17. **UiImage** ⟵ ДОБАВЛЕН (SHOULD) — обёртка: обязательный `alt`, lazy, aspect-ratio, video-thumb fallback. Ретайрит ~38 `<img>` без alt.
+ **UiToastContainer** = обёртка над существующим `useToast` (НЕ новая абстракция; API `success/error/info` сохранить, добавить `warning`).

CUT: **UiPagination** (нет ни одного места с нумерованной пагинацией — везде infinite-scroll/cursor/card-feed).
MERGE: **UiSegmented → UiTabs `variant="segmented"`** (плюс идею simple/advanced мы вообще удаляем в пользу одного умного чата).

## a11y встроен по умолчанию
focus-visible ring везде (сейчас 0) · aria/role · focus-trap+Escape в UiModal · 11 `window.confirm`→UiConfirmDialog · обязательный alt через UiImage · touch-таргеты 44px (токен уже есть).

## Не ломать
`useToast`+ToastContainer (Teleport) · theme-store (`.dark` на `<html>` + `cf_theme`) · `MediaPickerModal` (6× reuse) · брендовый `brand`.
