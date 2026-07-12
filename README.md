# OverVPN

Однонодовая панель управления VPN на **sing-box**: админка, API, подписки, учёт трафика, лимиты, бэкапы.

Интерфейс панели по умолчанию на **русском** (переключатель EN/RU в шапке).

## Быстрая установка (Ubuntu / Debian)

По умолчанию ставит **готовые образы из GHCR** (без долгой локальной сборки):

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/Overl1te/OverVPN/master/install.sh)" @ install
```

Локальная сборка образов на сервере:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/Overl1te/OverVPN/master/install.sh)" @ install --build
```

Образы публикуются одним workflow **CI** на self-hosted runner: сначала `verify`, затем `publish` в GHCR (только push в `master` / теги `v*` / ручной запуск):

- `ghcr.io/overl1te/overvpn-api:latest`
- `ghcr.io/overl1te/overvpn-web:latest`

### Self-hosted runner (сборка образов)

На отдельной или той же Ubuntu-машине с Docker:

```bash
# токен: Repo → Settings → Actions → Runners → New self-hosted runner
# или: gh api -X POST repos/Overl1te/OverVPN/actions/runners/registration-token --jq .token
sudo RUNNER_TOKEN=XXXX ./scripts/install-github-runner.sh
```

Workflows ждут labels: `self-hosted`, `linux`, `x64`, `overvpn`.

Установщик спросит по шагам:

1. **Базовый домен** (`example.com`) — или пусто для режима `http://IP:8000`
2. **Панель** — хост, по умолчанию `panel.example.com` (только хост, без пути)
3. **Подписки** — хост или `хост/путь`, по умолчанию `sub.example.com` (можно `example.com/sub`)
4. **VPN-хост** — для клиентских endpoint’ов, по умолчанию `vpn.example.com`
5. Email для Let’s Encrypt

Затем покажет **какие A-записи создать у DNS-хостера**, дождётся подтверждения, проверит резолв и выпустит сертификаты на все хосты (включая поддомены).

После установки:

```bash
overvpn status
overvpn logs
overvpn info
overvpn update              # pull новых образов из GHCR
overvpn update --build     # пересобрать локально
overvpn restart
overvpn uninstall
```

| Компонент              | Порт по умолчанию                                      |
| ---------------------- | ------------------------------------------------------ |
| Веб-панель             | `8000` (без домена) / `443` через Nginx / `5173` (dev) |
| API                    | `3000` (внутри Compose; снаружи через веб/прокси)      |
| PostgreSQL             | `5432` (только localhost)                              |
| Redis                  | `6379` (только localhost)                              |
| sing-box (UDP inbound) | `443`                                                  |

---

## 1. Требования

- Docker Engine + Compose v2
- (опционально для разработки) Node.js **24** LTS, pnpm **11**

Не публикуйте в интернет PostgreSQL, Redis и API напрямую. Веб лучше повесить за Nginx с TLS (пример в `deploy/proxy/`).

---

## 2. Быстрый старт (Docker вручную)

### Шаг 1. Конфигурация

```sh
cp .env.example .env
```

В `.env` замените **все** значения `REPLACE_*`. Секреты генерируйте независимо:

```sh
# пароли / JWT / Clash API (пример)
openssl rand -hex 32

# SECRETS_MASTER_KEY — ровно 64 hex-символа
openssl rand -hex 32

# пароль владельца (не короче 16 символов)
openssl rand -base64 36
```

Обязательно задайте:

| Переменная                                          | Зачем                                                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` / `DATABASE_URL`                | БД (пароль в URL должен совпадать)                                                                                                                          |
| `REDIS_PASSWORD` / `REDIS_URL`                      | Redis                                                                                                                                                       |
| `JWT_ACCESS_SECRET`                                 | Подпись access JWT                                                                                                                                          |
| `SECRETS_MASTER_KEY`                                | Шифрование секретов протоколов и бэкапов                                                                                                                    |
| `SING_BOX_CLASH_API_SECRET`                         | Внутренний Clash API                                                                                                                                        |
| `BOOTSTRAP_ADMIN_USER` / `BOOTSTRAP_ADMIN_PASSWORD` | Первый владелец                                                                                                                                             |
| `CORS_ORIGINS`                                      | Точный origin панели, например `http://localhost:8080`                                                                                                      |
| `SUB_PUBLIC_BASE_URL`                               | Публичный HTTPS URL для ссылок подписки: origin (`https://sub.example.com` → `…/api/sub/{TOKEN}`) или с путём (`https://example.com/sub` → `…/sub/{TOKEN}`) |

