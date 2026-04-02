# Canary Verification: Search POC

**Date:** 2026-04-02
**Environment:** `https://recheck10.canary.12go.com`
**Endpoint:** `GET /b2b/v1/{client_id}/itineraries`
**Departure date used:** 2026-04-05
**VPN:** Tailscale (required)

---

## API Key Discovery

Test fixture keys (from `tests/Fixtures/global/apikey.json`) do not exist in the production/canary `apikey` table and return `400 {}`. Keys inserted via SQL migrations (2018–2019) exist on canary but have `data_sec` restrictions that return empty results. A production partner key was needed to get full results.

---

## Results

All 4 search types return **HTTP 200** with the correct B2B contract structure.

### Counts

| Search Type | Params | Vehicles | Segments | Itineraries |
|---|---|---|---|---|
| Station → Station | `departures[]=3&departures[]=4055&arrivals[]=4&arrivals[]=5133&arrivals[]=11553` | 1 | 3 | 3 |
| Station → Province | `departures[]=3&departures[]=4055&arrival_poi=44` | 1 | 3 | 3 |
| Province → Station | `departure_poi=1&arrivals[]=4&arrivals[]=5133&arrivals[]=11553` | 1 | 6 | 6 |
| Province → Province | `departure_poi=1&arrival_poi=44` | 22 | 141 | 140 |

Count differences from local responses are expected: different date, different API key permissions, live trip_pool data vs local synthetic data.

### Structural Validation

Every field, type, and nesting level matches the expected B2B contract:

| Check | Result |
|---|---|
| Top-level keys (`vehicles`, `segments`, `itineraries`) | MATCH |
| Vehicle keys (`id`, `name`, `seat_classes`, `images`, `description`, `keywords`, `amenities`) | MATCH |
| Seat class keys (`id`, `name`, `description`, `keywords`, `images`, `amenities`) | MATCH |
| Segment keys (`id`, `from_station`, `to_station`, `departure_time`, `arrival_time`, `travel_duration`, `vehicle_id`, `operating_carrier_id`, `seat_class_id`, `transportation_types`) | MATCH |
| Itinerary keys (`id`, `departure_segments`, `connection_guaranteed`, `cancellation_policies`, `number_of_available_seats`, `pricing`, `confirmation_type`, `ticket_type`) | MATCH |
| Pricing keys (`gross_price`, `net_price`, `taxes_and_fees`) | MATCH |
| Gross price keys (`amount`, `currency`, `price_type`) | MATCH |
| Cancellation policy keys (`from`, `penalty`) | MATCH |
| `amount` is string | YES |
| `number_of_available_seats` is int | YES |

Full response JSON files are in the `canary/` subdirectories alongside this document.

---

## Route Verification

The endpoint route is correctly deployed:
- `/b2b/v1/1/itineraries` → route matched (application responds)
- `/b2b/v1/itineraries` (no client_id) → 404 (routing rejects correctly)
- `/nonexistent-path` → 404

No AWS API Gateway changes were needed (confirmed by Sana, Mar 23 meeting).

---

## Conclusion

The search POC endpoint is **working correctly on canary**. The B2B contract is fully honored with real production trip data.
