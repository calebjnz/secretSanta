# Secret Santa – API contract

Server: Node 24 + Express, SQLite via built-in `node:sqlite`. Static frontend served from `public/`.
Auth: HTTP-only cookie `sid` (session token stored in `sessions` table). All `/api` routes except register/login return `401 {error}` when not logged in.
All request/response bodies are JSON. Errors: `{ "error": "message" }` with 4xx status.

## Shapes
- `User`: `{ id, name, email }`
- `Member`: `{ id, name }`
- `FamilySummary`: `{ id, name, code, memberCount }`
- `Present`: `{ id, itemName, link|null, cost|null (number), forUserId, suggestedBy: { id, name }, familyId|null, createdAt }`

## Auth
| Method | Path | Body | Response |
|---|---|---|---|
| POST | /api/auth/register | `{ name, email, password }` | `{ user }` (logs in) |
| POST | /api/auth/login | `{ email, password }` | `{ user }` |
| POST | /api/auth/logout | – | `{ ok: true }` |
| GET | /api/auth/me | – | `{ user }` or 401 |

## Families
| Method | Path | Body | Response |
|---|---|---|---|
| GET | /api/families | – | `{ families: FamilySummary[] }` (families I belong to) |
| POST | /api/families | `{ name }` | `{ family: FamilySummary }` (creator auto-joins; `code` is 6-char uppercase) |
| POST | /api/families/join | `{ code }` | `{ family: FamilySummary }` (case-insensitive code) |
| GET | /api/families/:id | – | `{ family: { id, name, code, members: Member[], allocated: bool, allocatedAt|null } }` (403 if not a member) |
| POST | /api/families/:id/arrange | – | `{ ok: true }` – randomly (re)allocates everyone; needs ≥ 2 members. Replaces any previous allocation. |
| GET | /api/families/:id/assignment | – | `{ recipient: Member|null, ideas: Present[], suggestions: Present[] }` – my assigned person's present profile (`recipient` null if not arranged yet) |

## Presents
"Ideas" = presents a user adds for themself (`suggestedBy.id === forUserId`, `familyId` null).
"Suggestions" = secret presents suggested by someone else for a family member (scoped to a family). The recipient can NEVER see suggestions made for them.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | /api/presents/mine | – | `{ ideas: Present[] }` – my own present profile |
| POST | /api/presents | `{ itemName, link?, cost? }` | `{ present }` – add own idea |
| PUT | /api/presents/:id | `{ itemName, link?, cost? }` | `{ present }` – only the suggester may edit |
| DELETE | /api/presents/:id | – | `{ ok: true }` – only the suggester may delete |
| GET | /api/families/:id/members/:userId | – | `{ member: Member, ideas: Present[], suggestions: Present[] }` – another member's profile + secret suggestions for them in this family. 403 if `userId` is me. |
| POST | /api/families/:id/members/:userId/suggestions | `{ itemName, link?, cost? }` | `{ present }` – add secret suggestion. 403 if `userId` is me. |
