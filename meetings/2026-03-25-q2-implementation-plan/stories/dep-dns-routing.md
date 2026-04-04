# DNS/URL Routing Investigation

**Type**: Task
**Epic**: ST-2483 (Q2 B2B API Transition)
**Owner**: Tal (DevOps)

## Description

How to route tc-api domain to 12go infrastructure during migration. Options: DNS remapping, v2 path prefix, per-client routing. Also: confirm whether app-level feature flag or AWS API Gateway is the routing mechanism for per-client migration. Gateway can't natively route by path parameter value.