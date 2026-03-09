---
status: complete
last_updated: 2026-03-04
---

# Runbook: Running Frontend3 (F3) Locally

This guide explains how to start F3 locally for development, including the B2B Search POC endpoint.

## Prerequisites

- Docker Desktop installed and running
- VPN connected (only required for DB import from production; not required to start F3 itself)
- SSH key added to Bitbucket (for initial clone; already done if you have the `docker-local-env` folder)
- The `frontend3` repo is already present at `docker-local-env/frontend3/`

---

## How the Docker Setup Works

Understanding this prevents confusion:

| Component | Source |
|-----------|--------|
| **PHP runtime** (PHP 8.4, PHP-FPM, extensions) | Pulled from `registry.12go.asia/local-frontend3:8.4` (12go private registry) |
| **Application code** | Mounted from your local `./frontend3/` directory as a live volume |
| **Composer dependencies** | Installed inside the container via `12go make front3` |

**Key point**: You do **not** need to rebuild the Docker image when you change PHP code. Local file changes are reflected in the container immediately. You only re-run `12go make front3` when `composer.json` changes (new packages added).

The nginx config routes `frontend3.12go.local` → nginx → PHP-FPM container (port 9000) → Symfony `public/index.php`.

---

## Starting F3

```bash
cd /Users/sosotughushi/RiderProjects/12go/docker-local-env
```

### Step 1 — Start all containers

```bash
./12go.sh start
# or if you have the alias set up: 12go start
```

This starts the `frontend3` container along with its dependencies: `db` (MariaDB), `redis`, `mongodb`, `memcachef3`, `beanstalkd`, and `nginx`.

### Step 2 — Install Composer dependencies (first time or after composer.json changes)

```bash
./12go.sh make front3
```

This runs `composer install` inside the running `frontend3` container. Required on first run and when packages change. Expected to take 1-3 minutes.

### Step 3 — Update your hosts file (first time only)

```bash
sudo ./update_hosts.sh
```

### Step 4 — Install CA certificates (first time only, for HTTPS)

```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ./docker/nginx/CA/12goAsiaCA_2024.crt
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ./docker/nginx/CA/12go.local.crt
```

Without this step, your browser will show a certificate warning for all `*.12go.local` domains.

---

## Accessing F3

| What | URL |
|------|-----|
| Frontend3 app | https://frontend3.12go.local:8443 |
| Main 12go website | https://12go.local:8443 |
| Admin login | admin@12go.dev / admin |

> **Note**: Nginx uses port **8443** (not 443) in this setup. Always use `:8443` when accessing local URLs.

---

## B2B Search Endpoint (POC)

Once F3 is running with Composer installed, the B2B Search endpoint is available at:

```
GET https://frontend3.12go.local:8443/b2b/v1/{clientId}/itineraries
```

### Example request

```
GET https://frontend3.12go.local:8443/b2b/v1/test_client/itineraries
  ?departure_date=2026-04-01
  &departure_poi=1
  &arrival_poi=44
  &pax=1
```

### Query parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `departure_date` | Yes | `YYYY-MM-DD` format |
| `departure_poi` | Yes* | 12go departure POI/place ID (use `departure_poi` or `departures[]`) |
| `arrival_poi` | Yes* | 12go arrival POI/place ID (use `arrival_poi` or `arrivals[]`) |
| `departures[]` | Yes* | Array of Fuji station IDs (alternative to `departure_poi`) |
| `arrivals[]` | Yes* | Array of Fuji station IDs (alternative to `arrival_poi`) |
| `pax` | No | Number of passengers (default: 1) |
| `currency` | No | Currency code (e.g. `USD`) |
| `locale` | No | Locale (e.g. `en`) |

*Either POI or station ID array must be provided.

### Response codes

| Code | Meaning |
|------|---------|
| `200 OK` | Full results returned |
| `206 Partial Content` | Partial results; recheck URLs present in response |
| `400 Bad Request` | Missing or invalid parameters |

### Authorization (POC bypass)

The B2B Search endpoint uses route options `no_auth: true` and `without_agent: true` to bypass F3's global `AuthenticationListener`. No token or API key is required for local testing.

**Where auth is read** (in `AuthenticationListener`, not in the B2B controller):

| Source | Purpose |
|-------|---------|
| `?k=...` (query) or `Authorization: Key {key}` | API key → validates against DB, sets agent |
| `?a=1` (query) | Agent ID → used when no API key |
| `Authorization: Bearer {token}` | User token → if user is agent, sets agent |
| `Token` header | Session token (when `no_auth` is false) |

The B2B controller does **not** read any token. Auth is enforced globally before the controller runs. To bypass for POC, the route has `without_agent: true` so the listener skips the agent-ID check.

---

## Running Unit Tests

```bash
docker exec docker-local-env-frontend3-1 ./vendor/bin/phpunit tests/Unit/B2bApi/
```

To run all unit tests:

```bash
docker exec docker-local-env-frontend3-1 ./vendor/bin/phpunit tests/Unit/
```

---

## Useful Commands

```bash
# Check container status
docker ps | grep frontend3

# View F3 logs
./12go.sh logs frontend3

# Open a shell inside the F3 container
./12go.sh bash frontend3

# Clear cache
./12go.sh drop cache

# Restart only the frontend3 container (without stopping all others)
docker restart docker-local-env-frontend3-1

# Rebuild the Docker image (only needed if Dockerfile changes — rare)
./12go.sh make docker
```

---

## Troubleshooting

### Container exits immediately

```bash
docker logs docker-local-env-frontend3-1
```

Common causes: PHP-FPM config error, missing `.env.local`, or missing Composer packages.

### 502 Bad Gateway from nginx

The PHP-FPM container may have crashed or not finished starting. Run:
```bash
docker ps | grep frontend3
# if status is "Exited":
docker start docker-local-env-frontend3-1
```

### Route not found (404 on `/b2b/...`)

Check that `config/routes/annotations.yaml` has the `b2b_api` entry:
```yaml
b2b_api:
    resource: ../../src/B2bApi/Controller/
    type: annotation
    prefix: /b2b
```

Then clear the Symfony cache inside the container:
```bash
docker exec docker-local-env-frontend3-1 php bin/console cache:clear
```

### Composer install fails (timeout / GitHub rate limit)

```bash
./12go.sh bash frontend3
composer config process-timeout 600
composer install
exit
```

### Registry login required

If Docker cannot pull `registry.12go.asia/local-frontend3:8.4`:
```bash
docker login registry.12go.asia
# Credentials: ask in #it-devops on Slack
```

---

## Related Docs

- [POC Plan](../design/poc-plan.md)
- [Search endpoint contract](../current-state/endpoints/search.md)
