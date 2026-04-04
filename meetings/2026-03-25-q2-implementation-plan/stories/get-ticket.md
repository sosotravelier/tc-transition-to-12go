# GetTicket

**Type**: Story
**Epic**: ST-2483 (Q2 B2B API Transition)
**Owner**: Soso
**Prerequisites**:
- CreateBooking (#6) — a booking must exist
- ConfirmBooking (#7) — booking must be confirmed (status = approved) for ticket to be available

**Blocks**: Nothing directly — this is a read-only endpoint

---

## Description

Implement the GetTicket endpoint that returns a ticket URL for a confirmed booking. Unlike TC (which generates branded PDFs, re-hosts them on S3, and returns CloudFront signed URLs), F3 passes through 12go's `ticket_url` directly.

Avikhai (Mar 25): "This is what we get today. We don't do anything." — confirming that passing through 12go's ticket URL is acceptable for new B2B clients.

### Internal F3 Service Calls (Not HTTP)

Since B2B lives inside the F3 monolith, this endpoint uses **in-process calls to internal F3 services** — not HTTP calls to 12go's external API. The `TwelveGoClientInterface` wraps calls to internal F3 services.

The external endpoint `GET /booking/{BId}` is documented in our endpoint specs as reference for *what the operation does*, but we call the underlying PHP service directly, not the HTTP layer.

### What's Different from TC

TC today has two paths:
1. **Whitelisted integrations**: Generate a branded PDF with QR codes, maps, and logos via `TicketPdfService`, upload to S3, return CloudFront signed URL.
2. **Non-whitelisted integrations**: Download 12go's PDF, re-upload to S3, return CloudFront signed URL.

Both paths involve S3 re-hosting and CloudFront URL signing. F3 eliminates all of this — just return 12go's `ticket_url` directly.

---

## Acceptance Criteria

### Input & Routing

- [ ] Accept `GET /v{version}/{client_id}/bookings/{booking_id}/ticket` matching TC contract
- [ ] Use 12go native booking ID as `booking_id` (per Mar 25 decision — no encryption/decryption)
- [ ] Validate `client_id` against authenticated client

### Ticket Retrieval (In-Process F3 Service Call)

- [ ] Call F3's internal booking details service (via `TwelveGoClientInterface`) to retrieve booking data including status and `ticket_url` — this is an in-process PHP call, not an HTTP call
- [ ] **Implementation note**: Identify the exact F3 service to call with Sana/Valeri during implementation

### Status Validation

- [ ] Check booking status — ticket is only available for confirmed bookings
- [ ] If booking status does not map to `approved`, return **405 Method Not Allowed** (matches TC behavior)
- [ ] If booking not found, return **404**

### Response — Ticket Available

- [ ] If `ticket_url` is present and non-empty, return `200 OK`:
  ```
  {
    ticket_url: "https://..."
  }
  ```
- [ ] Pass through 12go's `ticket_url` directly — no re-hosting, no URL signing

### Response — Ticket Not Ready

- [ ] If booking is confirmed but `ticket_url` is null/empty, return **202 Accepted** (no body)
- [ ] This indicates the ticket is still being generated on 12go's side — client should retry

### Error Handling

- [ ] **400** — Malformed request (invalid booking_id format)
- [ ] **401** — Client authentication failure
- [ ] **404** — Booking not found
- [ ] **405** — Booking is not in confirmed/approved status (ticket not available for non-confirmed bookings)
- [ ] **500** — Unexpected errors from internal service (log full context, return meaningful message)

---

## Technical Notes

### Architecture (3-Layer)

```
Handler (Controller)
  ├─ Validate request parameters
  ├─ Extract booking_id
  └─ Build response (200 with URL, or 202, or error)

Mapper (minimal)
  └─ Extract ticket_url and status from booking details

12go Client (TwelveGoClientInterface — in-process, NOT HTTP)
  └─ getBookingDetails(bookingId) → booking data including ticket_url
```

### What's Eliminated vs TC

| TC Component | F3 | Notes |
|---|---|---|
| TicketPdfService (branded PDF generation) | Eliminated | No custom PDF generation |
| Razor template rendering pipeline | Eliminated | Part of TicketPdfService |
| QR code, map, logo enrichment services | Eliminated | Part of TicketPdfService |
| S3 re-hosting of supplier tickets | Eliminated | Pass through 12go's URL directly |
| CloudFront signed URL infrastructure | Eliminated | No URL signing needed |
| IUrlSigner + CloudFront config | Eliminated | No signing infrastructure |
| PostgreSQL ticket_url column update | Eliminated | No local ticket URL caching |
| Polly retry (3 attempts, 3s delay) | Eliminated | In-process call, no HTTP retry needed |
| PersistenceProvider (S3 upload in SI) | Eliminated | No re-upload |
| WhitelistedIntegrations config | Eliminated | Single path — always pass through |
| ConditionalCypher encrypt/decrypt | Eliminated | Use 12go native booking ID |
| BookingEntity lookup for ticket | Eliminated | No local DB lookup |

---

## Open Questions (For Grooming)

1. **Is 12go's `ticket_url` stable and long-lived?** If the URL expires, clients may get broken links after some time. Need to verify: does it expire? Does it require authentication? Is it publicly accessible?
2. **Is branded PDF generation needed for new B2B clients?** Avikhai said "we don't do anything" for current flow, but new enterprise clients might want branded tickets with their logo. If so, this becomes a future enhancement, not a launch blocker.
3. **What does 12go's ticket URL point to?** Is it a direct PDF download, a redirect, or an HTML page? TC's contract returns a direct PDF URL — need to confirm 12go's URL behaves the same way.
4. **Retry strategy for 202 (ticket not ready)?** Should the response include a `Retry-After` header to hint when the client should retry? TC had Polly retry internally — we're pushing retry responsibility to the client.

---

## Cross-Cutting AC (Applied to All Endpoint Stories)

- Forward `x-correlation-id` from the client request and include in structured events and logs
- Emit structured JSON event (`ticket.retrieved`) for Datadog → ClickHouse pipeline
- Per-endpoint sanity check: no major latency degradation vs direct 12go call
- Implement proper structured logging (request/response, errors, client context) following F3 logging patterns
- Error handling: meaningful error responses for client-facing failures, not raw upstream errors
