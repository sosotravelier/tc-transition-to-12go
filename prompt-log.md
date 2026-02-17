# Prompt Log

> This file preserves the original task description and context that initiated this transition design project.

## Initial Prompt (Feb 17, 2026)

We are right now in big transition.

We have denali and etna. denali is responsible for booking funnel and etna - for search of itineraries.
We have existing clients that are calling these apis.

We also have supply-integration project, which is essentially integration with supplier. When a client/user requests search by some route, etna I think figures out to which integration(s) these stations/pois belong to and they call etna search supplier integration with that integration id.
Then based on integration id etna si (si is supplier integration) host calls the framework of si, passing integrationId which figures out which implementation to call.

We had multiple integration but as part of the big transition that we are doing, we want to demolish all of these services and use 12go as the main core of the system. and 12go has capability to have integrations.
It would be easy to kill all of etna and denali services if not existing clients, to which we are providing api contracts that are vastly different then in 12go.

My current task is to come up with a design to this transition. to figure out what's the best design to make sure that client's don't break as well as it is easy to maintain.

I need to define now what are things that we need to keep. Which endpoints and what functionality internally. This includes:
* Keeping endpoint contracts intact.
* How we handle authentication.
* How do we monitor the system. Because both of the systems have this capability and if let's say finding all the logs related to certain booking is already supported in 12go, there's no need to keep this capability elsewhere.
* We will need to migrate our infrastructure to their cloud. This part is debatable if we need to copy all of our services (or minimum amount of them) vs writing it from scratch.
* Monitoring: we are using coralogics for logs and tracing. And grafana for metrics.

### Operations/Endpoints Used by Clients

**Master-data (Fuji)**
- Fuji - Get Stations
- Fuji - Get Operators
- POIs

**Denali**
- GetItinerary
- SeatLock
- Reserve
- Confirm
- IncompleteResults
- getBookingDetails
- GetTicket
- Booking Notifications
- Client notifications
- Supplier Owner Client Notifications - we might not need it anymore

**Etna**
- Etna Search
- Etna Search Supplier Integration

### Additional Considerations

- In SI we should look at how we integrate with 12go right now. So Etna and Denali would call that directly most likely without supply-integration framework in the middle.
- Programming language: Denali, Etna and others are .NET; 12go is PHP. Given maturity of 12go, we might need to switch. Unless 12go has another vision for new services.
- Integration method: Currently HTTP endpoints. Maybe reference their code directly? Access repositories? Access databases directly? Need to evaluate.
- We need to take all this into consideration.

### Service Details

**Denali**: Many projects inside. Most important: booking-service (GetItinerary/Checkout, calls Etna SI Host). Main 12go interaction through SupplyIntegration/OneTwoGo libraries. SiFacade orchestrates. BookingSiHost bridges to SI libraries. For GetItinerary: calls etna-si-host first, which calls si endpoint. Also has GetBookingSchema for booking form requirements. Post-booking-service for GetBookingDetails and ticket PDF. All written generically for multiple integrations - can simplify for 12go only. DynamoDB storage can potentially go away (proxy to 12go instead). Booking-notification-service handles webhooks.

**Fuji**: GetStations - clients call at start to get station IDs, find correspondence with their stations. GetOperators similar. Data comes from 12go via periodic sync jobs.

**Etna Search**: Designed for multiple sources (trip lake pre-fetch, direct integration, experiments). All goes away except direct search calling 12go API. Current flow: Etna.Search -> MediatR pipeline -> Etna.Search.SupplierIntegration (SI Host) -> SI Library -> 12go. Note: Search writes to HybridCache data needed later in booking funnel.

### Full Client Flow

1. Client searches -> gets Itineraries with IDs
2. GetItinerary by ID -> returns more detail (schema, seat layout) + BookingToken
3. CreateBooking with BookingToken + passenger data -> validates, books, stores in DB
4. ConfirmBooking with bookingId
5. GetBookingDetails retrieves from DB
6. GetTicket (may not be immediate)

### 12go Side

PHP system, frontend3 contains endpoints we call. Uses MySQL, Redis, PHP, Kafka. Own monitoring tools. OpenTelemetry for tracing/metrics (somewhat compatible). Station data pulled periodically to Fuji.
