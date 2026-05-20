# Backend

Target standalone backend service.

## Planned responsibilities
- API (`/api/v1/*`)
- Auth/AuthZ
- Domain services
- Webhooks
- Jobs/events
- Integrations (payments/email/storage)

## Current transition
Business logic still partially resides in monolith under `src/app/api`, `src/server/services`, `src/lib`.
