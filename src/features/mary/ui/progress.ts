import { WAITLIST_FIELDS, type Collected, type WaitlistField } from "@/lib/mary.functions";

import { FIELD_LABELS } from "../conversation/text";

export type PillState = "saved" | "next" | "open";

export type Pill = {
  field: WaitlistField;
  state: PillState;
  /** What the pill shows: the value once saved (operations stays a label), the label until then. */
  text: string;
  /** What a screen reader hears in addition: the state, in words. */
  hint: string;
};

/** Phone is optional per the playbook: the pill says so until it is filled. */
function labelFor(field: WaitlistField): string {
  return field === "phone" ? "Phone (optional)" : (FIELD_LABELS[field] ?? field);
}

export function progressOf(collected: Collected): {
  pills: Pill[];
  saved: number;
  total: number;
  next: WaitlistField | undefined;
} {
  const next = WAITLIST_FIELDS.find((field) => !collected[field]);
  const pills = WAITLIST_FIELDS.map((field): Pill => {
    const value = collected[field];
    if (value) {
      return {
        field,
        state: "saved",
        text: field === "operations" ? (FIELD_LABELS[field] ?? field) : value,
        hint: `${FIELD_LABELS[field]} saved`,
      };
    }
    return {
      field,
      state: field === next ? "next" : "open",
      text: labelFor(field),
      hint: field === next ? "up next" : "still to come",
    };
  });
  return {
    pills,
    saved: pills.filter((pill) => pill.state === "saved").length,
    total: WAITLIST_FIELDS.length,
    next,
  };
}