Для локального запуска можно временно:

```env
CORS_ORIGINS=http://localhost:8080
SUB_PUBLIC_BASE_URL=http://localhost:8080
AUTH_COOKIE_SECURE=false
```

В продакшене: `AUTH_COOKIE_SECURE=true`, реальные HTTPS-origin’ы.

### Шаг 2. Запуск стека

```sh
pnpm compose-up      # подтянуть/запустить образы из GHCR
# или локальная сборка:
pnpm compose-build
# или: make compose-up / make compose-build
```

Подождите, пока поднимутся postgres, redis, migrate, sing-box, api, web.

### Шаг 3. Создать владельца

```sh
docker compose --env-file .env -f deploy/docker-compose.yml --profile tools run --rm bootstrap-admin
```

Команда идемпотентна: при повторном запуске обновит пароль владельца из env.

### Шаг 4. Войти в панель

Откройте: **http://localhost:8080**

Логин/пароль — из `BOOTSTRAP_ADMIN_*`.

OpenAPI (если `SWAGGER_ENABLED=true`): **http://localhost:8080/api/docs**

Проверка здоровья:

```sh
curl -s http://localhost:8080/api/health
curl -s http://localhost:8080/api/health/ready
```

Остановка:

```sh
pnpm compose-down
```

---

## 3. Типовой сценарий работы

### 3.1. Создать inbound

1. **Inbounds** → создать (протокол: Hysteria2 / VLESS Reality / Trojan / Shadowsocks).
2. Укажите `tag`, listen/public host и port.
3. Для TLS-файлов положите сертификаты в `deploy/sing-box/certs` (в контейнере путь `/var/lib/sing-box-certs`).
4. После сохранения панель **сразу** пытается применить конфиг sing-box (validate → write → reload → verify → rollback при ошибке).

`SING_BOX_UDP_PORT` в `.env` должен совпадать с портом inbound’а, который вы публикуете наружу.

### 3.2. Создать пользователя

1. **Users** → создать: имя, лимит трафика, срок (`expireAt`), лимиты устройств/IP при необходимости.
2. Назначьте inbound (assignments) — появятся учётные данные протокола.
3. Скопируйте **subscription URL** или QR со страницы пользователя.

Статусы пользователя:

| Статус     | Смысл                       |
| ---------- | --------------------------- |
| `ACTIVE`   | Доступ разрешён             |
| `DISABLED` | Вручную выключен (`manual`) |
| `EXPIRED`  | Истёк срок                  |
| `LIMITED`  | Квота / устройство / IP     |

Причина отключения показывается в UI (`statusReason`).

### 3.3. Подписка клиента

Формат URL (origin без пути):

```text
{SUB_PUBLIC_BASE_URL}/api/sub/{TOKEN}
```

С путём в `SUB_PUBLIC_BASE_URL` (например `https://example.com/sub`):

```text
{SUB_PUBLIC_BASE_URL}/{TOKEN}
```

Форматы:

```sh
# sing-box JSON (по умолчанию)
curl -o profile.json "$SUB_URL?format=sing-box"

# список ссылок
curl -o links.txt "$SUB_URL?format=links"

# Clash Meta / Mihomo YAML
curl -o clash.yaml "$SUB_URL?format=clash"

# статус без секретов
curl "$SUB_URL/info"
```

Заголовки ответа (где применимо): `subscription-userinfo`, `profile-update-interval`.

**Ротация токена** (старый URL сразу перестаёт работать, VPN-пароли не меняются):

- в UI: действие rotate-sub;
- API: `POST /api/admin/users/:id/rotate-sub`.

Не светите токен в тикетах, скриншотах и логах прокси.

### 3.4. Применить конфиг вручную

**Config** → Preview (красный diff без секретов) → Apply с причиной.

