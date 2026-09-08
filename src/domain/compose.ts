import type { ObligationMeaning } from "../shared/schemas.js";

export type SharedComposeItem = {
  logicalItemId: string;
  text: string;
  obligation: ObligationMeaning;
};

export type PersonalComposeAddition = {
  id: string;
  text: string;
  obligation: ObligationMeaning;
  anchorLogicalItemId: string | null;
  place: "before" | "after" | "end";
};

export type ComposedItem = {
  logicalItemId: string;
  text: string;
  obligation: ObligationMeaning;
  source: "shared" | "personal";
  personalAdditionId?: string;
};

/**
 * Deterministic composition: inherited shared items plus personal additions
 * anchored relative to stable shared/personal IDs. Missing anchors fall back
 * to the end of inherited content in stable personal order.
 */
export function composeMorningRoutine(
  shared: SharedComposeItem[],
  personal: PersonalComposeAddition[],
): ComposedItem[] {
  const result: ComposedItem[] = shared.map((s) => ({
    logicalItemId: s.logicalItemId,
    text: s.text,
    obligation: s.obligation,
    source: "shared" as const,
  }));

  for (const addition of personal) {
    const item: ComposedItem = {
      logicalItemId: addition.id,
      text: addition.text,
      obligation: addition.obligation,
      source: "personal",
      personalAdditionId: addition.id,
    };

    if (!addition.anchorLogicalItemId || addition.place === "end") {
      // End of inherited content: after last shared item, before later personal-end items accumulate in order.
      const lastSharedIdx = findLastIndex(result, (r) => r.source === "shared");
      result.splice(lastSharedIdx + 1, 0, item);
      continue;
    }

    const anchorIdx = result.findIndex((r) => r.logicalItemId === addition.anchorLogicalItemId);
    if (anchorIdx < 0) {
      const lastSharedIdx = findLastIndex(result, (r) => r.source === "shared");
      result.splice(lastSharedIdx + 1, 0, item);
      continue;
    }

    if (addition.place === "before") {
      result.splice(anchorIdx, 0, item);
    } else {
      result.splice(anchorIdx + 1, 0, item);
    }
  }

  return result;
}

function findLastIndex<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}
