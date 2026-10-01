/** Picture (emoji) for an appliance or a room, chosen from its name so it works for any scenario. */

const APPLIANCE_PICTURES: [RegExp, string][] = [
  [/dish/i, "🍽️"],
  [/wash/i, "🧺"],
  [/heat/i, "🔥"],
  [/fridge|refrigerator|freez/i, "🧊"],
  [/kettle/i, "🫖"],
  [/coffee/i, "☕"],
  [/oven/i, "🥘"],
  [/hob|cook|stove/i, "🍳"],
  [/tv|television/i, "📺"],
  [/gam|console/i, "🎮"],
  [/desktop|computer|pc/i, "🖥️"],
  [/laptop/i, "💻"],
  [/router|wi-?fi/i, "📶"],
  [/light/i, "💡"],
  [/charg/i, "🔋"],
  [/standby/i, "🔌"],
];

const ROOM_PICTURES: [RegExp, string][] = [
  [/kitchen/i, "🍳"],
  [/living/i, "🛋️"],
  [/kid|child/i, "🎮"],
  [/office|bed/i, "💼"],
  [/utility|heat/i, "🔧"],
];

const pick = (list: [RegExp, string][], name: string) => list.find(([re]) => re.test(name))?.[1] ?? "⚡";

export const appliancePicture = (name: string) => pick(APPLIANCE_PICTURES, name);
export const roomPicture = (label: string) => pick(ROOM_PICTURES, label);
