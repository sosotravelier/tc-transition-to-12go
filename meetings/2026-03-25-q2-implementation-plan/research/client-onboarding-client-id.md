# Client Onboarding & Client ID — Research

**Context**: Shauly flagged "client onboarding client ID" as a gap in the Q2 presentation. This document investigates how client identity works today, what exists in F3, and what needs to be built for Q2.

---

## 1. How It Works Today (Current .NET System)

### Dual Identity Mechanism

Clients are identified via two things:
- **`client_id`** embedded in URL path: `/v1/{client_id}/bookings`
- **`x-api-key`** HTTP header for authentication

The `client_id` is a human-readable string like `"bookaway"`, `"comport"`, `"orians"`. ~20–30 active client IDs exist in production.

### Where Client Records Live

**David's Client Identity Service** (`connect.platform-services.client-identity`) manages:

| Table | Fields | Purpose |
|-------|--------|---------|
| `ClientEntities` | `Id` (string PK, e.g. "bookaway"), `IsSubsidiary`, `OwnerId`, `Enabled` | Client master record |
| `ClientIdentityEntities` | `ClientId` (FK), `ApiKey` (PBKDF2 hash), `ExpiresAt`, salt/algo params | API key bindings |

### How New Clients Get Provisioned Today

Two paths:
1. **Kafka event**: `ClientCreatedMessageHandler` subscribes to `ClientCreated` topic → creates `ClientEntity`
2. **Manual HTTP**: `POST /api/client/create-client-manually`

API key generation:
1. `ApiKeyService` calls **AWS API Gateway** `CreateApiKey` API
2. Key attached to a usage plan
3. Key hashed with PBKDF2 and stored in `ClientIdentityEntities`

### How client_id Flows Through the System

```
Search:   GET /v1/{client_id}/itineraries
          → extract client_id from URL
          → lookup per-client 12go API key from AppConfig
          → call 12go with ?k=<per_client_api_key>

Booking:  POST /v{version}/{client_id}/bookings
          → extract client_id → pass via IConnectContextAccessor
          → embed in BookingId struct
          → used for per-client feature flags, metrics, logging

Notifications:  12go webhook arrives with {bid}
                → lookup booking in BookingCache
                → resolve client_id from cached booking
                → route to client's webhook URL
```

**Per-client config is scattered** across 3+ stores:
- `BookingApi:12GoApiKey:<clientId>` in AWS AppConfig (booking-service)
- `Connector:OneTwoGo:Clients:<CLIENT_ID>-<GUID>:ApiKey` in AWS AppConfig (etna/search)
- `SiContractClientCredentials` in PostgreSQL (supply-integration)

---

## 2. What Exists in F3 Today

### Authentication

F3 has API key authentication via legacy `apikey` table:
- Keys sent as `?k=<key>`, `Authorization: Key <key>`, or `X-Api-Key` header
- Validated in `AuthenticationListener.php` (lines 74-91)
- Lookup: `apikey` table → `usr_id` + `role_id` + `active` flag
- Rate limiting per API key via `apikey_rate_limit` table + Redis sliding window
- Cache-backed with 1-hour TTL

**Source**: `frontend3/src/EventListener/AuthenticationListener.php`, `frontend3/src/Core/Repository/ApiKeyRepository.php`

### Partner/Agent Model

F3 recognizes two partner roles:
- `partner` (full access)
- `partner_light` (limited access)

Defined in `frontend3/src/Core/Service/ApiAgent.php` (lines 10-16).

Partners are entries in the `usr` table with a partner role. The `WhiteLabel` service maps domains to partner configs.

### B2B Module (Search POC — ST-2432)

The existing B2B search endpoint accepts `clientId` in the URL:
```
GET /v1/{clientId}/itineraries
```

**But**: `clientId` is **not validated** — it's passed through as a route parameter with no database lookup, no access control check, no client existence verification.

**Source**: `frontend3/src/B2bApi/Controller/SearchController.php` (lines 25-26), `frontend3/src/B2bApi/DTO/Request/SearchRequest.php`

