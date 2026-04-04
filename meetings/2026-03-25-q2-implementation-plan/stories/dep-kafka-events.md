# Kafka Event Investigation

**Type**: Task
**Epic**: ST-2483 (Q2 B2B API Transition)
**Owner**: Data team (TBD)

## Description

Determine: (a) what events 12go already emits for booking funnel, (b) what TC events data team actually consumes, (c) target schema for unified events. Eliran pushed for unified approach — one set of events serving both TC and 12go. Audit which teams/services consume our Kafka topics (`ReservationConfirmationSucceeded`, `ReservationChanged` may have external consumers). Source: `current-state/cross-cutting/messaging.md`.