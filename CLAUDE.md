# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Arabic-language (RTL) ISP subscriber-management dashboard. Manages cities, customer subscriptions, monthly payment tracking, expenses/incomes, and MikroTik router (PPPoE) integration. All user-facing strings and most code comments are in Arabic.

## Monorepo layout

- **`frontend/`** — React 18 + TypeScript + Vite → deployed to Firebase Hosting. This is the active web app.
- **`backend/`** — Express + TypeScript + `node-routeros` → deployed to Google Cloud Run (Docker). Proxies the browser to MikroTik routers.
- **Root-level `index.html`, `package.json`, `vite.config.ts`, `tsconfig*.json`** — legacy scaffolding, **ignore them**. All real work happens inside `frontend/` and `backend/`, each with its own `package.json`. Always `cd` into the subdirectory first.

Frontend and backend are fully independent — no shared packages, no build-time dependency between them.

## Commands

```bash
# Frontend  (cd frontend)
npm install
npm run dev        # Vite dev server, http://localhost:5173
npm run build      # output → frontend/dist/
npm run lint       # tsc --noEmit — TYPE-CHECK ONLY

# Backend  (cd backend)
npm install
npm run dev        # ts-node-dev, auto-reload
npm run build      # tsc → backend/dist/
npm start          # node dist/index.js
```

There are **no tests and no test runner**. `npm run lint` is `tsc --noEmit` (type-checking) — there is no ESLint. Verify changes by type-checking and running the app.

## Data flow

```
Frontend ──Firebase Auth──▶ Firestore   (collections: cities, customers, expenses, incomes, cards)
Frontend ──HTTPS POST──────▶ Backend (Cloud Run) ──RouterOS API (port 8728)──▶ MikroTik routers
```

Firestore is the source of truth for business data; the backend is a stateless proxy that holds no data — every MikroTik request carries `{ host, username, password, port? }` in its body.

## Frontend architecture — one giant file

**Nearly all frontend logic lives in `frontend/src/App.tsx` (~4400 lines): a single `App` component** with no sub-components and no state library (~80 `useState` hooks). Styles are all in `frontend/src/index.css` (~5800 lines). When adding a feature, work *within* this structure rather than refactoring it — that is the deliberate convention here. Rough map of `App.tsx`:

1. **Types** (top) — `City`, `Customer`, `AdditionalRouter`, `Expense`, `Income`, `Card`, defined inline.
2. **State** — the ~80 `useState` declarations, grouped by Arabic comments.
3. **Derived data** — `useMemo` blocks: `filteredCustomers`, `revenuesData`, `invoiceFilteredCustomers`, `searchResults`, etc.
4. **Business logic** — CRUD for customers/expenses/incomes plus discounts and suspend/resume.
5. **Firestore subscriptions** — a single auth-gated `useEffect` sets up `onSnapshot` listeners for all collections and returns their unsubscribe fns for cleanup.
6. **Tab rendering** — `activeTab` state selects the visible section. Current tabs: `dashboard`, `customers-db`, `invoices`, `yearly`, `revenues`, `expenses`, `discounts`, `suspended`, `pool` (the MikroTik/PPPoE section).

### Non-obvious patterns (follow these)

- **Manual document IDs, not `addDoc`.** Writes use `setDoc(doc(db, coll, id), data)` with a client-generated `id` (`Math.random().toString(36).slice(2)`, or `Date.now().toString(36) + …` for expenses/incomes).
- **`id` is never stored in the document.** It's the Firestore doc key, merged back on read: `snapshot.docs.map(d => ({ id: d.id, ...d.data() }))`. Don't write an `id` field into a document.
- **Destructive/financial actions re-authenticate.** Deleting customers/cities/expenses/incomes and editing finances prompt for the user's password and call `reauthenticateWithCredential` before proceeding. Preserve this gate on any similarly sensitive action.
- **Backend URL fallback is hardcoded in ~7 places:** `(import.meta.env.VITE_BACKEND_URL as string) || 'https://mikrotik-api-923854285496.europe-west1.run.app'`. Change all occurrences together.
- **PDF export** uses dynamic `import('html2pdf.js')` and builds HTML strings with inline styles (invoices, customer DB).
- **Toasts**: `toastMessage` state auto-dismissed by a `useEffect` timeout (~2200ms).

### Arabic / RTL conventions

- All user-facing text is Arabic; comments are Arabic too. Keep new strings Arabic.
- `MONTHS_AR` holds month names; `formatDate()` uses the `ar-EG` locale; currency symbol is `﷼`.
- RTL and the Cairo (Google Fonts) font are set in `frontend/src/index.css`; theme colors are CSS variables on `:root` (`--primary`, `--danger`, `--success`, …).

## Backend API (`backend/src/index.ts`, ~260 lines)

All MikroTik routes are POST and require `{ host, username, password, port? }` in the body; `connectToRouter()` wraps `node-routeros`'s `RouterOSAPI`.

| Endpoint | Method | Purpose |
|---|---|---|
| `/mikrotik/dashboard` | POST | Full router info (system, secrets, active sessions, interfaces) |
| `/mikrotik/secrets` | POST | Add PPPoE secret (extra `secret` object in body) |
| `/mikrotik/secrets/:id` | DELETE | Remove PPPoE secret |
| `/mikrotik/secrets/:id/toggle` | POST | Enable/disable PPPoE secret |
| `/mikrotik/active/:id/disconnect` | POST | Disconnect an active PPPoE session |
| `/mikrotik/profiles` | POST | List PPP profiles |
| `/ip` | GET | Egress IP (Cloud NAT static-IP verification) |

CORS is a whitelist — add any new frontend origin there.

## Firebase / deploy

- Firebase project: **`meta-yen-487714-j8`** (see `.firebaserc` and `frontend/src/firebase.ts`). Hosting serves `frontend/dist/` as an SPA (all routes rewrite to `index.html`, per `firebase.json`).
- `firestore.rules` — every collection is `read, write: if request.auth != null` (any authenticated user; no per-user ownership).

```bash
# Frontend → Firebase Hosting
cd frontend && npm run build && firebase deploy --only hosting

# Backend → Cloud Run (uses Cloud NAT for a static egress IP the routers can whitelist)
cd backend && docker build -t mikrotik-api .    # then push + deploy to Cloud Run
```

The MikroTik routers only accept API traffic from the backend's static egress IP, so the backend must keep a stable outbound address (Cloud NAT) — the browser can never reach the routers directly.

## `ADD_TOWERS_TAB_PROMPT.md`

A standalone Arabic instruction file (not app code) describing how to graft a "Towers" (الأبراج) tab into `App.tsx` by inserting blocks at named anchors. It's a task recipe for another project, not part of this app's runtime — ignore it unless explicitly asked to work on the Towers feature.
