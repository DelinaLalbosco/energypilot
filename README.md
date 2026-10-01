# EnergyPilot — A Silesian Family Home

HackoWatt 2026 · **Scenario 2: "A Silesian Family Home"** (Marek, Ania, Kuba and Zosia · Katowice, Poland).

EnergyPilot builds a realistic hourly consumption history for the family from **real Katowice weather** and a
**family calendar** (Marek's shift rota, Ania's home-office days, school), forecasts the next **24 hours, 3 days and
7 days** — plus the short power peaks inside each hour — with the best of eight machine-learning models (incl. LSTM and GRU neural networks) (chosen by
backtest, calibrated so it does not under-predict), keeps itself up to date every day,
learns online from live meter readings, optimises the heat pump and flexible appliances for the HackoWatt tariff, and
simulates rooftop solar with **PVGIS** data. Everything is shown in a web app with a 3D house.

```text
 Open-Meteo weather ─┐                    ┌─► models (8 candidates) ─► backtest ─► best + calibration
 family calendar ────┼─► hourly history ──┤
 appliance ranges ───┘   (1 year)         └─► forecast 24 h / 3 d / 7 d ─► optimiser + solar ─► dashboard
                                                   ▲                                              │
                                  live meter readings ── online / cumulative learning ◄───────────┘
```

### Project at a glance

| Folder | What it is |
|---|---|
| `docs/` | **Start here:** the solution document for the jury, and the challenge brief |
| `html/` | The whole dashboard in one file — double-click `energypilot_family_dashboard.html` |
| `data/` | The historical hourly profile, real weather, PVGIS solar data, offline snapshot |
| `model-training/` | Python: builds the profile, compares and trains the models, forecasts, optimises |
| `backend/` | Node + TypeScript API that serves the plan to the dashboard |
| `frontend/` | React dashboard (6 pages, 3D digital twin) |
| `shared/` | The data contract used by both backend and frontend |

---

## Contents

