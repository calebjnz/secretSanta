# Secret Santa

A small web app for organising Secret Santa presents among family members.

## Run

Requires Node.js 22.13+ (uses the built-in `node:sqlite`).

```bash
npm install
npm start        # http://localhost:3000
npm test         # API end-to-end test against an in-memory database
```

The SQLite database is created automatically at `secretsanta.db` (override with `DB_FILE`).

## Layout
- `server.js` – Express API + static file server
- `db.js` – SQLite schema (users, families, family_members, presents, allocations, sessions)
- `public/` – single-page frontend (vanilla JS)
- `API.md` – API contract
