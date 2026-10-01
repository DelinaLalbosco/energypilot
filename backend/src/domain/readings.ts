import { APPLIANCE_IDS, type ApplianceId, type MeterReading } from "../../../shared/types";
import { loadReadings, loadScenario, num, saveReadings, type Row } from "../providers/energyData";

/*
 * Smart-meter input. Accepts hourly readings as JSON or CSV, normalises the
 * timestamp to the hour ("YYYY-MM-DD HH:00:00", same format as the energy CSVs)
 * and upserts them into data/live_readings.csv.
 *
 * JSON:  [{ "timestamp": "2025-12-31T18:00", "total_kwh": 5.4, "heating_kwh": 2.9 }, ...]
 *        or { "readings": [...] }   (totalKwh / kwh are accepted for total_kwh)
 * CSV:   timestamp,total_kwh[,heating_kwh,...]
 */

/** CSV columns: timestamp, total and every appliance from scenario.json. */
const header = () => {
  loadScenario();
  return ["timestamp", "total_kwh", ...APPLIANCE_IDS];
};
const MAX_KWH_PER_HOUR = 50;

export class ReadingError extends Error {}

function normaliseTimestamp(raw: unknown): string {
  const m = String(raw ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2})/);
  if (!m) throw new ReadingError(`Invalid timestamp "${raw}" — use YYYY-MM-DD HH:MM`);
  return `${m[1]} ${m[2]}:00:00`;
}

function kwhValue(raw: unknown, field: string): number {
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0 || v > MAX_KWH_PER_HOUR) {
    throw new ReadingError(`Invalid ${field} "${raw}" — expected kWh between 0 and ${MAX_KWH_PER_HOUR}`);
  }
  return v;
}

function toRow(item: Record<string, unknown>): Row {
  const total = item.total_kwh ?? item.totalKwh ?? item.kwh;
  if (total === undefined) throw new ReadingError("Each reading needs total_kwh");
  const row: Row = {
    timestamp: normaliseTimestamp(item.timestamp),
    total_kwh: String(kwhValue(total, "total_kwh")),
  };
  const appliances = (item.appliances ?? {}) as Record<string, unknown>;
  for (const id of APPLIANCE_IDS) {
    const v = item[id] ?? appliances[id];
    if (v !== undefined && v !== "") row[id] = String(kwhValue(v, id));
  }
  return row;
}

function parseBody(body: string, contentType: string): Row[] {
  const text = body.trim();
  if (!text) throw new ReadingError("Empty request body");

  if (contentType.includes("json") || text.startsWith("[") || text.startsWith("{")) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ReadingError("Body is not valid JSON");
    }
    const list = Array.isArray(data) ? data : (data as { readings?: unknown }).readings ?? [data];
    if (!Array.isArray(list)) throw new ReadingError("Expected an array of readings");
    return list.map((item) => toRow(item as Record<string, unknown>));
  }

  const [headerLine, ...lines] = text.split(/\r?\n/).filter((l) => l.trim());
  const header = headerLine.split(",").map((h) => h.trim());
  if (!header.includes("timestamp")) throw new ReadingError("CSV needs a 'timestamp' column");
  return lines.map((line) => {
    const cells = line.split(",");
    return toRow(Object.fromEntries(header.map((h, i) => [h, cells[i]?.trim()])));
  });
}

/** Adds or replaces readings (by hour). Returns how many were stored and the new total. */
export function addReadings(body: string, contentType: string) {
  loadScenario();
  const incoming = parseBody(body, contentType);
  const byHour = new Map(loadReadings().map((r) => [r.timestamp, r]));
  for (const r of incoming) byHour.set(r.timestamp, r);
  const rows = [...byHour.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  saveReadings(header(), rows);
  return { stored: incoming.length, total: rows.length };
}

export function clearReadings() {
  saveReadings(header(), []);
}

export function listReadings(): MeterReading[] {
  loadScenario();
  return loadReadings().map((r) => {
    const appliances: Partial<Record<ApplianceId, number>> = {};
    for (const id of APPLIANCE_IDS) if (r[id] !== undefined && r[id] !== "") appliances[id] = num(r, id);
    return { timestamp: r.timestamp, totalKwh: num(r, "total_kwh"), appliances };
  });
}
