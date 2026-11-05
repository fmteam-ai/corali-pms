# CLAUDE.md — Corali PMS

Hotel property-management system. **Status: scaffold only** — the repo currently holds `README.md`,
`docker-compose.yml` (PostgreSQL 16) and `.env.example`. No application code exists yet; update this
file as the frontend/backend are added.

## Planned stack (from README)

- Frontend: Next.js
- Backend: NestJS
- Database: PostgreSQL 16 via Prisma ORM
- Modules: Auth, Users & Roles, Rooms, Reservations, Guests, Pricing, Offers, Payments (Stripe, Viva),
  Automation, Booking Engine, Channel Manager foundation.

## Local services

```bash
docker compose up -d postgres     # postgres:16 on localhost:5432, db corali_pms, user corali
cp .env.example .env              # then fill in values locally — never commit .env
```

Note: `.env.example` uses `user:password` in `DATABASE_URL` while `docker-compose.yml` creates user
`corali`. Make them agree when the backend is wired up.

## Conventions

- Never commit secrets. `.env` stays local; `JWT_SECRET`, `STRIPE_KEY`, `VIVA_KEY` values never go in
  code, commits, docs or chat. Add new variables to `.env.example` with empty or placeholder values.
- Money: store amounts as integer minor units (cents) or Prisma `Decimal`, never floats. Store dates
  in UTC; convert to the property's timezone only for display.
- Reservations must not double-book a room: enforce availability in the database (constraint or
  transaction), not only in application code.
- When adding a package, add its build/test/lint commands to this file.
