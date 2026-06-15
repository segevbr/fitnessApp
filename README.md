# Workout Tracker

Minimalist single-page workout tracker built on a **floating weekly quota** instead of a
day-by-day calendar. Monospace, data-dense, dark/light, installable as a phone app. React +
Vite + Tailwind CSS v4 + Lucide icons, with Supabase email auth and cross-device sync.

### Activity heatmap

A GitHub-style contribution grid (last 53 weeks) sits on the dashboard. Day colors:
**green** for a strength/soccer day, **light green** for a cardio-only day (run/swim still
counts as activity), **amber** for a day flagged *struggled*, **blue** for a rest day (the
default for any past day with no workout — resting is allowed in a floating quota), and
**red** for a *missed* day. Hovering a cell **lights up that whole week** and dims the rest;
tapping a workout opens a **detail window** (set-by-set for the current week; a type summary
for folded past days), while tapping a rest day flags it missed. Worked-out days fill in
automatically and persist across week rollovers via a daily log that records the activity type
(the per-week `sessions` list is cleared on rollover; the heatmap log is not). The header shows
the **live Monday–Sunday date range**, derived from the real date so it advances on its own.

**V2 calibration** — vertical-pull node unlocked, volume rebalanced, and hard structural
ceilings introduced to protect the Saturday soccer leg budget. State persisted under one
schema before (`floating-quota-v1`) is migrated automatically on load, from **both**
localStorage and Supabase: the week counter and the archive are preserved, and targets
reset to the V2 baseline (old movements can't be replayed onto the new ones).

## Run it

Requires Node **20.19+ or 22.12+** (Vite 8). The app needs a Supabase project to boot:

```sh
npm install
# create .env.local with your Supabase project credentials:
#   VITE_SUPABASE_URL=https://<project>.supabase.co
#   VITE_SUPABASE_ANON_KEY=<anon key>
npm run dev                  # http://localhost:5173
npm run build                # production bundle in dist/
```

`.env.local` must define `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; the backing
table is `user_data (user_id uuid pk, state jsonb, updated_at timestamptz)`. State writes
to localStorage immediately and upserts to Supabase on a 1.2 s debounce.

## Deploy (Vercel + custom subdomain)

`vercel.json` already targets the Vite build. To serve the app from, say,
`app.yourdomain.com` (substitute your own subdomain):

1. **Vercel env vars** — Project → Settings → Environment Variables, add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for **Production** (the build
   throws without them), then redeploy.
2. **Vercel domain** — Project → Settings → Domains → add `app.yourdomain.com`.
   Vercel shows a target host (a `cname.vercel-dns.com`-style value).
3. **GoDaddy DNS** — Domain → Manage DNS → add a record:
   `Type: CNAME` · `Name: app` (the prefix only) · `Value:` the host Vercel gave ·
   `TTL: 1 hour`. Save. Use a real CNAME, not GoDaddy "Forwarding".
4. Wait for DNS to propagate (minutes–1 h); Vercel auto-issues the HTTPS cert once it
   sees the record.
5. **Supabase auth URLs** — Supabase → Authentication → URL Configuration: set
   **Site URL** to `https://app.yourdomain.com` and add `https://app.yourdomain.com/**`
   to the redirect allow-list, so email/confirmation links resolve to the new domain.

## The system

### 1. Floating quota (dashboard)

| Slot | Quota | Rule |
|---|---|---|
| Park strength | 3×/week | Warning when logged on consecutive (or same) days — checked across week rollovers |
| Cardio run/swim | 2×/week | Shin splint protocol (below) · warning on a 3rd (extra load) |
| Soccer | 1×/week | Saturday slot — note when logged on another day |

Sessions attach to dates only for validation; nothing is "scheduled". Quota boxes are
plain binary done/not-done — extra sessions beyond a slot's target show only in the count
(e.g. `3/2`), not as boxes.

### 2. Park session logging

Guided circuit, 3 sets each — V2.1 baselines:

| Slot | Exercise | Unit | Baseline | Ceiling |
|---|---|---|---|---|
| Pull | Negative Pull-ups | reps | 5·5·5 | — |
| Push | Flat Push-ups | reps | 12·12·12 | — |
| Legs | **Hybrid** (see below) | reps | — | — |
| Core | Plank | sec | 60·60·60 | **60s** |

**Hybrid legs** — the leg exercise depends on which strength session of the week you're
logging (a `parkCount + 1` index): **session 1** is skill work — *Pistol Squats* `3·3·3`
(*"Neural skill work. 3 per leg max."*); **sessions 2–3** are active recovery — *Bodyweight
Squats* `15·15·15` (*"Active recovery. Hard cap at 15."*). Both variants start at their cap,
so they always hold. The dashboard targets card and the logger inputs switch automatically.

A **mandatory 2:00 rest countdown** auto-starts after every logged set and gates the next
input; each skip is recorded on the session as a violation. A **QUICK LOG** shortcut fills
the targets and skips the timer for fast entry. A review screen allows corrections and a
**STRUGGLED** flag before saving.

### 3. Cardio telemetry & shin splint protocol

Duration (MM:SS) / distance / avg HR inputs plus a **Shin Status** toggle (GOOD / TIGHT).

- TIGHT **hard-locks RUN and forces SWIM** (the only hard block in the app).
- Run on **Friday** (pre-soccer) or **Sunday** (post-soccer) raises a warning and the
  save button flips to `OVERRIDE & LOG`.

Philosophy: injuries hard-block, judgement calls warn + override.

### 4. Progression engine (`COMPLETE WEEK`) — V2 rules

Previewed in a modal before anything is applied; confirming archives the week.

- **Micro-load** — if all logged sets meet or exceed target across the park quota, add
  **+1 rep to the first set only** (`5·5·5 → 6·5·5 → 7·5·5 …`); core uses +5 s.
- **Strict hold** — if **any** logged set is below its target, the **entire exercise holds**
  its targets unchanged. A STRUGGLED flag or an incomplete park quota also holds.
- **Hard ceilings** — Squats never exceed **15** and Plank never exceeds **60 s**; at the
  ceiling the exercise holds (`CEILING — BUDGET LOCK`) to preserve legs for soccer. Other
  exercises are uncapped and keep climbing the first set.

The V1 "hardware upgrade / reset to 3×5" mechanic is retired — caps are ceilings the
targets hold at, not reset triggers.

## Layout

```
src/engine.js   pure rules: quotas, validation, V2 progression (no React)
src/App.jsx     all UI: auth gate, dashboard, loggers, week review, theme + sync
src/Auth.jsx    Supabase email sign-in screen
src/supabase.js Supabase client (reads VITE_SUPABASE_* env)
```
