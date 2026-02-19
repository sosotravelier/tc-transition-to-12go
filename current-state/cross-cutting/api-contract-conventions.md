---
status: new
last_updated: 2026-02-18
---

# API Contract Conventions

Cross-cutting conventions that apply to all client-facing endpoints. These are part of the "Travelier Connect API" contract and must be preserved during transition.

Source: client onboarding documentation (`client-onboarding-docs/` files 0-9).

## Brand

The official API name is **Travelier Connect API**. Dev environment: `https://integration-dev.travelier.com/v1/{client_id}/`. Staging client IDs differ from production.

## API Versioning

Clients send a `Travelier-Version` header in **YYYY-MM-DD** format (e.g., `2023-07-01`).

| Behavior | Detail |
|----------|--------|
| Missing version | Default behavior (current version) |
| Outdated version (deprecated) | Response includes `Deprecation: YYYY-MM-DD` header indicating sunset date |
| Removed version | `400 Bad Request` |
| Current latest | `2023-07-01` |

**Transition impact**: Any new API gateway or proxy layer must forward the `Travelier-Version` header and support version-specific response shaping. Breaking changes require a new version date.

## Correlation and Experiment Headers

| Header | Purpose | Required? |
|--------|---------|-----------|
| `x-correlation-id` | Conversion tracking across search -> checkout -> book phases | Optional but recommended; returned in responses |
| `x-api-experiment` | A/B test consistency -- ensures same source returns responses | Optional; returned in responses; can be sent by client to override |
| `X-REQUEST-Id` | Request identification | Optional |

**Transition impact**: All three headers must be forwarded to 12go and returned to clients. If 12go doesn't support these natively, the proxy layer must inject/preserve them.

## Money Format

All monetary values use a structured format with amounts as **strings** (not numbers) to avoid floating-point issues:

```json
{
  "currency": "USD",
  "amount": "14.60"
}
```

Precision depends on the currency's lowest denomination (e.g., 2 decimal places for USD).

## Pricing Structure

Pricing has three components returned in search/itinerary responses:

### Net Price (Cost)

Base cost paid to the supplier, excluding markups/fees.

```json
"net_price": {
    "currency": "USD",
    "amount": "75.00"
}
```

### Gross Price

Constraints around the selling price. This field is **optional** and has four variants:

| Variant | Meaning |
|---------|---------|
| `Max` | Upper limit -- cannot charge more than this |
| `Min` | Lower limit -- commercial agreement floor |
| `Exact` | Must charge exactly this amount |
| `Recommended` | Suggested price point; flexible |

```json
"gross_price": {
    "price_type": "Recommended",
    "currency": "USD",
    "amount": "85.00",
    "amount_in_net_currency": "75.00"
}
```

### Taxes and Fees

Additional costs included within the net price for tax/fee obligations:

```json
"taxes_and_fees": {
    "currency": "USD",
    "amount": "5.00"
}
```

### Total Price (Reserve/Confirm)

- **In `POST /reserve` request**: Optional parameter. If provided by client, the system validates it matches the calculated total. Mismatch returns a "cost mismatch" error.
- **In `POST /reserve` and `POST /confirm` responses**: The system-calculated total including all charges.

**Transition impact**: Since Ushba (our pricing module) is being sunset, we will use prices from 12go responses directly. The proxy layer must preserve the pricing structure format exactly.

## Confirmation Types

Two types of booking confirmation:

| Type | Behavior |
|------|----------|
| `Instant` | Booking confirmed immediately; confirmation details in the API response |
| `Pending` | Booking not confirmed immediately; confirmation provided asynchronously once supplier approves or declines |

`Pending` confirmations map to our IncompleteResults pattern -- clients poll or wait for webhook notification.

## Ticket Types

Three ticket types that clients handle differently:

| Type | Description |
|------|-------------|
| `Paper Ticket` | Traditional printed ticket, must be presented at boarding |
| `Show On Screen` | Digital ticket on mobile device (QR code/barcode) |
| `Pick Up` | Purchased online, collected as physical copy at designated location |

## Cancellation Policies

Cancellation policies are returned as an array of time-windowed penalty rules:

```json
"cancellation_policies": [
    {
        "from": null,
        "penalty": { "percentage": 0 }
    },
    {
        "from": "P2D",
        "penalty": { "cost": { "currency": "USD", "amount": "20.0" } }
    },
    {
        "from": "P1D",
        "penalty": { "percentage": 100 }
    }
]
```

| Field | Format | Description |
|-------|--------|-------------|
| `from` | ISO 8601 duration (e.g., `P2D` = 2 days) or `null` | Time period before departure when this penalty applies |
| `penalty.percentage` | Number (0-100) | Percentage of booking amount withheld |
| `penalty.cost` | Money object (`currency` + `amount`) | Fixed fee alternative to percentage |

### Cutoff Time

The `cut_off` field defines when bookings must stop before departure:

```json
{ "cut_off": "PT24H" }
```

Uses ISO 8601 duration format (e.g., `PT24H` = 24 hours before departure).

### Lead Time

Defines how far in advance a booking can be made. Some operators limit booking windows (e.g., up to 3 months ahead).

## Hybrid Search / On-Demand Fetch (ODF)

ODF is **enabled by default** and combines cached results with real-time supplier calls.

| Status Code | Meaning |
|-------------|---------|
| `200 OK` | All expected results available |
| `206 Potential Additional Content` | Partial results returned; additional inventory being retrieved in background |

Client handling options for 206:
1. **Ignore**: Treat partial response as final; remaining results appear in future searches
2. **Poll**: Repeat search until 200 or timeout (wait ~500ms between attempts)

**Transition impact**: Our current IncompleteResults endpoint in Denali implements this pattern. The 206 behavior must be preserved.

## Date/Time Conventions

| Convention | Format |
|-----------|--------|
| Departure/arrival times | Local time |
| Durations | ISO 8601 periods (e.g., `PT1D12H` = 1 day 12 hours) |
| Country codes | ISO 3166-1 alpha-2 (e.g., `TH`, `DE`, `FR`) |

## Distribution Service (Out of Scope)

The Distribution Service manages per-client product availability via whitelist/blacklist rules on operators, routes, and time windows. This is **out of scope** for the transition per management decision, but worth noting it exists as it affects which itineraries clients see.

## Open Questions

1. Does 12go's API already support all these conventions natively, or will the proxy layer need to translate?
2. How does 12go handle API versioning on their side?
3. Will `x-correlation-id` and `x-api-experiment` headers be forwarded through 12go's system or do we need to manage them entirely in the proxy?
