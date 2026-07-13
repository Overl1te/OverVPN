<div align="center">

<img src="brand/logo.png" alt="OverVPN" width="120" height="120" />

# OverVPN

### Однонодовая панель управления VPN

Одна нода. Веб-админка. Подписки. Учёт трафика. Лимиты. Бэкапы.

[Документация](https://overl1te.github.io/OverVPN/) · [Установка](#-установка) · [Управление](#-управление) · [Панель](#-работа-в-панели) · [Подписки](#-подписки-клиентов) · [Contributing](CONTRIBUTING.md)

<br />

![Node.js](https://img.shields.io/badge/Node.js-24_LTS-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)

</div>

---

## Что это

OverVPN — **однонодовая** панель для выдачи доступа, подписок и учёта:

|               |                                                      |
| :------------ | :--------------------------------------------------- |
| **Протоколы** | Hysteria2 · VLESS Reality · Trojan · Shadowsocks     |
| **Панель**    | пользователи, inbound’ы, планы, онлайн-сессии, аудит |
| **Подписки**  | JSON · Clash Meta · список ссылок · QR               |
| **Учёт**      | трафик, сроки, лимиты устройств/IP, enforce          |
| **Операции**  | apply конфига с rollback · бэкапы · Telegram-алерты  |

Интерфейс по умолчанию на **русском** (переключатель EN/RU в шапке). Под капотом — [sing-box](https://sing-box.sagernet.org/) как VPN-ядро.

> [!IMPORTANT]
> Мульти-нода **не поддерживается**. Один сервер — одно ядро.

---

## Установка

### Требования

- **Ubuntu / Debian** (рекомендуется)
- Доступ `root` / `sudo`
- Свободные порты: `80`, `443` (и UDP `443` для VPN)
- DNS A-записи на IP сервера (если ставите с доменами)

### Одна команда

По умолчанию тянет **готовые образы из GHCR** — без долгой сборки на сервере:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/Overl1te/OverVPN/master/install.sh)" @ install
```

Локальная сборка образов на машине:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/Overl1te/OverVPN/master/install.sh)" @ install --build
```

<details>
<summary><strong>Флаги установщика</strong></summary>

| Флаг                    | Назначение                                   |
| ----------------------- | -------------------------------------------- |
| `--base-domain <host>`  | Базовый домен (лендинг + TLS)                |
| `--panel <host>`        | Хост панели                                  |
| `--subscription <spec>` | Хост или `хост/путь` для подписок            |
| `--vpn-host <host>`     | Публичный VPN-endpoint для клиентов          |
| `--email <email>`       | Let’s Encrypt                                |
| `--port <port>`         | Порт панели без домена (по умолчанию `8000`) |
| `--tag <tag>`           | Тег образов GHCR                             |
| `--build`               | Собрать образы локально                      |
| `--skip-dns`            | Не ждать DNS перед сертификатами             |
| `--no-nginx`            | Без Nginx/TLS                                |
| `--no-ufw`              | Не трогать UFW                               |

</details>

### Что спросит мастер

Сначала все вопросы — потом установка без пауз (можно отойти):

1. **Базовый домен** — публичная заглушка + TLS; пусто → режим `http://IP:8000`
2. **Панель** — по умолчанию `panel.example.com`
3. **Подписки** — хост или `хост/путь`, по умолчанию `sub.example.com`
4. **VPN-хост** — по умолчанию `vpn.example.com` (endpoint клиентов, не панель)
5. **Email** для Let’s Encrypt
6. Подтверждение DNS A-записей (или `s` — пропустить проверку)

Дальше скрипт ждёт DNS (до ~15 мин), ставит Docker, образы, Nginx и сертификаты.

### После установки

```bash
overvpn info      # URL панели, подписки, логин владельца
overvpn status    # состояние контейнеров
```

Откройте URL панели и войдите логином/паролем из `overvpn info`.

---

## Управление

CLI ставится вместе с панелью:

```bash
overvpn status                 # Docker Compose status
overvpn logs                   # все сервисы
overvpn logs api               # только API
overvpn info                   # URL, хосты, bootstrap-учётка
overvpn edit                   # открыть .env в $EDITOR
overvpn restart                # перезапуск стека
overvpn update                 # pull новых образов из GHCR
overvpn update --build         # пересобрать локально
overvpn nginx                  # пересобрать Nginx/сертификаты из конфига установки
overvpn bootstrap              # пересоздать/обновить владельца из .env
overvpn up | down              # поднять / остановить
overvpn uninstall              # удалить установку
```

### Порты

| Компонент       | По умолчанию                            |
| --------------- | --------------------------------------- |
| Веб-панель      | `8000` (без домена) / `443` через Nginx |
| API             | внутри Compose; наружу через веб/прокси |
| PostgreSQL      | `5432` → только `127.0.0.1`             |
| Redis           | `6379` → только `127.0.0.1`             |
| VPN UDP inbound | `443`                                   |

> [!WARNING]
> Не публикуйте Postgres, Redis и API напрямую в интернет. Панель — за Nginx с TLS.

---

## Работа в панели

### 1. Создать inbound

1. **Inbounds** → создать протокол (Hysteria2 / VLESS Reality / Trojan / Shadowsocks).
2. Укажите `tag`, listen / public host и port.
3. TLS-файлы кладите в каталог сертификатов ядра (`deploy/sing-box/certs`, в контейнере — `/var/lib/sing-box-certs`).

При установке **с доменами и Nginx** установщик сам копирует Let’s Encrypt сертификаты в этот каталог и выставляет `VPN_TLS_*` — новый inbound по умолчанию использует **FILES** (не встроенный ACME). Встроенный ACME за Nginx на 80/443 без отдельного прокси challenge не работает. 4. После сохранения панель **сразу** применяет конфиг: validate → write → reload → verify → **rollback** при ошибке.

`SING_BOX_UDP_PORT` в `.env` должен совпадать с портом inbound’а, который вы отдаёте наружу.

### 2. Создать пользователя

1. **Users** → имя, лимит трафика, срок (`expireAt`), лимиты устройств/IP.
2. Назначьте inbound (assignments) — появятся учётные данные протокола.
3. Скопируйте **subscription URL** или QR со страницы пользователя.

| Статус     | Смысл                   |
| ---------- | ----------------------- |
| `ACTIVE`   | доступ разрешён         |
| `DISABLED` | выключен вручную        |
| `EXPIRED`  | истёк срок              |
| `LIMITED`  | квота / устройство / IP |

Причина отключения видна в UI (`statusReason`).

### 3. Применить конфиг вручную

**Config** → Preview (diff без секретов) → Apply с причиной.

История применений — там же. При сбое восстанавливается предыдущий конфиг.

### 4. Мониторинг

- **Dashboard** — онлайн, статусы, здоровье ядра, воркеры, throughput
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

Заголовки ответа (где применимо): `subscription-userinfo`, `profile-update-interval`.

**Ротация токена** (старый URL сразу мёртв, VPN-пароли не меняются):

- в UI — действие rotate-sub
- API — `POST /api/admin/users/:id/rotate-sub`

Не светите токен в тикетах, скриншотах и логах прокси.

<details>
<summary><strong>Примеры клиентских URI</strong></summary>

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
SIP002: `ss://BASE64(method:password)@host:port#LABEL`

</details>

---

## Ручной запуск (Docker)

Если ставите не через `install.sh`, а сами на Compose:

### 1. Конфиг

```bash
cp .env.example .env
```

Замените **все** `REPLACE_*`. Секреты генерируйте независимо:

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

- Панель: **http://localhost:8080**
- OpenAPI (если `SWAGGER_ENABLED=true`): **http://localhost:8080/api/docs**

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
ГАРАНТИЙ**. Полный текст — в файле [`LICENSE`](LICENSE).

Исходники: https://github.com/Overl1te/OverVPN

---

<div align="center">

**OverVPN** · single-node VPN control panel

</div>
