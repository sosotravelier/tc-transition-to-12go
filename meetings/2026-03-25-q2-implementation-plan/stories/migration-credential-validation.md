# Pre-Cutover Client Credential Validation Script

**Type**: Task
**Epic**: ST-2483
**Owner**: Soso

## Description

Test each `client_id`/key mapping against 12go staging before cutover. Prevents data leakage from wrong key assignment. Source: `current-state/migration-issues/api-key-transition.md`.

## Acceptance Criteria

- [ ] Script tests each `client_id`/key mapping against 12go staging
- [ ] Validates correct key assignment to prevent data leakage