### What F3 Does NOT Have

- No `clients` or `b2b_partners` table
- No client provisioning/registration workflow
- No client-to-API-key binding (beyond the generic `apikey` → `usr_id` relation)
- No webhook subscriber table for outbound client notifications
- No per-client configuration store

---

## 3. The Gap: What's Missing for Q2

### 12go Has No "Client ID" Concept

12go uses `agent`/`user` accounts (`usr` table) with associated API keys. There is no `client_id` field. When we say "onboard a new B2B client," 12go sees it as "create a new agent user with a partner role and an API key."

### What Needs to Exist for a New Client to Use the B2B API

| Concern | What's Needed | Exists? |
|---------|---------------|---------|
| **Client record** | A table storing client_id, name, enabled flag | No |
| **API key binding** | Map API key → client_id for authentication | Partial — F3 has `apikey` → `usr_id`, but no `client_id` concept |
| **Client validation** | B2B endpoints check that client_id exists and is active | No — currently passthrough |
| **Per-client config** | Client-specific settings (webhook URL, HMAC key, features) | No |
| **Booking→client mapping** | Associate bookings with the client that created them | No — needed for notifications |
| **Provisioning process** | Steps to create a new client (manual or automated) | Undefined |

### Possible Approaches

**Option A — Lean on F3's existing `usr` + `apikey` tables**
- Each B2B client = a `usr` record with `partner` role + API key
- `client_id` = `usr_id` or a new field on `usr`
- Pro: No new tables, reuses F3's auth pipeline
- Con: Couples B2B client identity to F3's legacy user model; no clean separation

**Option B — New B2B client table (separate schema)**
- Create `b2b_clients` table in the B2B migration schema (as proposed for other B2B tables)
- Fields: `client_id` (string PK), `name`, `enabled`, `api_key_usr_id` (FK to usr), `webhook_url`, `hmac_key`, `created_at`
- B2B middleware validates `client_id` from URL against this table
- Pro: Clean boundary, purpose-built, follows the separate-schema pattern already proposed
- Con: Additional table to maintain; still needs an `apikey` record in F3 for auth

**Option C — client_id = API key user, add metadata fields**
- When onboarding: create F3 user with partner role + API key (existing flow)
- Add a `client_code` or `client_name` field to the apikey or user record
- B2B middleware extracts client identity from the authenticated user
- Pro: Minimal new infrastructure
- Con: Still no dedicated client config store for webhooks etc.

### Relationship to Other Presentation Topics

This connects to several existing sections:
- **Notifications** (section 2.5): "booking ID → client association" — exactly this problem
- **Webhook configuration** (section 1, line 22): "Client webhook configuration — URLs, HMAC keys, retry policies per B2B client" — needs a client table
- **Booking-to-client association** (section 1, line 23): "lightweight mapping for notification routing" — needs client_id on bookings

---

## 4. Open Questions for Discussion

1. **Should the client_id concept be a new B2B table or map to F3's existing user/agent model?**
   - Sana's input needed — she knows F3's patterns best

2. **What does the onboarding process look like operationally?**
   - Who creates the client? (Sana manually? A backoffice UI? An API?)
   - What info is needed? (company name, webhook URL, contact, billing?)

3. **Should client_id be in the URL path (like today) or derived from the API key?**
   - Current system: explicit in URL (`/v1/{client_id}/...`)
   - Alternative: API key authenticates → system resolves client_id from the key
   - The URL-path approach lets one API key serve multiple client contexts (useful?)

4. **Per-client 12go API key: one shared key or one per B2B client?**
   - Today: each TC client has its own 12go API key (scattered across AppConfig)
   - For Q2: do new B2B clients each get their own 12go API key, or share one?
   - If per-client: who creates the 12go API key? (12go team manually?)

5. **Is this blocking Q2 start, or can it be resolved during week 1-2?**
   - The search POC works without client validation — but booking needs it
