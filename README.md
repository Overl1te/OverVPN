# OverVPN

### Панель-оркестратор + прокси-ноды VPN

Панель управляет пользователями, планами, точками входа и прокси-серверами. VPN data plane (sing-box / Xray / MTProxy) работает на прокси-нодах с агентом — на том же сервере или отдельно.

[Документация](https://overl1te.github.io/OverVPN/) · [Установка](#-установка) · [Управление](#-управление) · [Панель](#-работа-в-панели) · [Подписки](#-подписки-клиентов) · [Contributing](CONTRIBUTING.md)

[CI](https://github.com/Overl1te/OverVPN/actions/workflows/ci.yml)
[Docs](https://github.com/Overl1te/OverVPN/actions/workflows/docs.yml)
[Stars](https://github.com/Overl1te/OverVPN/stargazers)
[Last commit](https://github.com/Overl1te/OverVPN/commits/main)
Node.js
Docker
[License](LICENSE)

---

## Что это

OverVPN — панель (control plane) для выдачи доступа, подписок и учёта, плюс отдельно устанавливаемые **прокси-ноды** (data plane):

|               |                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------- |
| **Протоколы** | Hysteria2 · VLESS Reality · Trojan · Shadowsocks · WireGuard · Xray TLS/SS/WireGuard · MTProxy |
| **Панель**    | пользователи, inbound’ы, планы, прокси-серверы, онлайн-сессии, аудит                           |
| **Подписки**  | JSON · Clash Meta · список ссылок · QR                                                         |
| **Учёт**      | трафик, сроки, лимиты устройств/IP, enforce                                                    |
| **Операции**  | apply конфига на ноды · бэкапы панели · Telegram-алерты                                        |

Интерфейс по умолчанию на **русском** (переключатель EN/RU в шапке). Data plane — независимые ядра: [sing-box](https://sing-box.sagernet.org/), [Xray-core](https://github.com/XTLS/Xray-core) и опционально MTProxy на [Telemt](https://github.com/telemt/telemt) (образ [`whn0thacked/telemt-docker`](https://hub.docker.com/r/whn0thacked/telemt-docker)).

> [!IMPORTANT]
> Панель и прокси связаны **hybrid HTTP API** (агент ↔ панель). При `overvpn install` по умолчанию ставится локальный прокси на том же хосте. Удалённая нода: в панели «Прокси» → install-command → `overvpn install-proxy --panel-url … --token … --node-id …`.

### Dual cores + MTProxy

Ядра включаются через Compose profiles (`singbox`, `xray`, `mtproxy`) и флаги `SING_BOX_ENABLED` / `XRAY_ENABLED` / `MTPROXY_ENABLED`. Простая установка поднимает оба data-plane ядра + MTProxy; детальная — только ядра под выбранные протоколы. Доустановка: `overvpn enable-core singbox|xray|mtproxy`.

| Зона     | Engine     | Протоколы                                                                                    | Compose service / profile  |
| -------- | ---------- | -------------------------------------------------------------------------------------------- | -------------------------- |
| Sing-box | `SING_BOX` | HYSTERIA2, VLESS_REALITY, TROJAN, SHADOWSOCKS, WIREGUARD                                     | `core` (`singbox`)         |
| Xray     | `XRAY`     | VLESS_XHTTP_TLS, VLESS_GRPC_TLS, VLESS_TCP_TLS, TROJAN_TLS, SHADOWSOCKS_XRAY, WIREGUARD_XRAY | `core-xray` (`xray`)       |
| MTProxy  | `MTPROXY`  | MTPROXY (до 16 inbound’ов, secret на пользователя)                                           | `core-mtproxy` (`mtproxy`) |

Общее: Postgres, Redis, API, web, один subscription URL, учёт пользователя. Порты VPN-listen не должны пересекаться между inbound’ами. По умолчанию Xray публикует TCP `8443` (при Nginx install — `9443`, чтобы не конфликтовать с ACME `8443`). MTProxy (если включён) публикует диапазон TCP `10001–10016`. WireGuard: UDP `51820` (sing-box) / `51821` (Xray).

Ссылки MTProxy выдаются **только в панели** (карточка пользователя) — в subscription formats (`sing-box` / `clash` / `links`) они не попадают.

Ограничения подписок: Xray xHTTP может пропускаться в client `sing-box` JSON; Clash Meta — best-effort; WireGuard — надёжнее через sing-box/Clash профили, `wg://` в links — best-effort. Per-user WG traffic stats зависят от возможностей ядра.

---

## Установка

### Требования

- **Ubuntu / Debian** (рекомендуется)
- Доступ `root` / `sudo`
- Свободные порты: `80`, `443` (и UDP `443` для VPN); при установке MTProxy — ещё TCP `10001–10016`
- DNS A-записи на IP сервера (если ставите с доменами)

### Одна команда

По умолчанию тянет **готовые образы из GHCR** — без долгой сборки на сервере:

```bash
curl -fsSL https://raw.githubusercontent.com/Overl1te/OverVPN/main/install.sh -o /tmp/overvpn-install.sh && sudo bash /tmp/overvpn-install.sh @ install
```

Локальная сборка образов на машине:

```bash
curl -fsSL https://raw.githubusercontent.com/Overl1te/OverVPN/main/install.sh -o /tmp/overvpn-install.sh && sudo bash /tmp/overvpn-install.sh @ install --build
```

**Флаги установщика**

| Флаг                           | Назначение                                           |
| ------------------------------ | ---------------------------------------------------- |
| `--simple` / `--detailed`      | Простой или детальный мастер                         |
| `--protocols <list>`           | Список протоколов (детальный / non-interactive)      |
| `--cores singbox,xray,mtproxy` | Ядра (без `--protocols` → все протоколы ядер)        |
| `--ports key=value,…`          | Порты протоколов (`hysteria2=443`, `wg=51820`, …)    |
| `--create-default-inbounds`    | Opt-in: создать inbound на каждый выбранный протокол |
| `--no-default-inbounds`        | Не создавать стартовые inbound’ы (по умолчанию)      |
| `--base-domain <host>`         | Базовый домен (лендинг + TLS)                        |
| `--panel <host>`               | Хост панели                                          |
| `--subscription <spec>`        | Хост или `хост/путь` для подписок                    |
| `--vpn-host <host>`            | Публичный VPN-endpoint для клиентов                  |
| `--email <email>`              | Let’s Encrypt                                        |
| `--port <port>`                | Порт панели без домена (по умолчанию `8000`)         |
| `--tag <tag>`                  | Тег образов GHCR                                     |
| `--build`                      | Собрать образы локально                              |
| `--with-mtproxy`               | Включить MTProxy / Telemt (по умолчанию в simple)    |
| `--without-mtproxy`            | Не ставить MTProxy                                   |
| `--skip-dns`                   | Не ждать DNS перед сертификатами                     |
| `--no-nginx`                   | Без Nginx/TLS                                        |
| `--no-ufw`                     | Не трогать UFW                                       |

### Что спросит мастер

Мастер — **консольные экраны** (clear + баннер + рамка). Навигация: **стрелки ↑/↓** и **Enter** (цифры — быстрый выбор). Сначала все ответы, потом установка без пауз:

1. **Язык** — English / Русский
2. **Глубина** — простая (как раньше) или детальная (протоколы → ядра → порты)
3. **Режим** — с доменом (Nginx + TLS) или только IP (`http://IP:8000`)
4. **Домены** — базовый, панель, подписки, VPN-хост, email Let’s Encrypt
5. **DNS** — список A-записей; проверить сейчас (ожидание до ~15 мин) или пропустить
6. **Simple:** MTProxy да/нет · **Detailed:** чеклист протоколов, пресет портов, порты, UFW (default inbounds — только по явному согласию, по умолчанию нет)
7. **Подтверждение** — summary и старт

Дальше скрипт без пауз ставит Docker, образы, Nginx и сертификаты. В конце — экран с URL и логином владельца.

### После установки

```bash
overvpn            # интерактивное меню управления
overvpn info       # URL панели, подписки, логин владельца
overvpn status     # состояние контейнеров
```

Откройте URL панели и войдите логином/паролем из меню **Info** или `overvpn info`.

---

## Управление

CLI ставится вместе с панелью. Без аргументов (в TTY) открывается **консольное меню** (↑/↓ и Enter); те же действия доступны командами:

```bash
overvpn                        # меню: status / info / logs / update / …
overvpn status                 # Docker Compose status
overvpn logs                   # все сервисы
overvpn logs api               # только API
overvpn info                   # URL, хосты, bootstrap-учётка
overvpn edit                   # открыть .env в $EDITOR
overvpn enable-core singbox|xray|mtproxy   # доустановить ядро
overvpn disable-core singbox|xray|mtproxy  # отключить (если нет inbound’ов)
overvpn restart                # перезапуск стека
overvpn check-update           # есть ли новый образ в GHCR (без установки)
overvpn update                 # pull новых образов из GHCR
overvpn update --build         # пересобрать локально
overvpn nginx                  # пересобрать Nginx/сертификаты из конфига установки
overvpn bootstrap              # пересоздать/обновить владельца из .env
overvpn up | down              # поднять / остановить
overvpn uninstall              # удалить установку
```

Панель (Система → ядра) показывает статус engines и копируемую команду `enable-core`. Применение профилей — только на хосте.

### Порты

| Компонент         | По умолчанию                                                       |
| ----------------- | ------------------------------------------------------------------ |
| Веб-панель        | `8000` (без домена) / `443` через Nginx                            |
| API               | внутри Compose; наружу через веб/прокси                            |
| PostgreSQL        | `5432` → только `127.0.0.1`                                        |
| Redis             | `6379` → только `127.0.0.1`                                        |
| VPN UDP inbound   | `SING_BOX_UDP_PORT` (по умолчанию `443`) — Hysteria2               |
| VPN TCP Reality   | `SING_BOX_TCP_PORT` (по умолчанию `4443`)                          |
| VPN TCP Trojan    | `SING_BOX_TROJAN_PORT` (по умолчанию `8444`)                       |
| VPN TCP SS        | `SING_BOX_SS_PORT` (по умолчанию `8445`)                           |
| VPN UDP WireGuard | `SING_BOX_WG_PORT` (по умолчанию `51820`)                          |
| VPN Xray xHTTP    | `XRAY_LISTEN_PORT` (по умолчанию `8443` / `9443` с Nginx)          |
| VPN Xray gRPC     | `XRAY_GRPC_PORT` (по умолчанию `8446` / `9446` с Nginx)            |
| VPN Xray TCP TLS  | `XRAY_TCP_TLS_PORT` (по умолчанию `8447` / `9447` с Nginx)         |
| VPN Xray Trojan   | `XRAY_TROJAN_PORT` (по умолчанию `8448` / `9448` с Nginx)          |
| VPN Xray SS       | `XRAY_SS_PORT` (по умолчанию `8449` / `9449` с Nginx)              |
| VPN Xray WG       | `XRAY_WG_PORT` (по умолчанию `51821`)                              |
| MTProxy TCP       | `MTPROXY_PORT_MIN`–`MTPROXY_PORT_MAX` (по умолчанию `10001–10016`) |

> [!WARNING]
> Не публикуйте Postgres, Redis и API напрямую в интернет. Панель — за Nginx с TLS.

---

## Работа в панели

### 1. Создать inbound

1. **Inbounds** → создать протокол (Hysteria2 / VLESS Reality / Trojan / Shadowsocks / WireGuard / Xray VLESS, Trojan TLS, Shadowsocks или WireGuard / MTProxy).
2. Укажите `tag`, listen / public host и port.
3. TLS-файлы кладите в каталог сертификатов ядра (`deploy/sing-box/certs`, в контейнере — `/var/lib/sing-box-certs`).

При установке **с доменами и Nginx** установщик сам копирует Let’s Encrypt сертификаты в этот каталог и выставляет `VPN_TLS_`* — новый inbound по умолчанию использует **FILES** (не встроенный ACME). Встроенный ACME за Nginx на 80/443 без отдельного прокси challenge не работает. 4. После сохранения панель **сразу** применяет конфиг: validate → write → reload → verify → **rollback** при ошибке.

Порты в режиме **Простой** подставляются из установки: `SING_BOX_UDP_PORT` (Hysteria2), `SING_BOX_TCP_PORT` (Reality), `SING_BOX_TROJAN_PORT` (Trojan), `SING_BOX_SS_PORT` (Shadowsocks), `SING_BOX_WG_PORT` (WireGuard), `XRAY_LISTEN_PORT` (xHTTP), `XRAY_GRPC_PORT` (gRPC), `XRAY_TCP_TLS_PORT` (TCP TLS), `XRAY_TROJAN_PORT`, `XRAY_SS_PORT`, `XRAY_WG_PORT`, `MTPROXY_PORT_MIN`…`MAX` (MTProxy). Не выбирайте другие порты без правки `.env` и publish в Compose.

### 2. Создать план и пользователя

1. **Plans** → создать план и привязать хотя бы одну точку входа (иначе подписка будет пустой).
2. **Users** → имя и план. Срок, лимиты и назначения inbound’ов берутся из плана автоматически.
3. Скопируйте **subscription URL** или QR со страницы пользователя.

| Статус     | Смысл              |
| ---------- | ------------------ |
| `ACTIVE`   | доступ разрешён    |
| `DISABLED` | выключен вручную   |
| `EXPIRED`  | истёк срок         |
| `LIMITED`  | квота / устройства |

Лимит устройств = максимум **одновременных** онлайн-клиентов. Без HWID «устройство» ≈ публичный source IP. Смена сети ок, если онлайн одно соединение; ПК + телефон вместе при лимите 1 — нет. При превышении статус `LIMITED` удерживается минимум `IDENTITY_LIMIT_HOLD_MS` (по умолчанию 15 мин). Отдельный лимит IP не применяется. В карточке пользователя — статистика IP за `IDENTITY_LOOKBACK_MS` (только обзор, не enforcement).

Причина отключения видна в UI (`statusReason`).

### 3. Применить конфиг вручную

**Config** → Preview (diff без секретов) → Apply с причиной.

История применений — там же. При сбое восстанавливается предыдущий конфиг.

### 4. Мониторинг

- **Dashboard** — CPU / RAM / сеть, онлайн, статусы, здоровье ядра, воркеры, throughput
- **Online sessions** — активные и исторические сессии
- **Audit** — журнал действий администраторов

### 5. Роли

| Роль       | Права                                                       |
| ---------- | ----------------------------------------------------------- |
| `OWNER`    | полный доступ, удаление пользователей, restore бэкапов      |
| `ADMIN`    | обычные мутации (users / inbounds / apply / backups create) |
| `READONLY` | только чтение; мутации скрыты                               |

В профиле можно включить **TOTP 2FA** (enable → confirm кодом).

### 6. Бэкапы

Раздел **Backups**:

| Тип           | Содержимое                            |
| ------------- | ------------------------------------- |
| `DATABASE`    | `pg_dump`                             |
| `CORE_CONFIG` | текущий + last-known-good конфиг ядра |
| `FULL`        | БД + конфиг + метаданные              |

Рекомендуемый порядок:

1. Создайте `FULL` и скачайте артефакт.
2. Перед restore сделайте ещё один свежий бэкап.
3. Restore только с подтверждением (`confirm: true`) и ролью **OWNER**.

> Restore БД **перезаписывает** живое состояние панели.

### 7. Настройки

**System / Settings** — Telegram, операторские параметры UI и т.д.

Публичный URL подписок в рантайме берётся из env `SUB_PUBLIC_BASE_URL`. Значение в settings держите согласованным с env.

---

## Подписки клиентов

### URL

Origin без пути:

```text
{SUB_PUBLIC_BASE_URL}/api/sub/{TOKEN}
```

С путём в base URL (например `https://example.com/sub`):

```text
{SUB_PUBLIC_BASE_URL}/{TOKEN}
```

### Форматы

```bash
# JSON-профиль (по умолчанию)
curl -o profile.json "$SUB_URL?format=sing-box"

# список ссылок
curl -o links.txt "$SUB_URL?format=links"

# Clash Meta / Mihomo YAML
curl -o clash.yaml "$SUB_URL?format=clash"

# статус без секретов
curl "$SUB_URL/info"
```

Заголовки ответа (где применимо): `subscription-userinfo`, `profile-update-interval`, `profile-title`, опционально `announce`, `support-url`, `profile-web-page-url`, а также Happ advanced: `providerid`, `sub-info-*`, `sub-expire*`, `fallback-url`, `color-profile`. Для `?format=links` те же параметры дублируются `#`-строками в body.

Кастомизация брендинга:

- **План** — шаблон названия, announce, support/Telegram, info page, показ лимитов трафика (`total=` / ∞), Happ Provider ID, info-блок с кнопкой, renew при истечении, fallback URL и color-profile (`{username}`, `{used}`, `{limit}`, `{expire}`, `{token}`, `{subscriptionUrl}`, …). Расширенные Happ-поля редактируются и отдаются только при указанном Provider ID.
- **Точка входа** — шаблон имени подключения для всех форматов (`{identity}`, `{tag}`, `{protocol}`, …). Эмодзи допускаются. Пустые поля = прежние дефолты (`OverVPN - {username}`, `{identity} - {tag}`).

**Ротация токена** (старый URL сразу мёртв, VPN-пароли не меняются):

- в UI — действие rotate-sub
- API — `POST /api/admin/users/:id/rotate-sub`

Не светите токен в тикетах, скриншотах и логах прокси.

**Примеры клиентских URI**

**Hysteria2**

```text
hysteria2://PASSWORD@host:443/?sni=...&insecure=0&obfs=salamander&obfs-password=...#LABEL
```

**VLESS Reality**

```text
vless://UUID@host:443?encryption=none&security=reality&sni=...&fp=chrome&pbk=...&sid=...&type=tcp&flow=xtls-rprx-vision#LABEL
```

**Trojan**

```text
trojan://PASSWORD@host:443?security=tls&sni=...&allowInsecure=0&type=tcp#LABEL
```

**Shadowsocks 2022** — пароль клиента: `SERVER_PASSWORD:USER_PASSWORD`

**WireGuard** — серверные и клиентские X25519-ключи создаются автоматически, а адрес
клиента хранится в его assignment credential. Учёт трафика на пользователя может быть
ограничен возможностями статистики конкретного ядра; inbound-счётчики остаются доступны.
SIP002: `ss://BASE64(method:password)@host:port#LABEL`

---

## Ручной запуск (Docker)

Если ставите не через `install.sh`, а сами на Compose:

### 1. Конфиг

```bash
cp .env.example .env
```

Замените **все** `REPLACE_`*. Секреты генерируйте независимо:

```bash
openssl rand -hex 32          # пароли / JWT / Clash API
openssl rand -hex 32          # SECRETS_MASTER_KEY — ровно 64 hex
openssl rand -base64 36       # пароль владельца (≥ 16 символов)
```

Обязательно:

| Переменная                                          | Зачем                                    |
| --------------------------------------------------- | ---------------------------------------- |
| `POSTGRES_PASSWORD` / `DATABASE_URL`                | БД (пароль в URL = пароль Postgres)      |
| `REDIS_PASSWORD` / `REDIS_URL`                      | Redis                                    |
| `JWT_ACCESS_SECRET`                                 | подпись access JWT                       |
| `SECRETS_MASTER_KEY`                                | шифрование секретов протоколов и бэкапов |
| `SING_BOX_CLASH_API_SECRET`                         | внутренний Clash API                     |
| `BOOTSTRAP_ADMIN_USER` / `BOOTSTRAP_ADMIN_PASSWORD` | первый владелец                          |
| `CORS_ORIGINS`                                      | точный origin панели                     |
| `SUB_PUBLIC_BASE_URL`                               | публичный HTTPS URL подписок             |

Локально можно временно:

```env
CORS_ORIGINS=http://localhost:8080
SUB_PUBLIC_BASE_URL=http://localhost:8080
AUTH_COOKIE_SECURE=false
```

В проде: `AUTH_COOKIE_SECURE=true` и реальные HTTPS-origin’ы.

### 2. Старт

```bash
pnpm compose-up        # образы из GHCR
# или:
pnpm compose-build     # локальная сборка
```

### 3. Владелец

```bash
docker compose --env-file .env -f deploy/docker-compose.yml --profile tools run --rm bootstrap-admin
```

Идемпотентно: повторный запуск обновит пароль владельца из env.

### 4. Вход

- Панель: **[http://localhost:8080](http://localhost:8080)**
- OpenAPI (если `SWAGGER_ENABLED=true`): **[http://localhost:8080/api/docs](http://localhost:8080/api/docs)**

```bash
curl -s http://localhost:8080/api/health
curl -s http://localhost:8080/api/health/ready
```

Остановка: `pnpm compose-down`.

---

## Безопасность

- [ ] Все `REPLACE_*` заменены уникальными секретами
- [ ] `CORS_ORIGINS` — точные origin’ы, без `*`
- [ ] `SUB_PUBLIC_BASE_URL` — отдельный публичный HTTPS
- [ ] Postgres / Redis слушают только `127.0.0.1`
- [ ] Перед панелью — reverse proxy с TLS
- [ ] Владелец с сильным паролем + TOTP
- [ ] Регулярные `FULL` бэкапы

---

## Ограничения

1. Трафик через stats API — **суммарный по пользователю**, не «пользователь × inbound».
2. Идентификация устройства онлайн — best-effort (часто `ip:порт`).
3. После reload счётчики ядра пересоздаются; панель учитывает это через epoch/generation.
4. **Одна машина, одно ядро** — мульти-нода вне скоупа.

---

## Документация для разработчиков

Стек, архитектура модулей, воркеры, миграции, CI и локальная разработка без Compose — в **[CONTRIBUTING.md](CONTRIBUTING.md)**.

---

## Лицензия

Copyright (C) 2026 Overl1te

OverVPN — свободное ПО: его можно распространять и/или изменять на условиях
[GNU Affero General Public License v3](LICENSE) (только версия 3, без «or later»).

Программа распространяется в надежде, что будет полезной, но **БЕЗ КАКИХ-ЛИБО
ГАРАНТИЙ**. Полный текст — в файле `[LICENSE](LICENSE)`.

Исходники: [https://github.com/Overl1te/OverVPN](https://github.com/Overl1te/OverVPN)

---

**OverVPN** · panel orchestrator + proxy nodes