1. [What the solution does (brief → where)](#1-what-the-solution-does-brief--where)
2. [Run it](#2-run-it)
3. [Folder structure — every file](#3-folder-structure--every-file)
4. [The Python pipeline in detail](#4-the-python-pipeline-in-detail)
5. [The forecasting model](#5-the-forecasting-model)
6. [Online and cumulative learning](#6-online-and-cumulative-learning)
7. [Optimiser and solar simulator](#7-optimiser-and-solar-simulator)
8. [Backend (API)](#8-backend-api)
9. [Frontend (dashboard)](#9-frontend-dashboard)
10. [Assumptions](#10-assumptions)
11. [Demo script — answering Q1–Q4](#11-demo-script--answering-q1q4)
12. [Changing things](#12-changing-things)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. What the solution does (brief → where)

| # | Required outcome (brief) | How | Where |
|---|---|---|---|
| 1 | Historical hourly profile, ≥ 30 consecutive days | 362 days (1 Oct 2025 → yesterday), simulated hour by hour from the family calendar, meals, the brief's appliance ranges and **real** Open-Meteo weather | `model-training/generate_data.py` → `data/history.csv` |
| 2 | Forecasting model | 8 models (trees, linear, LSTM, GRU, baseline) compared in a rolling backtest; the winner (now the **ensemble of XGBoost and gradient boosting**) is calibrated against under-prediction; a second model forecasts the **short peaks** (highest 1-minute power) of each hour | `model-training/train_model.py`, `model-training/models.py` |
| 3 | Hourly forecast next 24 h | From today 00:00, with the **Open-Meteo weather forecast** and the planned family calendar | `model-training/forecast.py` → `output/forecast_7d.csv`; Forecast page |
| 4 | Forecasts for 3 and 7 days | Same run, 168 hours; totals + likely ranges | Forecast page → 24 h / 3 days / 7 days |
| 5 | Application | React + 3D web app (desktop, tablet, phone) | `frontend/`, `backend/`, `html/` |
| 6 | Hours with the highest demand | Peak hours per day and per period, traffic light, week calendar | Overview + Forecast pages |
| 7 | Explanation of changes | Per hour (appliances + who comes home / leaves / wakes up), per day (weather + shift + home office + school) and per period | chart tooltips, "Day by day", "Why" |
| 8 | Renewable simulator (kWp choice, production, share, grid reduction, savings, payback A and B) | **Any size 0–15 kWp (slider, 0.5 kWp steps)**; PVGIS production; savings shown as bill saving + export income (€0.08/kWh) − running cost (1 %/yr); investment €1,300/kWp; payback A and B (B = washing machine + dishwasher at their best hour); comparison table + payback-by-size chart | Solar page, `model-training/smart_optimizer.py` |
| + | Optimise demand for cost | OR-Tools: heat pump pre-heats before the €0.40 peak (house = heat battery), washing machine and dishwasher moved inside their windows | Heat pump + Cost & plan pages |
| + | Real weather (history + forecast), temperature impact | Open-Meteo archive + forecast, PVGIS | `model-training/weather.py` |
| + | Periods when different members are home | Presence per member per hour (away / home / asleep) | "Who's home" panel |
| + | Documented assumptions | In `scenario.json`, shown in the app | 📋 Assumptions & data |
| + | Short peaks inside the hour | Simulated minute by minute (cooking, cycle heaters, heat pump); forecast as "short peaks up to X kW" | hour detail, "busiest hours" card, insight |
| + | Always today's forecast | The backend re-runs the pipeline by itself when the forecast does not start today | banner at the top while updating |

Extras: online learning from meter readings (scripts), PDF/CSV report, personalised insights,
"Ask EnergyPilot" assistant (Claude, or offline rules), what-if, comfort slider.

---

## 2. Run it

### Requirements
- **Python 3.12** (3.10+ works) — pipeline
- **Node.js 20+** (tested 22.9) — dashboard
- Internet once, for weather and PVGIS downloads (then cached)

### First-time setup
```bash
cd model-training
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cd ..
npm install              # frontend + backend (npm workspaces)
```

### Run the pipeline (creates all data, model and outputs)
```bash
cd model-training
.venv/bin/python run_pipeline.py          # everything, ≈ 3 minutes
```
Options: `--quick` skips the model comparison (≈ 15 s), `--offline` uses the cached weather.
Each step can also run on its own (see [section 4](#4-the-python-pipeline-in-detail)).
The repository already contains the outputs, so you can skip this step and start the dashboard directly.

### Start the dashboard (two terminals, from the project folder)
```bash
npm run dev:backend      # terminal 1 → API on http://localhost:8787
npm run dev:frontend     # terminal 2 → open http://localhost:5173
```
The backend re-reads the pipeline files whenever they change — re-run a Python script and refresh the browser.

**Daily refresh is automatic.** When the backend starts (or the app asks for a plan) and the forecast does not start
*today*, it runs `model-training/.venv/bin/python run_pipeline.py --quick` in the background (≈ 30 s: new weather, history up to
yesterday, chosen model re-trained on all data, forecast from today, new plan). The dashboard shows a yellow
"Updating to today's forecast…" banner and switches when it is done. Without internet the cached weather is used and it
retries every 30 minutes. `AUTO_REFRESH=0` switches it off; `ENERGY_PYTHON=…` picks another Python. The full model
comparison (`run_pipeline.py` without `--quick`, ≈ 3 min) is only needed after changing the data or models.

### Without backend (offline demo / website build)
Copy `frontend/.env.example` to `frontend/.env` and set `VITE_USE_MOCK=true`. The app then uses the snapshot in
`data/sample/energy-plans.json`. Refresh the snapshot after re-running the pipeline:
```bash
npm run export:sample
```
If the backend is unreachable, the app falls back to this snapshot automatically.

### One-file dashboard (no server, opens by double-click)
```bash
npm run build:standalone      # → html/energypilot_family_dashboard.html
```
A single, self-contained HTML file (≈ 5.5 MB): all code, styles, the 3D house and the offline data snapshot are
inside. Open it directly in any modern browser (desktop, tablet or phone) — no internet needed except for the
Google web fonts. Everything works as in offline mode: forecast, plan, solar simulator, what-if, PDF/CSV
export and the rule-based Ask assistant. The daily auto-refresh and Claude answers need the
backend. Rebuild it after re-running the pipeline.

### Responsive layout
Every page has a 3D view of its own data (drag to turn, slow auto-rotation, off with "reduce motion"): the 3D house on the Overview, a 24-hour energy clock on Forecast, the heat-pump house following the hour slider, a cost ring (usual vs plan over the tariff zones), a solar roof that fills with panels, and appliance spheres sized by energy (click to filter). The page background is a soft blue-teal-violet tint in both themes.

The dashboard adapts to desktop, tablet and phone: below 1024 px the sidebar becomes a sticky row of page tabs
(swipe sideways), the header buttons a 2-column grid, card rows stack to one or two columns, charts are drawn narrower so their labels stay readable, wide tables become cards
(solar) or hide less important columns (appliances), and buttons, toggles and sliders get larger tap targets on
touch screens. No sideways page scrolling at 375 px.

### Online learning demo (meter readings)
```bash
cd model-training
.venv/bin/python meter_simulator.py --interval 1 --reset   # sends today's (simulated) meter readings to the backend
.venv/bin/python update_model.py                           # learns from them, refreshes forecast + plan
```
No real smart meter is connected, so there is no live-data button in the dashboard; real readings can be sent to
`POST /api/readings` (see section 8) and `update_model.py` learns from them the same way.

### "Ask EnergyPilot" with Claude (optional)
Create `backend/.env` with `ANTHROPIC_API_KEY=sk-ant-...` and restart the backend. The key stays on
the server. Model `claude-opus-5` (override with `ASSISTANT_MODEL`), with Anthropic's server-side model fallback. Without a
key the assistant answers from rules (`shared/assistant.ts`).

---

## 3. Folder structure — every file

```text
family/
├── README.md                     this file
├── package.json                  npm workspaces (frontend + backend) and the run scripts
│
├── docs/                         documentation and the challenge brief
│   ├── EnergyPilot_Documentation.pdf   solution document for the jury (problem, solution, Q1–Q4, architecture)
│   ├── HackoWatt-Scenario-2-A-Silesian-Family-Home.pdf
│   └── HackoWatt-Common-Challenge-Assumptions.pdf
│
├── html/
│   └── energypilot_family_dashboard.html   the whole dashboard in one file — double-click to open
│
├── data/                         all data files
│   ├── history.csv               the household's hourly history (appliances, presence, indoor temp, peak_kw)
│   ├── weather_history.csv       real hourly weather, history period (Open-Meteo archive)
│   ├── weather_forecast.csv      real hourly weather forecast, today → +8 days (Open-Meteo)
│   ├── pvgis_hourly.csv          PV kWh per kWp for every month/day/hour (JRC PVGIS typical year)
│   ├── future_truth.csv          hidden simulated truth for the forecast week (meter simulator only)
│   ├── live_readings.csv         meter readings received by the backend (created on demand)
│   └── sample/energy-plans.json  offline snapshot for the dashboard (every PV size × comfort level)
│
├── model-training/               PYTHON: profile, models, forecast, optimiser
│   ├── scenario.json             ALL settings: family, calendar, meals, appliances, tariff, heat pump,
│   │                             solar, model options, file paths, documented assumptions
│   ├── scenario.py               loads scenario.json + helpers (paths, prices, flexible windows, comfort levels)
│   ├── weather.py                Open-Meteo history + forecast, PVGIS typical year (cached in ../data/)
│   ├── household.py              family calendar: who is home / awake / asleep each hour (planned + unplanned)
│   ├── generate_data.py          simulates the hourly history (and the hidden "true" forecast week)
│   ├── features.py               model inputs (time, weather, planned presence, lags)
│   ├── models.py                 the candidate models (trees, linear, LSTM, GRU, baseline)
│   ├── train_model.py            backtest → choose → calibrate → train on all data
│   ├── forecast.py               24 h / 3 d / 7 d forecast from today
│   ├── smart_optimizer.py        OR-Tools daily plan + yearly solar simulator
│   ├── update_model.py           online + cumulative learning from live readings
│   ├── meter_simulator.py        sends live meter readings (replays the hidden truth)
│   ├── plot_true_vs_predicted.py true vs predicted charts → output/internal/
│   ├── run_pipeline.py           runs everything in order
│   ├── requirements.txt
│   ├── models/energy_model.pkl   trained model package
│   └── output/                   what the dashboard reads
│       ├── forecast_7d.csv       forecast per hour: total, bands, short peak, appliances, presence, PV per kWp
│       ├── forecast_accuracy.json model choice, backtest scores, calibration, period ranges
│       ├── model_comparison.csv  the 8 models side by side
│       ├── backtest.csv          hourly backtest of the winner (for plots)
│       ├── smart_plan.csv        plan day: usual vs optimised, per PV size × comfort level
│       ├── solar_scenarios.csv   yearly solar simulator for every size 0–15 kWp (0.5 steps)
│       ├── learning_log.json     online-learning runs (created by update_model.py)
│       └── internal/             true-vs-predicted charts (backtest weeks, scatter, forecast week)
│
├── backend/                      Node + TypeScript HTTP API (no framework)
│   ├── src/api/server.ts         routes: /api/health, /api/plan, /api/readings, /api/ask
│   ├── src/providers/energyData.ts  reads scenario.json and every pipeline file (cached by mtime)
│   ├── src/providers/planProvider.ts  getPlan() entry point
│   ├── src/providers/pipelineRefresh.ts  re-runs the pipeline when the forecast is not for today
│   ├── src/domain/plan.ts        builds the PlanResponse: hours, advice, explanations, totals
│   ├── src/domain/horizon.ts     24 h / 3 d / 7 d periods, day types, likely ranges, summaries
│   ├── src/domain/presence.ts    who is home per hour + "Kuba comes home" style texts
│   ├── src/domain/insights.ts    personalised insights (heating share, shift weeks, home office, peak …)
│   ├── src/domain/readings.ts    smart-meter input (JSON/CSV) → data/live_readings.csv
│   ├── src/domain/assistant.ts   Claude call (with fallback to offline answers)
│   └── scripts/export-sample.ts  snapshot for offline mode → data/sample/energy-plans.json
│
├── shared/                       used by backend AND frontend
│   ├── types.ts                  the data contract (PlanResponse …) + scenario registry
│   └── assistant.ts              plan summary for the LLM + offline rule-based answers
│
└── frontend/                     React 19 + Vite + Tailwind 4 + React Three Fiber
    ├── index.html  vite.config.ts  tsconfig.json  package.json
    ├── .env.example              VITE_USE_MOCK, VITE_API_BASE_URL
    └── src/
        ├── main.tsx              entry, click animations
        ├── App.tsx               sidebar, page header, theme, 3D house
        ├── data/                 contract.ts (re-export of shared types), apiProvider.ts (fetch),
        │                         mockProvider.ts (snapshot), index.ts (API with mock fallback)
        ├── components/
        │   ├── Dashboard.tsx     pages (PAGES), forecast charts, why card, cost table, solar simulator, hour detail
        │   ├── Overview.tsx      Overview visuals: hero banner + animated house, steps, habit changes, solar card
        │   ├── ForecastVisuals.tsx  Forecast banner (period switch, weather picture, drawing curve), time of day
        │   ├── HeatPumpVisuals.tsx  Heat-pump banner + interactive house scene, heat-battery steps
        │   ├── CostVisuals.tsx   Cost banner (bills + piggy bank)
        │   ├── SolarVisuals.tsx  Solar banner (size slider, roof filling with panels, energy flows)
        │   ├── HomeVisuals.tsx   Appliances banner (bubbles) and the digital-twin banner (room tiles)
        │   ├── HouseScene.tsx    3D house (rooms, solar roof, grid transformer, trees), auto-rotating
        │   ├── Page3D.tsx        a 3D view on every page: energy clock (Forecast), heat pump house, cost ring, solar roof, appliance spheres
        │   ├── Features.tsx      traffic light, week calendar, comfort slider, what-if, equivalents, Who's home
        │   ├── ActionModals.tsx  header buttons: ask, insights, assumptions, export report
        │   ├── AskAssistant.tsx  chat
        │   ├── PageBackdrop.tsx  soft drifting colour glows behind the Heat pump, Cost & plan, Solar and Appliances pages
        │   ├── pictures.ts       picture (emoji) for each appliance and room
        │   ├── Icon.tsx          line icons (navigation, KPI cards, buttons)
        │   └── Info.tsx          ⓘ glossary
        ├── pdfReport.ts, report.ts  PDF and CSV export
        ├── clickEffects.ts       click ripple
        └── styles.css            colours (light/dark), Inter font, animations
```

---

## 4. The Python pipeline in detail

All scripts run from `model-training/` with `.venv/bin/python <script>`. They read every setting and path from `scenario.json` (data files live in `../data/`).

| Step | Script | Reads | Writes | Time |
|---|---|---|---|---|
| 1 | `weather.py` | Open-Meteo, PVGIS | `data/weather_*.csv`, `data/pvgis_hourly.csv` | 10–60 s |
| 2 | `generate_data.py` | weather, `scenario.json` | `data/history.csv`, `data/future_truth.csv` | 1 s |
| 3 | `train_model.py` | history | `models/energy_model.pkl`, `output/forecast_accuracy.json`, `output/model_comparison.csv`, `output/backtest.csv` | ≈ 2 min (`--quick` 10 s) |
| 4 | `forecast.py` | model, history, weather forecast | `output/forecast_7d.csv` (+ ranges in accuracy json) | 3 s |
| 5 | `smart_optimizer.py` | forecast, history, PVGIS | `output/smart_plan.csv`, `output/solar_scenarios.csv` | 1 s |
| – | `update_model.py` | live readings | history (+ days), model, forecast, plan, `output/learning_log.json` | 10 s |
| – | `plot_true_vs_predicted.py` | backtest, forecast, hidden truth, readings | `output/internal/*.png` (internal only) | 5 s |

### weather.py
- **History:** Open-Meteo *archive* API for 1 Oct 2025 → yesterday: temperature, horizontal radiation, radiation on
  the PV plane (35° tilt, south), cloud cover. If the archive lags, the last days come from the forecast API.
- **Forecast:** Open-Meteo *forecast* API, today 00:00 → +8 days.
- **PVGIS:** hourly PV output of 1 kWp (35°, south, 14 % loss) for 2019–2023, averaged to a typical year
  (1,072 kWh/kWp).
- Local time (Europe/Warsaw), always 24 rows per day (daylight-saving hour interpolated).
- Downloads are cached; without internet the last files are used.

### household.py — the family calendar
Each member is **away (0)**, **home awake (1)** or **home asleep (2)** for every hour.
- *Planned* (the forecast may use it): Marek's weekly rotating shift (morning / afternoon / night, incl. the night-shift
  spill-over and sleep 07–14), Ania's home-office days (Tue, Thu + 25 % of other weekdays), school days and hours,
  activities (football, dance), public holidays, school breaks, Saturday shifts.
- *Unplanned* (only in the history): weekend family outings, weekend trips, evenings out, sick days.
- Random choices are seeded by (seed, date), so every date always gets the same calendar.
- Try it: `.venv/bin/python household.py` prints this week's calendar.

### generate_data.py — the historical profile
Per day and hour:
- **Meals** trigger cooking: breakfast at each person's wake-up (kettle, coffee per adult, sometimes the hob), lunch
  when an adult is home, the kids' snack, dinner 17:30–19:30 ± 45 min (hob, oven, kettle), and a late meal after
  Marek's shift. Power × minutes from the brief (e.g. kettle 2 kW × 3–5 min).
- **Screens** (TV, console, desktop, laptop) run while their users are home and awake; sessions last several hours;
  Ania's laptop runs through her home-office day.
- **Cycles:** washing machine ≈ 4.5/week, dishwasher ≈ 6/week (after dinner at home), only with an adult at home.
- **Lighting** when people are awake and the real radiation is below 20 W/m²; **charging**; **always-on** fridge,
  router, standby.
- **Heat pump:** a physical model of the house — heat loss 0.25 kW/°C (older house), thermal mass 8 kWh/°C, internal
  gains 80 W/person, solar gains from real radiation, COP 3.6 at 7 °C falling to 2.4 at −7 °C, max 3.5 kW electric.
  It heats towards 21 °C (day), 19.5 °C (night 22–06) and 20 °C (house empty); heating **fades out** as the 24-hour mean rises
  from 13 °C (full) to 17 °C (off) — `heating_limit_c` 15 °C ± `heating_limit_band_c`/2 — like a weather-compensated
  heat pump in spring and autumn, so mild days do not jump from full heating to none. This creates realistic morning recovery peaks and higher use on cold days.
- **Short peaks:** cooking and the water heaters of the washing machine (2.0 kW, 10–20 min) and dishwasher (1.8 kW,
  15–25 min) are also written minute by minute; the heat pump runs at ≥ 1.5 kW (cycling on and off when less is needed).
  `peak_kw` = the highest 1-minute power of each hour. Example: at 06:00 the hour averages 3.0 kWh but the power
  typically reaches 5.2 kW for a few minutes; the record is 13.1 kW (heat pump + hob + oven + kettle + dishwasher).

Result: ≈ 10,700 kWh/year (heat pump 6,700, other appliances 4,000), 12 kWh/day in summer, 62 kWh/day in January,
highest hour 7.8 kWh (a cold January evening).

---

## 5. The forecasting model

### Inputs (`features.py`) — only what is known before the hour
| Group | Inputs |
|---|---|
| Time | hour (+ sin/cos), weekday, free day (weekend/holiday), school day |
| Weather | outdoor temperature, 24-hour mean (thermal inertia), heating degrees (17 °C − mean, weighted by the heating fade-out), solar radiation |
| Planned calendar | each member's state, people home / awake, kids home, wake-ups, arrivals, heating setpoint and its change, Marek's shift, Ania's home office |
| Recent demand (one model only) | same hour yesterday, same hour last week, yesterday's mean |

Unplanned events are **not** inputs — the forecast cannot know them. That is why a real forecast has errors.

### Candidates (`models.py`)
| Name | What it is |
|---|---|
| `seasonal_naive` | same hour last week (baseline) |
| `ridge` | linear regression |
| `hist_gbm` | gradient-boosted trees (scikit-learn) on the total |
| `xgboost_direct` | XGBoost with one output per appliance; total = sum |
| `xgboost_recursive` | XGBoost on the total with lagged demand, forecast day by day |
| `ensemble` | average of `hist_gbm` and `xgboost_direct` |
| `lstm` | LSTM neural network (PyTorch): reads the last 24 h of inputs for every hour |
| `gru` | GRU neural network (PyTorch), same set-up as the LSTM |

### Choosing the model (`train_model.py`)
**Rolling-origin backtest:** 8 test weeks — Dec, Jan, Feb, Apr (heating season) and the 4 most recent weeks. For
each week every model is trained **only on the data before it** (cumulative learning) and forecasts the next
7 days with **weather-forecast errors added** (≈ 0.6 °C on day 1 growing to ≈ 2 °C on day 7, radiation ± 25 %).

| Model | Hourly error | 24 h total | 3 days | 7 days | Days under-predicted |
|---|---|---|---|---|---|
| **🏆 ensemble** | **0.31 kWh** | **11.1 %** | **3.5 %** | **3.7 %** | 46 % → **21 %** after calibration |
| xgboost_direct | 0.32 kWh | 11.1 % | 5.5 % | 6.3 % | 29 % |
| hist_gbm | 0.32 kWh | 12.6 % | 4.0 % | 3.9 % | 62 % |
| xgboost_recursive | 0.33 kWh | 12.0 % | 5.2 % | 5.0 % | 43 % |
| gru | 0.32 kWh | 13.0 % | 6.1 % | 2.7 % | 55 % |
| lstm | 0.33 kWh | 15.4 % | 6.7 % | 5.7 % | 55 % |
| ridge | 0.46 kWh | 21.3 % | 11.2 % | 8.0 % | 55 % |
| seasonal_naive | 0.68 kWh | 42.4 % | 37.4 % | 35.5 % | 46 % |

(The top models are close; the winner can change when the data changes — the backtest decides, not us.)

**Why not LSTM / GRU?** They were tested in exactly the same backtest. The GRU is competitive (best 7-day error,
2.7 %) but its hourly and daily errors are higher, so it ranks 5th; the LSTM ranks 6th.
With one year of hourly data (≈ 8,700 rows) and strong, known inputs (weather, calendar), gradient-boosted trees
learn the same patterns with less data, train in seconds instead of minutes, and give steadier results. Deep
sequence models usually win with much more data (many households / several years).

Ranking = hourly error % + daily-total error % of the **calibrated** forecast (the one actually used).
Single hours are noisy by nature (a kettle is 2 kW for 4 minutes, a meal 30 minutes later moves energy to the next hour);
period totals are accurate. The dashboard explains this on the Forecast page (**How accurate is the forecast?**): after
calibration a single hour is ±28 %, the 24 h total ±12 %, 3 days ±7 %, 7 days ±9 % — most of the multi-day error is the
deliberate +7 % safety margin.

### Not under-predicting
The winner's forecast is multiplied by a factor **k = 1.056**, chosen so that at most 20 % of backtest days are
under-predicted (`scenario.json → model.no_underprediction_quantile = 0.8`). After calibration: days under-predicted
21 %, bias +6.9 %. On top of that every hour has a **90 % upper band** and a lower band (from the backtest residuals
per hour of day), and every period has a **likely range** (from the backtest error distribution).

Appliance break-down: `xgboost_direct` per appliance, scaled so the appliances add up to the winner's total.

**Short peaks:** a quantile XGBoost model (90 % level) forecasts `peak_kw`, the highest 1-minute power of each hour,
from the same inputs. Tested on the last 4 weeks: 88 % of hours stay below it (typical gap 1.4 kW). Shown as
"short peaks up to X kW" — the hourly kWh (= average kW) hides them.

**Internal true-vs-predicted check** (not in the dashboard): `.venv/bin/python plot_true_vs_predicted.py` writes
`output/internal/backtest_weeks.png` (every backtest week, true vs predicted), `backtest_scatter.png` (hourly and
daily, with the diagonal) and `forecast_week.png` (current forecast vs the hidden simulated truth and live readings).
All 8 backtest weeks are over-predicted in total (+4 % … +25 %), none under-predicted.

---

## 6. Online and cumulative learning

`update_model.py` learns from the meter readings in `data/live_readings.csv`:

1. **Online calibration** (reacts immediately, no re-training): compares measured vs forecast on the same hours and
   updates k: `k ← k · (1 − a + a · measured/forecast)`. Asymmetric because under-prediction is worse: `a = α` (0.3)
   when the meter shows more than forecast, `α/4` when it shows less; k never falls below 95 % of the backtest value.
2. **Cumulative learning:** every complete measured day is appended to `data/history.csv` and the model is re-trained on
   **all** data (`train_model.py --quick`, ≈ 10 s). The same happens in the backtest, where each test week is trained on
   everything before it.
3. **Refresh:** forecast (now starting after the newest measured day) and plan are recomputed; the dashboard updates.

Every run is logged in `output/learning_log.json`.
Note: `generate_data.py` rebuilds the history from scratch (removes appended days).

---

## 7. Optimiser and solar simulator

### Daily plan (`smart_optimizer.py`, OR-Tools mixed-integer program)
Solved for every PV size (0, 3, 5, 8, 10 kWp) × comfort level (Warmest, Comfort, Balanced, Cheapest):
- **Heat pump as a heat battery:** indoor temperature `T[t+1] = T[t] + (heat − forecast heat − 0.09·(T − 21)) / 2.5`
  (electric-equivalent units). It may heat more while cheaper and rest during the **€0.40 peak (17–22)**; T stays
  inside the comfort band (day and night limits).
- **Flexible appliances:** washing machine window 04–17 (delay start / solar hours), dishwasher window 21–07
  (after dinner, cheap night from 00:00). Exactly one start each.
- Grid ≥ load − PV (PV from the Open-Meteo radiation forecast for today).
- Objective: grid cost + 0.20 × peak grid hour + tiny comfort term.

Today (5 kWp, Comfort): **€4.81 → €3.80 (−21 %)**, grid peak 5.2 → 1.4 kWh; washing machine 06:00 → 11:00,
dishwasher 21:00 → 00:00.

### Yearly solar simulator
For **every size from 0 to 15 kWp in 0.5 kWp steps** (`scenario.json → solar.simulator_kwp`) over the full history,
hour by hour: PVGIS production, self-consumption, export, grid reduction and
**net saving = bill saving + export income (€0.08/kWh) − running cost (1 % of the investment per year)**;
payback = investment ÷ net saving. **A** = current habits, **B** = washing machine + dishwasher moved to the best hour
of their window. In the app a slider picks any size; the table compares the standard sizes plus the chosen one.

| PV | Investment | Production | Covers | Less grid | Bill saving | Export income | Running cost | Net saving | Payback A | Payback B |
|---|---|---|---|---|---|---|---|---|---|---|
| 3 kWp | €3,900 | 3,224 kWh | 17 % | 1,796 kWh | €520 | €114 | −€39 | €595 | 6.6 yr | 5.6 yr |
| 5 kWp | €6,500 | 5,374 kWh | 21 % | 2,296 kWh | €667 | €246 | −€65 | €848 | 7.7 yr | 6.8 yr |
| 8 kWp | €10,400 | 8,598 kWh | 26 % | 2,773 kWh | €809 | €466 | −€104 | €1,171 | 8.9 yr | 8.2 yr |
| 10 kWp | €13,000 | 10,748 kWh | 28 % | 2,996 kWh | €876 | €620 | −€130 | €1,366 | 9.5 yr | 8.9 yr |

Small systems pay back fastest (the house uses all their power); bigger ones save more per year but export more at
only €0.08/kWh, so their payback grows. The daily plan (buttons 0 / 3 / 5 / 8 / 10 kWp) is optimised for those sizes.

---

## 8. Backend (API)

Node + TypeScript (`tsx watch`), no framework, port 8787. It never computes forecasts itself — it reads the Python
outputs (re-read when a file changes) and turns them into one JSON document for the app.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{ ok: true }` |
| GET | `/api/plan?now=18&pv=5&comfort=standard` | `PlanResponse`: scenario (members, assumptions …), 24 hours (forecast, bands, short peak, presence, plan, advice, explanation), recommendations, heating plan, solar scenarios (every size), live status, insights, 24 h / 3 d / 7 d horizon, model accuracy, totals, `source.freshness` (is the forecast for today / is it updating) |
| POST | `/api/readings` | store meter readings — JSON `[{"timestamp":"2026-09-28 18:00","total_kwh":2.4,"heat_pump_kwh":0.6}]` or CSV `timestamp,total_kwh,...` |
| GET / DELETE | `/api/readings` | list / clear readings |
| POST | `/api/ask` | `{question, history, pv, comfort}` → `{answer, source: "claude" \| "offline", note?}` |

Flow: `server.ts` → `planProvider.getPlan()` → `domain/plan.ts buildPlan()` which uses `providers/energyData.ts`
(files), `domain/horizon.ts` (periods), `domain/presence.ts` (who is home), `domain/insights.ts`.
The data contract is `shared/types.ts` — change it there and both sides see the change (TypeScript checks it:
`npm run typecheck`).

---

## 9. Frontend (dashboard)

React 19, Vite 7, Tailwind 4, React Three Fiber (3D), jsPDF. `src/data/index.ts` calls the API and falls back to the
snapshot. The layout (`App.tsx`) follows a standard admin dashboard: a **sidebar** with the pages, the household
(Marek, Ania, Kuba, Zosia) and the data status, a **page header** (title, one-line explanation, Katowice, forecast date,
action buttons) and white cards on a light-grey page (dark mode in the sidebar). Every page opens with its key numbers.

| Page | Shows |
|---|---|
| Overview | first the **digital twin**: an indigo banner with the hour slider and one clickable tile per room (energy in that hour — click to highlight the room), the 3D house (rooms light up with their load, solar roof, grid transformer with the power line, trees; rotates by itself with a pause button, full-screen mode) and the forecast for that hour per appliance; then a colourful **Today at a glance** banner (animated house: sun, solar roof, grid, energy flow; energy, cost, peak hours, solar today); **How EnergyPilot works** — 4 colour-coded clickable steps (history → forecast → optimise → solar); "Right now" traffic light (+ spoken summary); hourly forecast chart with a **Why this forecast** button; suggested habit changes as pictures (usual time → new time, saving); solar card (share of the home covered as a ring); who's home; best times this week |
| Forecast | colourful **forecast banner** with the period switch (24 h / 3 days / 7 days), total, likely range / per day, highest hour, outdoor temperature, a weather picture and the forecast curve drawing itself; the chart shows **only the model forecast** (calibrated, no under-prediction) with the likely range, busiest hours and the **outdoor temperature forecast** (true vs predicted stays internal), with a **Why this forecast** button (gradient bars, click a bar to pick the hour); **When is the energy used?** (night / morning / afternoon / evening with share and price); **How accurate is the forecast?**; who's home (pie per person); forecast at HH:00 for every appliance; for 3/7 days: hourly chart with likely range and day by day |
| Heat pump | warm **heat-pump banner** (glow follows the pointer): today's heat-pump kWh and share, saving, pre-heat hours, comfort band, and an **interactive house scene** — move the hour slider and the outdoor fan, pipe, heat waves, indoor colour and thermometer react (heating ahead / resting / off); **How the heat battery works** (charge → store → rest with today's hours); comfort level; heat-battery chart (usual vs optimised heating, indoor temperature inside the comfort band) |
| Cost & plan | green **cost banner** (glow follows the pointer): usual vs plan cost, saving today and ≈ per year, with an animated picture (the two bills and coins dropping into a piggy bank); **today's cost** (how the saving works, interactive hourly cost chart (usual vs plan or saving per hour, over the tariff zones; hover for numbers, click for the explanation), what changes today, full hourly table on a button); suggested habit changes + today's actions; colour-coded **what-if planner** (family trip / guests / cold snap); everyday equivalents as colourful picture tiles |
| Solar | sun-to-sky **solar banner** (glow follows the pointer) with the **size slider (0–15 kWp)** → production, home covered, net saving, payback, and an animated house whose roof fills with panels as the size grows, with the energy flows to the house and to the grid; money breakdown (bill saving, export income, running cost, investment, payback A and B); **"Where does the solar power go?"**; **"When is it paid back?"**; comparison table |
| Appliances | violet **appliances banner**: number of appliances, biggest user, appliances that can be moved, always-on energy, and the biggest users as floating **bubbles** (size = energy; click one to filter the table by its room); appliance forecast pie with the hour slider inside; forecast and plan per appliance with pictures (filter by room) |

Header buttons (`ActionModals.tsx`): **Ask EnergyPilot**, **Insights**, **Assumptions** (with data sources) and
**Export report** (PDF / CSV).
ⓘ icons explain terms (`Info.tsx`).

---

## 10. Assumptions

The full list lives in `model-training/scenario.json → assumptions` and is shown in the app (📋). Summary:

- **Family:** Marek 3-shift rota rotating weekly (+ 1 in 4 Saturdays); Ania home office Tue/Thu + 25 %; Kuba (14)
  school 08–15, football Mon/Wed 16–18; Zosia (10) school 08–14, dance Tue/Fri 16–18; Silesian school breaks and
  Polish holidays; unplanned outings/trips/evenings out/sick days.
- **Appliances:** brief's ranges; meals drive cooking; screens need their users at home; ≈ 4.5 washes and 6 dishwasher
  cycles per week; a cycle counts in its start hour.
- **Heating:** air-to-water heat pump, older house (0.25 kW/°C), COP 3.6 → 2.4, setpoints 21 / 19.5 / 20 °C, no hot
  water in the heat pump.
- **Data:** real Open-Meteo weather for Katowice; history simulated from 1 Oct 2025 to yesterday.
- **Costs:** HackoWatt tariff €0.18 / 0.28 / 0.40 / 0.28, export €0.08, PV €1,300/kWp, running cost 1 %/yr, PVGIS
  1,072 kWh/kWp (35°, south, 14 % loss). CO₂ 0.66 kg/kWh (Polish grid, approx.).
- **Optimiser:** only the heat pump timing, washing machine and dishwasher move; comfort stays in the chosen band.

---

## 11. Demo script — answering Q1–Q4

1. **Overview** first: "How EnergyPilot works" (the 4 steps), key numbers, "Right now", the forecast with its "Why", best times this week.
2. **Q1 — expected demand:** Forecast page → 24 h (18.4 kWh, likely 15–20), 3 days (46.8 kWh), 7 days (125.5 kWh); point at the
   temperature line and the shaded likely range. Explain the model choice: 8 models (incl. LSTM/GRU), backtest, calibration (section 5).
3. **Q2 — highest demand:** the 06:00 heat-pump recovery + breakfast and the 18:00–19:00 dinner peak — with short
   peaks up to ≈ 5–8 kW (hob + oven + kettle at once — see the hour detail and the "Short power peaks" insight); hover a bar →
   "Demand rises … mainly oven … Kuba comes home"; Day by day explains each day (shift, home office, weather).
4. **Q3 — habit changes:** Today's actions, cost table (dishwasher → 00:00 at €0.18, washer → 11:00 sunshine, heat
   before 17:00), comfort level on the Heat pump page (up to €1.59/day), insights ("The evening peak = 41 % of the bill", shift weeks,
   home-office days).
5. **Q4 — solar:** Solar page: move the slider; 5 kWp covers 21 %, saves €848/yr net (€667 bill + €246 export − €65
   running cost), payback 7.7 years, 6.8 with shifted habits; the chart shows payback for every size.
6. **Learning:** run `meter_simulator.py` then `update_model.py` — the model adds the new day and re-trains in seconds.
7. **Ask EnergyPilot:** "Why is Monday morning so high?", "Is solar worth it for us?".

---

## 12. Changing things

| To change | Edit |
|---|---|
| Family, schedules, holidays, unplanned events | `model-training/scenario.json → members, calendar` |
| Appliance behaviour (power, meals, sessions, cycles) | `scenario.json → meals, appliances[].profile` |
| Tariff, PV costs, PV sizes | `scenario.json → tariff, solar` |
| Heat pump / house physics, comfort levels | `scenario.json → heating` |
| Flexible appliances and their windows | `scenario.json → appliances[].flexible.window` |
| Models tested, backtest weeks, under-prediction target | `scenario.json → model` |
| Assumptions text | `scenario.json → assumptions` (shown in the app) |
| New model | add a class in `model-training/models.py` + its name in `scenario.json → model.candidates` |
| New insight | `backend/src/domain/insights.ts` |
| New dashboard panel | `frontend/src/components/Features.tsx`, add it to a page in `Dashboard.tsx → pages` (menu entries: `PAGES`) |
| Colours | top of `frontend/src/styles.css` |

After changing `scenario.json`: `.venv/bin/python run_pipeline.py` (or the affected steps), then
`npm run export:sample` for the offline snapshot and `npm run build:standalone` for the one-file dashboard.

---

## 13. Troubleshooting

| Problem | Fix |
|---|---|
| `XGBoost Library (libxgboost.dylib) could not be loaded` (macOS) | handled automatically (the scripts restart with scikit-learn's OpenMP); or `brew install libomp` |
| `EADDRINUSE: 8787` / `5173` | another backend/frontend is running — stop it (`lsof -ti:8787 \| xargs kill`) |
| Dashboard shows old data | the backend re-reads files on change; hard-refresh the browser |
| Weather download fails | cached files in `data/` are used; run with `--offline` |
| Yellow banner "Forecast is from …" stays | the automatic refresh could not get today's weather (no internet) — it retries every 30 min; or run `run_pipeline.py` by hand and read the backend log (`[refresh]` lines) |
| "Weather forecast covers only … hours" | run `weather.py` (the forecast must start at the day after the history) |
| Assistant says "No ANTHROPIC_API_KEY" | expected without a key — offline answers; see section 2 |
| Types out of sync | `npm run typecheck` |
