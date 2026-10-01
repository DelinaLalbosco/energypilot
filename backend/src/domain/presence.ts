import { SCENARIO, type Presence } from "../../../shared/types";
import { num, type Row } from "../providers/energyData";

/*
 * Who is at home: the forecast rows carry <member>_home per hour from the planned
 * family calendar (model-training/household.py): 0 away, 1 at home awake, 2 at home asleep.
 */

/** Presence per member from the forecast row (<member>_home: 0 away, 1 awake, 2 asleep). */
export function presenceOf(r: Row): Presence {
  return Object.fromEntries(SCENARIO.members.map((m) => [m.id, Math.round(num(r, `${m.id}_home`)) as 0 | 1 | 2]));
}

const names = (ids: string[]) => {
  const n = ids.map((id) => SCENARIO.members.find((m) => m.id === id)?.name ?? id);
  return n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
};

/** Who arrives, leaves, wakes up or goes to sleep between two hours. */
export function presenceChange(prev: Presence, cur: Presence): string {
  const ids = SCENARIO.members.map((m) => m.id);
  const parts: string[] = [];
  const arrive = ids.filter((id) => prev[id] === 0 && cur[id] > 0);
  const leave = ids.filter((id) => prev[id] > 0 && cur[id] === 0);
  const wake = ids.filter((id) => prev[id] === 2 && cur[id] === 1);
  const sleep = ids.filter((id) => prev[id] === 1 && cur[id] === 2);
  if (arrive.length) parts.push(`${names(arrive)} ${arrive.length > 1 ? "come" : "comes"} home`);
  if (leave.length) parts.push(`${names(leave)} ${leave.length > 1 ? "leave" : "leaves"}`);
  if (wake.length) parts.push(`${names(wake)} ${wake.length > 1 ? "wake" : "wakes"} up`);
  if (sleep.length) parts.push(`${names(sleep)} ${sleep.length > 1 ? "go" : "goes"} to bed`);
  return parts.join(", ");
}
