# Search POC Local Environment Issues & Fixes

Tested on: 2026-03-15 through 2026-03-16
Ticket: ST-2432 — "perform a poc for search endpoint inside the F3"
Branch: `ST-2432-b2b-search-poc` in frontend3

## Context

Setting up the 12go local Docker environment and running the search POC required two phases of debugging:

1. **Phase 1 — Infrastructure setup:** Getting the Docker environment running, DB dumps imported, search tables populated, and migrations applied. Required a full environment reinstall following the `fix-import-dump` branch instructions from the 12go team.
2. **Phase 2 — Search endpoint debugging:** Making the f3 B2B search endpoint actually return results once the environment was up.

## Root Cause

`make db` crashed at migration `2024-06-12-SUPPLY-41.sql` (attempted `DROP COLUMN xclass_id` on a column that doesn't exist) and exited before running many subsequent migrations, views, and UDF install scripts. This left the local DB in a partially-migrated state — missing tables, columns, views, and stored procedures accumulated across ~2 years of skipped migrations.

A secondary root cause was the migration runner's date cache (`.db_last_date`), which stored `2026-02-11` from a previous partial run. The runner subtracts 3 months from this date to determine its start point (`2025-11-13`), causing it to skip all migrations before that date — including the ones that were never applied due to the original SUPPLY-41 crash.

---

## Phase 1: Infrastructure & Environment Setup

### 1.1 Environment reinstall required (fix-import-dump branch)

The 12go team identified a global issue with broken local environments (empty search results, missing routing data). Their fix was in the `fix-import-dump` branch of `docker-local-env`, which added `ImportTripPoolDump()` to the dump import pipeline — previously `trip_pool.sql.gz` was never imported.

Steps followed:
1. `docker compose down -v --remove-orphans` + `docker system prune -a --volumes -f`
2. Switch to `fix-import-dump` branch, delete cached `12go-linux`/`12go-macos` binaries
3. Run `12go up`
4. Run `fill-search-province-station` if search still empty

### 1.2 Bitbucket API token authentication

The `12go.sh` script downloads its Go binary from Bitbucket using `BITBUCKET_USERNAME:BITBUCKET_APP_PASSWORD` basic auth. Two issues:

- **Classic tokens (no scopes) rejected with 401.** Bitbucket replaced App Passwords with API Tokens. The new "API token with scopes" format is required, with at minimum the `read:repository:bitbucket` scope for the Downloads API.
- **Credentials must be set in `.env`** as `BITBUCKET_USERNAME` (email) and `BITBUCKET_APP_PASSWORD` (the API token).

### 1.3 Local changes blocking git operations

Both `docker-local-env` (file `12go-go-command/utilities/git.go`) and the `migrations` repo (file `2023-10-12-STATS-4494.sql`) had local modifications from previous debugging sessions. Required `git stash` before checkout/pull.

### 1.4 Docker image pulls silently slow

`12go up` appeared stuck at "Starting services..." for 10+ minutes. The spinner suppressed Docker's pull output — it was actually downloading large images (115MB+). Monitoring `docker compose pull` separately confirmed progress.

### 1.5 `make db` crash at SUPPLY-41 migration

- **Error:** `Can't DROP COLUMN 'xclass_id'` — the column doesn't exist in `trip` table
- **Migration:** `2024-06-12-SUPPLY-41.sql` — guarded by `IF NOT EXISTS route_import_hist`, so it enters the block on a fresh DB, but the `ALTER TABLE trip DROP COLUMN xclass_id` inside fails
- **Consequence:** All subsequent migrations, `4-views.sql`, UDF installs, and `fill_routes` were skipped
- **Fix:** Manually created `route_import_hist` table and inserted the `data_sec_role` rows so the migration's IF condition would evaluate to "already done" on re-run

### 1.6 Migration runner date cache skipping years of migrations

- **File:** `migrations/.db_last_date` contained `2026-02-11`
- **Logic:** `run_migrations.php` subtracts 3 months → starts from `2025-11-13`, skipping everything before
- **Problem:** Migrations from 2024-01 through 2025-11-12 (including the ones that failed in the original crash) were never retried
- **Fix:** Deleted `.db_last_date` so the runner starts from its hardcoded default of `2020-06-01`

### 1.7 Cascading migration failures on full re-run

After resetting the cache, running all migrations from 2020 exposed a chain of issues caused by the other conversation's manual fixes creating tables/columns with incomplete schemas:

| Migration | Error | Root Cause | Fix |
|---|---|---|---|
| `2025-05-06-FIN-308-yuno.sql` | `Unknown column 'payment_method_sort_order'` | `FIN-295` migration skipped because we manually added `is_payment_method_enabled` earlier (its IF guard passed), but `payment_method_sort_order` was in the same IF block | Added column manually |
| `2025-08-08-CS-559.sql` | `Unknown column 'fields'` | `support_check_list` was created with incomplete schema (missing `fields JSON`, `stamp`, `createdby`, `updatedby`, `createdon` columns) | Added missing columns |
| `2025-11-04-SUPPLY-625.sql` | `Duplicate column name 'check_watermark'` | Column already existed from a previous manual fix, but the migration's guard (`IF NOT EXISTS support_config ...`) checked a different table | Inserted the `support_config` row so the guard evaluates to "done" |
| `2026-02-18-add-traveling-entity.sql` | `Unknown column 'subsidiary_code'` and `Unknown column 'is_active'` | Columns on `company` table from 2020 migration (`2020-04-15-STATS-1823`) never ran | Added both columns manually |
| `2024-11-27-FIN-201-paypal-cy-php.sql` | FK constraint on `paygate_account_mapping.company_id` | `company` table in local dump doesn't contain all company records (IDs 11, 12) | Disabled FK checks globally for remainder of migration run |

**Resolution:** After fixing all blockers, `make db` completed successfully — all migrations applied, UDFs installed, `price_5_6_load()` loaded 42,290 operators, `fill_routes` added 98,004 route entries.

### 1.8 `fill-search-province-station` OOM kills

The `one-time:fill-search-province-station` Symfony command crashed with OOM at both 512MB and 2GB memory limits.

- **Root cause:** Legacy bootstrap code (`common/api.php:76`) calls `print_r($smsg)` in CLI mode. When `apilog()` is called with a large data structure during bootstrap, it exhausts memory.
- **Deeper root cause:** The bootstrap queries `tax_rules.tax_code`, but the `tax_code` column didn't exist (migration never ran). This triggered a SQL error → `bug()` → `apilog()` with the error → `print_r()` of accumulated state → OOM.
- **Fix:** Created `tax_code` table and added `tax_code` column to `tax_rules`, then the command ran successfully.

### 1.9 `trip_pool4` tables missing (separate migration target)

`make db` only runs `default` schema migrations. The `trip_pool4_*` tables are created by `make db trip_pool`, which runs trip_pool-specific migrations from `migrations/sql/trip_pool/`. This is a separate invocation.

- `make db trip_pool` successfully created all 12 `trip_pool4_*` tables
- It then failed at the UDF install step (`ops` table doesn't exist), but the tables were already created

### 1.10 `trip_pool4` empty after import-dump

The `import-dump` command completed with exit 0, but `trip_pool4` remained at 0 rows. The dump file (`trip_pool.sql.gz`, 9.5MB) was valid — it contained 31 INSERT statements for `trip_pool4` and data for `trip_pool4_extra`.

- **Root cause:** Unknown — the first import silently failed to populate data despite exit 0. Possibly a `USE` statement mismatch or session-level error suppression in the MySQL CLI.
- **Fix:** Manually re-imported by copying the dump into the container and running `mysql -u root -ppass 12go < /tmp/trip_pool.sql`. This populated 303,907 rows.

### 1.11 `fill_routes` returning "0 rows affected"

After importing `trip_pool4` data, `trip-pool:fill_routes` initially returned "0 rows affected" because it was called when `trip_pool4` was still empty. The stored procedure `fill_trip_pool_routes_full()` reads FROM `trip_pool4` to build route indexes in `trip_pool4_route_station`, `trip_pool4_route_place`, and `trip_pool4_route_place_station`. With 0 source rows, there's nothing to index.

- **Fix:** Re-ran after `trip_pool4` was populated → 209,213 rows affected (first run), then 98,004 more after full migration re-run.

### 1.12 `fill-search-province-station` timing conflict

The fill command failed with "station table doesn't exist" when run concurrently with `import-dump`. The `trip_pool.sql.gz` dump includes `DROP TABLE IF EXISTS` followed by `CREATE TABLE` for some tables, causing a brief window where the `station` table is unavailable.

- **Fix:** Re-ran the fill command after `import-dump` completed. Final counts: `search_province` = 194,118 rows, `search_station` = 2,215,427 rows.

### 1.13 `predict_settings_price_v` view missing

The `price_5_6_load()` UDF initialization needs this view to load operator recheck settings. It's defined in `4-views.sql:4550` but was never created because `make db` failed before reaching the views step.

- **Fix:** Ran the full `4-views.sql` file. Created 202 views including `predict_settings_price_v` (42,290 rows).

### 1.14 `4-views.sql` failing on missing columns

The views file failed at line 284 with `Unknown column 'r.product_type'`. This column should have been added by migration `2024-03-01-CORE-3767-Railpasses-booking.sql`, which was among the skipped migrations.

- **Fix:** Had to complete all migrations first (see 1.7), then re-run `4-views.sql`.

---

## Phase 2: Search Endpoint Debugging

Issues encountered while making the f3 B2B search controller return results.

### 1. Route prefix mismatch

The route is registered as `/b2b/v1/{clientId}/itineraries` (with `/b2b` prefix), not `/v1/...` as you might expect from the controller's `#[Route(path: '/v1/...')]` attribute. The prefix comes from Symfony route config.

### 2. Authentication blocking the endpoint

The `AuthenticationListener` requires either an API key or a valid token. For local testing, we initially bypassed auth with `no_auth` and `without_agent` route options, but this caused pricing fields to be null because `netPrice`/`sysfee`/`agfee` are only populated when an agent is logged in. The correct approach is to use an API key:

```
curl -H "x-api-key: {key}" "https://frontend3.12go.local:8443/b2b/v1/{client_id}/itineraries?..."
```

API keys are stored in the `apikey` table. The agent also needs `api_pass_netprice_sysfee` permission in `data_sec_role` for pricing fields to be populated.

### 3. Missing table: `pricing_feature_map`

- **Error:** `Table '12go.pricing_feature_map' doesn't exist`
- **Migration:** `2025-03-12-BUYER-711.sql`
- **Fix:** Created table manually. Also needed `pricing_rule` table from the same migration.

### 4. Missing UDFs: `price_5_6` and `price_5_6_pool`

- **Error:** `FUNCTION 12go.price_5_6_pool does not exist`
- **Cause:** The `price_install.sql` script ran partially — the `price_5_6_set_*` helper UDFs were registered but the main `price_5_6` and `price_5_6_pool` aggregate function were not.
- **Fix:** Ran the missing `CREATE OR REPLACE` statements from `migrations/rust-udf/price_install.sql`.

### 5. Missing UDFs: `fx`, `fx_on_date` (FX conversion)

- **Error:** `FUNCTION 12go.ofx does not exist` (called internally by `fx()`)
- **Cause:** The fx UDF `.so` file was never copied to the MariaDB plugin directory.
- **Fix:** Ran `migrations/rust-udf/fx_install.sh` inside the DB container.

### 6. Missing tables for `price_5_6_load()` initialization

The `price_5_6_load()` stored function populates the UDF's in-memory state (FX rates, operator topups, discount offers, etc.). It failed because several tables were missing:

| Table | Migration |
|---|---|
| `discount_offers` | `2024-11-12-SUPPLY-275.sql` |
| `pricing_rule` | `2025-03-12-BUYER-711.sql` |
| `agent_fee_rule` | `2025-10-13-DIST-213.sql` |

Additionally, `discount_offers` needed column renames from `2024-11-29-SUPPLY-279.sql` (`discount` → `discount_netprice`, `discount_fxcode` → `discount_netprice_fxcode`, added `discount_topup` and `discount_topup_fxcode`).

**Fix:** Created all tables and applied column changes. Then `price_5_6_load()` ran successfully (42,290 operators loaded, 169 FX rates).

### 7. Missing column: `images_custom_class.image_order`

- **Error:** `Unknown column 'i.image_order' in 'field list'`
- **Migration:** `2025-09-30-SUPPLY-517.sql`
- **Fix:** `ALTER TABLE images_custom_class ADD COLUMN image_order INT NOT NULL DEFAULT 0`

### 8. Missing tables: `special_deal` and `special_deal_feature_map`

- **Error:** `Table '12go.special_deal' doesn't exist`
- **Migration:** `2025-05-28-BUYER-1057.sql`
- **Fix:** Created both tables.

### 9. Missing table: `support_check_list`

- **Error:** `Table '12go.support_check_list' doesn't exist`
- **Fix:** Created table with columns `id`, `object`, `object_id`, `is_information_ready`.

### 10. Missing column: `station.coordinates_accurate`

- **Error:** `Undefined array key "coordinates_accurate"` in `StationManager.php:95`
- **Migration:** `2023-05-17-CORE-3691.sql`
- **Fix:** Added column to `station` table, then recreated `province_v`, `station_all_v`, `station_v` views from `4-views.sql` (the views must be recreated after adding the column, since they use `SELECT *` from underlying tables/views).

### 11. Missing column: `operator.available_before_days`

- **Error:** `Undefined array key "available_before_days"` in `OperatorCollector.php:93`
- **Fix:** Added column to `operator` table, then recreated `operator_v` view from `4-views.sql`.

### 12. Missing column: `province.province_name_in`

- **Error:** `Unknown column 'p.province_name_in'` when recreating `station_all_v` view
- **Fix:** Added column to `province` table, then recreated `province_v` which is a dependency of `station_all_v`.

### 13. `Logger::bug()` throws in dev mode

In non-prod environments, `Logger::bug()` with type `ALARM` throws a `BadRequestHttpException` (line 79 of `Logger.php`). This means any SQL error in the search pipeline — even in non-critical enrichment steps like image loading or special deal lookup — aborts the entire request. This made debugging harder because the real error was masked by cascading exceptions.

### 14. Empty `trip_pool4_price` table

`trip_pool4_price` is populated by live integration recheck workers, not by static DB dumps. Without pricing data, the `price_5_6_pool` UDF returns `PRICE_NONE`, all pricing fields stay null, and `SearchMapper::isOptionValid()` filters out every option.

**Fix:** Inserted 14 synthetic pricing rows for date 2026-03-20 (4 Thai Railway trains + 10 buses on Bangkok→Chiang Mai route).

### 15. `is_ignore_group_time` flag preventing `depDateTime` population

All trips in the test data had `trip_pool4_extra.is_ignore_group_time = 1`. When this flag is set, the `TravelOptionApiV1Factory` skips setting `depDateTime` and `arrDateTime`, causing the mapper to produce itineraries with empty departure times.

**Fix:** Set `is_ignore_group_time = 0` for the 14 test trips.

### 16. Pricing fields null without agent permissions

Even with valid pricing data, `netPrice` and `sysfee` are only populated when the agent has the `api_pass_netprice_sysfee` permission. `agfee` requires the agent to be logged in (`isNeedPassTopup`).

- **Code:** `TravelOptionBaseFactory.php` lines 78-79
- **Fix:** `INSERT INTO data_sec_role (role_id, object, object_id, access) VALUES ('agent', 'operation', 'api_pass_netprice_sysfee', 'RW')`

## Controller Changes (vs branch)

Two changes were needed to the `SearchController.php` on the branch:

1. **Return type:** `JsonResponse` → `Response` — needed to use custom `json_encode` flags
2. **JSON encoding:** `json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE)` — safety for any binary UDF data that leaks through the parsing pipeline

## Test Results

All 4 search types return HTTP 200 with correct B2B contract shape:

| Search Type | Params | Vehicles | Segments | Itineraries |
|---|---|---|---|---|
| Province → Province | `departure_poi=1&arrival_poi=44` | 6 | 14 | 14 |
| Station → Province | `departures[]=3&arrival_poi=44` | 1 | 4 | 4 |
| Province → Station | `departure_poi=1&arrivals[]=4` | 1 | 4 | 4 |
| Station → Station | `departures[]=3&arrivals[]=4` | 1 | 4 | 4 |

Response JSON files are in this directory alongside this document.

## Final DB State

| Table | Rows | Source |
|---|---|---|
| `trip_pool4` | 303,907 | `trip_pool.sql.gz` dump |
| `trip_pool4_extra` | populated | `trip_pool.sql.gz` dump |
| `trip_pool4_route_station` | 37,296 | `fill_routes` stored procedure |
| `trip_pool4_route_place` | 13,209 | `fill_routes` stored procedure |
| `trip_pool4_price` | 0 (+ 14 synthetic) | Live recheck workers (not available locally); 14 rows inserted manually for testing |
| `search_province` | 194,118 | `fill-search-province-station` command |
| `search_station` | 2,215,427 | `fill-search-province-station` command |
| `route` | 261,908 | `route_trip.sql.gz` dump |
| `station` | 268,844 | DB dump |
| `operator` | 43,290 | `seller-operatos.sql.gz` dump |
| Views | 202 | `4-views.sql` |

## Key Takeaways

1. **The migration system is fragile.** A single migration failure at `SUPPLY-41` in mid-2024 silently left the DB in a broken state that accumulated damage over 2 years of subsequent migrations. The `make db` command exits on first error with no recovery mechanism.

2. **The date cache amplifies the problem.** `.db_last_date` advances even after partial runs, causing future `make db` invocations to skip the failed migrations entirely. Deleting this file forces a full re-run from 2020.

3. **Manual fixes can create new problems.** Creating tables/columns manually to unblock one issue often causes a different migration's IF guard to pass incorrectly, either skipping necessary work or hitting duplicate-column errors. The safest approach is to fix the specific blocker and re-run the full migration pipeline.

4. **`trip_pool4_price` has no static dump.** This is the only critical search table that cannot be populated from dumps — it requires live integration recheck workers querying supplier APIs. For local dev testing, synthetic price rows must be inserted manually.

5. **The `fill_routes` stored procedure depends on `trip_pool4` data.** It reads FROM `trip_pool4` to build route indexes. If called before the dump is imported, it silently does nothing (0 rows affected). Must be run after `trip_pool4` is populated.

6. **Multiple migration schemas exist.** `make db` runs `default` migrations only. `make db trip_pool` is needed separately for `trip_pool4_*` tables. The `finance_rw` schema also has its own migrations that may fail on FK constraints due to missing company data in local dumps.

7. **Legacy PHP bootstrap causes OOM in CLI.** `common/api.php:76` calls `print_r()` on large data structures in CLI mode. When bootstrap hits any SQL error (like the missing `tax_code` column), the error handler accumulates state that `print_r()` tries to serialize, killing the process.
