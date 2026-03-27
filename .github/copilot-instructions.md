# Data Hub - Copilot Instructions

## Project Overview
Arabic-language ISP subscriber management dashboard. Manages cities, customer subscriptions, monthly payments, expenses, incomes, and MikroTik router integration. All UI text is in Arabic with RTL layout.

## Architecture

### Monorepo Structure
- **Root (`/`)**: Legacy files (root `index.html`, `package.json`, `vite.config.ts`) — **IGNORE these**. Active code is in `frontend/` and `backend/`.
- **`frontend/`**: React 18 + TypeScript + Vite → Firebase Hosting (`frontend/dist/`)
- **`backend/`**: Express + TypeScript + `node-routeros` → Google Cloud Run (Docker)

### Data Flow
```
Frontend → Firebase Auth → Firestore (collections: cities, customers, expenses, incomes)
Frontend → Backend API (Cloud Run) → MikroTik routers via RouterOS API (port 8728)
```
No shared packages or build dependencies between frontend/backend — they are independent.

## Development

```bash
# Frontend
cd frontend && npm install && npm run dev    # localhost:5173
npm run build                                # output: frontend/dist/
npm run lint                                 # tsc --noEmit (type-check only, no tests)

# Backend
cd backend && npm install && npm run dev     # ts-node-dev with auto-reload
npm run build && npm start                   # compiles to backend/dist/
```
There are **no tests** in this project. Linting is TypeScript type-checking only.

## Single-File Frontend Architecture

**ALL frontend logic lives in `frontend/src/App.tsx` (~4100 lines)** — one `App` component with no sub-components or external state management. When adding features:

1. **Types** (lines 6–60): `City`, `Customer`, `AdditionalRouter`, `Expense`, `Income` — defined inline at top of file
2. **State** (lines 75–230): ~80 `useState` declarations. Add new state here. Group related state with comments.
3. **Derived data** (lines 230–370): `useMemo` blocks — `filteredCustomers`, `revenuesData`, `invoiceFilteredCustomers`, `searchResults`
4. **Business logic** (lines 370–950): CRUD functions for customers, expenses, incomes, discounts, suspend/resume
5. **Firestore subscriptions** (lines 955–1000): Single auth-gated `useEffect` with `onSnapshot` for all 4 collections — cleanup returns unsubscribe functions
6. **Tab-based rendering** (lines 1810–4137): `activeTab` state controls which section renders. Tabs: `dashboard`, `customers-db`, `invoices`, `yearly`, `revenues`, `expenses`, `discounts`, `suspended`, `microtik`

### Key Patterns

**Firestore writes** — uses `setDoc` with manually generated IDs (not `addDoc`):
```typescript
const id = Math.random().toString(36).slice(2);           // customers, cities
const id = Date.now().toString(36) + Math.random().toString(36).slice(2);  // expenses, incomes
await setDoc(doc(db, 'customers', id), customerData);
```

**Destructive actions require re-authentication** — deleting customers/cities/expenses/incomes and editing finances prompt for the user's password, then call `reauthenticateWithCredential` before proceeding.

**Firestore document shape** — documents are stored WITHOUT `id` field in Firestore; `id` is the document key and merged on read:
```typescript
snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer))
```

**Backend URL** — hardcoded fallback repeated ~7 times in App.tsx:
```typescript
const base = (import.meta.env.VITE_BACKEND_URL as string) || 'https://mikrotik-api-923854285496.europe-west1.run.app';
```

**PDF generation** — uses dynamic `import('html2pdf.js')` for client-side PDF export (invoices, customer database). Generates HTML strings with inline styles.

**Toast notifications** — `toastMessage` state + auto-dismiss via `useEffect` with 2200ms timeout.

## Arabic UI Conventions
- All user-facing strings are Arabic. Comments in code are also Arabic.
- Months array: `MONTHS_AR` — `['يناير', 'فبراير', ...]`
- Date formatting: `formatDate()` uses `'ar-EG'` locale
- Currency symbol: `﷼` (Saudi Riyal)
- RTL: `direction: rtl` in `frontend/src/index.css` (line ~2500)
- Font: Cairo (Google Fonts), imported in CSS line 1
- CSS variables defined in `:root` — `--primary`, `--danger`, `--success`, etc.

## Backend API (`backend/src/index.ts`, ~260 lines)

All MikroTik endpoints require `{ host, username, password, port? }` in request body. Uses `node-routeros` (`RouterOSAPI`) with helper `connectToRouter()`.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/mikrotik/dashboard` | POST | Full router info (system, secrets, active, interfaces) |
| `/mikrotik/secrets` | POST | Add PPPoE secret (extra `secret` object in body) |
| `/mikrotik/secrets/:id` | DELETE | Remove PPPoE secret |
| `/mikrotik/secrets/:id/toggle` | POST | Enable/disable PPPoE secret |
| `/mikrotik/active/:id/disconnect` | POST | Disconnect active PPPoE session |
| `/mikrotik/profiles` | POST | List PPP profiles |
| `/ip` | GET | Get egress IP (Cloud NAT verification) |

CORS whitelist: `datahub-44154.web.app`, `localhost:5173`, `localhost:3000`.

## Deployment

```bash
# Frontend → Firebase Hosting
cd frontend && npm run build && firebase deploy --only hosting

# Backend → Cloud Run (with Cloud NAT for static egress IP)
cd backend && docker build -t mikrotik-api .
# Push to GCR/Artifact Registry, deploy to Cloud Run
```
Firebase project: `datahub-44154`. Hosting serves `frontend/dist/` as SPA (all routes → `index.html`).

## Key Files
| File | Purpose |
|------|---------|
| `frontend/src/App.tsx` | Entire UI + all business logic (~4100 lines) |
| `frontend/src/firebase.ts` | Firebase SDK init (auth + Firestore exports) |
| `frontend/src/index.css` | All styles (~2900 lines, CSS variables, RTL) |
| `backend/src/index.ts` | All API routes (~260 lines) |
| `firestore.rules` | Security rules (auth-required for all collections) |
| `firebase.json` | Hosting config (SPA rewrites, serves `frontend/dist/`) |