История применений доступна в той же разделе. При сбое предыдущий конфиг восстанавливается автоматически.

### 3.5. Мониторинг

- **Dashboard** — онлайн, статусы пользователей, здоровье ядра, воркеры, throughput (или «недоступно»).
- **Online sessions** — активные/исторические сессии.
- **Audit** — журнал действий администраторов.

---

## 4. Роли администраторов

| Роль       | Права                                                  |
| ---------- | ------------------------------------------------------ |
| `OWNER`    | Полный доступ, удаление пользователей, restore бэкапов |
| `ADMIN`    | Обычные мутации (users/inbounds/apply/backups create)  |
| `READONLY` | Только чтение; мутации в UI скрыты/заблокированы       |

Опционально включите **TOTP 2FA** в профиле администратора (enable → confirm кодом).

---

## 5. Резервное копирование

В панели: **Backups**.

| Тип           | Содержимое                                |
| ------------- | ----------------------------------------- |
| `DATABASE`    | `pg_dump`                                 |
| `CORE_CONFIG` | текущий + last-known-good конфиг sing-box |
| `FULL`        | БД + конфиг + метаданные                  |

Рекомендуемый порядок:

1. Создайте `FULL`.
2. Скачайте артефакт.
3. Перед restore сделайте ещё один свежий бэкап.
4. Restore только с `confirm: true` (роль **OWNER**).  
   Restore БД **перезаписывает** живое состояние панели.

Переменные: `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `BACKUP_ENCRYPT`.

---

## 6. Настройки системы

**System / Settings** → `GET/PATCH /api/admin/settings`.

- Telegram-токен пишется, но в ответах только флаг `*Configured` (секрет не возвращается).
- URL подписок в рантайме берётся из env `SUB_PUBLIC_BASE_URL` (значение в settings — операторская настройка UI; для продакшена держите env и settings согласованными).

---

## 7. Клиентские ссылки (кратко)

### Hysteria2

```text
hysteria2://PASSWORD@host:443/?sni=...&insecure=0&obfs=salamander&obfs-password=...#LABEL
```

### VLESS Reality

```text
vless://UUID@host:443?encryption=none&security=reality&sni=...&fp=chrome&pbk=...&sid=...&type=tcp&flow=xtls-rprx-vision#LABEL
```

### Trojan

```text
trojan://PASSWORD@host:443?security=tls&sni=...&allowInsecure=0&type=tcp#LABEL
```

### Shadowsocks 2022 (multi-user)

Пароль клиента:

```text
SERVER_PASSWORD:USER_PASSWORD
```

Ссылка SIP002: `ss://BASE64(method:password)@host:port#LABEL`.

---

## 8. Разработка без Compose (кратко)

```sh
pnpm install
pnpm prisma:generate
# .env: DATABASE_URL/REDIS_URL на localhost, пути к sing-box 1.13.14
pnpm migrate
pnpm bootstrap:admin
pnpm dev
```

Веб: http://localhost:5173 (прокси `/api` → `:3000`).

---

## 9. Важные ограничения sing-box

1. Трафик V2Ray API — **суммарный по пользователю**, не «пользователь × inbound».
2. Идентификация устройства онлайн — best-effort (часто `ip:адрес`).
3. Бинарник должен быть с `with_v2ray_api` / Clash / QUIC / ACME.
4. После SIGHUP счётчики пересоздаются; панель учитывает это через epoch/generation.
5. **Мульти-нода не поддерживается** (одна машина, один core).

---

## 10. Безопасность (чеклист)

- [ ] Все `REPLACE_*` заменены уникальными секретами
- [ ] `CORS_ORIGINS` — точные origin’ы, без `*`
- [ ] `SUB_PUBLIC_BASE_URL` — отдельный публичный HTTPS
- [ ] Postgres/Redis слушают только `127.0.0.1`
- [ ] Перед панелью — reverse proxy с TLS
- [ ] Владелец с сильным паролем + TOTP
- [ ] Регулярные `FULL` бэкапы

---

## 11. Полезные команды

```sh
pnpm compose-up / compose-pull / compose-build / compose-down
pnpm migrate
pnpm bootstrap:admin
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```
