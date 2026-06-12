# FLOATING//QUOTA

Minimalist single-page fitness tracker built on a **floating weekly quota** instead of a
day-by-day calendar. Dark, monospace, data-dense. React + Vite + Tailwind CSS v4 +
Lucide icons. All state persists to `localStorage`.

## Run it

Requires Node **20.19+ or 22.12+** (Vite 8).

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
```

## The system

### 1. Floating quota (dashboard)

| Slot | Quota | Rule |
|---|---|---|
| Park strength | 3×/week | Warning when logged on consecutive (or same) days — checked across week rollovers |
| Cardio run/swim | 1–2×/week | Shin splint protocol (below) · warning past 2/2 |
| Soccer | 1×/week | Saturday slot — note when logged on another day |

Sessions attach to dates only for validation; nothing is "scheduled".

### 2. Park session logging

Guided circuit: Rows, Push-ups, Squats (reps) and Core (seconds), 3 sets each.
A **mandatory 2:00 rest countdown** auto-starts after every logged set and gates the
next input. Rest can be skipped, but every skip is recorded on the session as a
violation. A review screen allows corrections and a **STRUGGLED** flag before saving.

### 3. Cardio telemetry & shin splint protocol

Duration / distance / avg HR inputs plus a **Shin Status** toggle (GOOD / TIGHT).

- TIGHT **hard-locks RUN and forces SWIM** (the only hard block in the app).
- Run on **Friday** (pre-soccer) or **Sunday** (post-soccer) raises a warning and the
  save button flips to `OVERRIDE & LOG`.

Philosophy: injuries hard-block, judgement calls warn + override.

### 4. Progression engine (`COMPLETE WEEK`)

Previewed in a modal before anything is applied; confirming archives the week.

- **Micro-loading** — all park-quota sessions logged with every set at target ⇒ +1 rep
  (+5 s for core) to the first set. The increment ladders across weeks
  (`5·5·5 → 6·5·5 → 6·6·5 → 6·6·6 → 7·6·6 …`) so all sets eventually reach the cap.
- **Hold** — any session flagged STRUGGLED holds every target unchanged. Missed reps or
  an incomplete park quota hold that exercise, with the reason shown.
- **Hardware upgrade** — targets reaching 3×10 rows or 3×15 push-ups/squats trigger an
  `UPGRADE HARDWARE` alert (lower the bar/bench) and reset that exercise to 3×5.

## Layout

```
src/engine.js   pure rules: quotas, validation, progression (no React)
src/App.jsx     all UI: dashboard, park/cardio/soccer loggers, week review
```
