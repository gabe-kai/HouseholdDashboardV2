/**
 * Selected-display preview types, viewport helpers, and isolated-frame messaging.
 * Never carries CSRF, session IDs, or intendedStructure.
 */
import type {
  DisplayDashboard,
  DisplayOccurrenceDetail,
  DisplayPersonDetail,
} from "./display-api";
import type { DisplayDetailState, DisplayOrganization } from "./display-presentation";

export const PREVIEW_FRAME_PATH = "/preview-frame.html";
export const PREVIEW_POLL_MS = 30_000;
export const PREVIEW_STALE_MAX_MS = 60_000;

export const DEFAULT_PREVIEW_VIEWPORT = {
  width: 3840,
  height: 2160,
  provenance: "assumed" as const,
};

export const PREVIEW_VIEWPORT_PRESETS = {
  uhd: { width: 3840, height: 2160, label: "3840 × 2160" },
  fhd: { width: 1920, height: 1080, label: "1920 × 1080" },
} as const;

export type PreviewViewport = {
  width: number;
  height: number;
  provenance: "assumed" | "chosen";
};

export type DisplayPreviewEnvelope = {
  displayId: string;
  label: string;
  householdDate: string;
  timezone: string;
  serverTime: string;
  activityGeneration: number;
  installationEpoch: number;
};

export type PreviewDashboardPayload = DisplayPreviewEnvelope & {
  dashboard: DisplayDashboard;
};

export type PreviewPersonPayload = DisplayPreviewEnvelope & {
  person: DisplayPersonDetail;
};

export type PreviewOccurrencePayload = DisplayPreviewEnvelope & {
  occurrence: DisplayOccurrenceDetail;
};

export type PreviewFrameState = {
  type: "hd-preview-state";
  dashboard: DisplayDashboard | null;
  person: DisplayPersonDetail | null;
  occurrence: DisplayOccurrenceDetail | null;
  organization: DisplayOrganization;
  detail: DisplayDetailState | null;
  loading: boolean;
  stale: boolean;
  detailUnavailable: boolean;
};

export type PreviewFrameNav =
  | { type: "hd-preview-ready" }
  | { type: "hd-preview-org"; organization: DisplayOrganization }
  | { type: "hd-preview-open-person"; membershipId: string; originKey: string }
  | { type: "hd-preview-open-occurrence"; occurrenceId: string; originKey: string }
  | { type: "hd-preview-open-routine"; aggregateKey: string; originKey: string }
  | {
      type: "hd-preview-open-routine-person";
      aggregateKey: string;
      occurrenceId: string;
      originKey: string;
    }
  | { type: "hd-preview-back" }
  | { type: "hd-preview-back-routine"; aggregateKey: string; originKey: string };

export function stripPreviewCommandMetadata<T extends object>(value: T): T {
  if (!value || typeof value !== "object") return value;
  const clone = { ...value } as T & { intendedStructure?: unknown };
  delete clone.intendedStructure;
  if ("steps" in clone && Array.isArray(clone.steps)) {
    clone.steps = clone.steps.map((step: Record<string, unknown>) => {
      const next = { ...step };
      delete next.logicalItemId;
      return next;
    }) as typeof clone.steps;
  }
  return clone;
}

export function parsePreviewViewport(search: string): PreviewViewport {
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const preset = query.get("preset");
  if (preset === "fhd") {
    return { ...PREVIEW_VIEWPORT_PRESETS.fhd, provenance: "chosen" };
  }
  if (preset === "uhd") {
    return { ...PREVIEW_VIEWPORT_PRESETS.uhd, provenance: "chosen" };
  }
  const width = Number(query.get("w"));
  const height = Number(query.get("h"));
  if (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= 320 &&
    width <= 7680 &&
    height >= 240 &&
    height <= 4320
  ) {
    return { width, height, provenance: "chosen" };
  }
  return { ...DEFAULT_PREVIEW_VIEWPORT };
}

export function previewViewportSearch(viewport: PreviewViewport): string {
  if (
    viewport.provenance === "assumed" &&
    viewport.width === DEFAULT_PREVIEW_VIEWPORT.width &&
    viewport.height === DEFAULT_PREVIEW_VIEWPORT.height
  ) {
    return "";
  }
  if (
    viewport.width === PREVIEW_VIEWPORT_PRESETS.fhd.width &&
    viewport.height === PREVIEW_VIEWPORT_PRESETS.fhd.height
  ) {
    return "?preset=fhd";
  }
  if (
    viewport.width === PREVIEW_VIEWPORT_PRESETS.uhd.width &&
    viewport.height === PREVIEW_VIEWPORT_PRESETS.uhd.height &&
    viewport.provenance === "chosen"
  ) {
    return "?preset=uhd";
  }
  return `?w=${viewport.width}&h=${viewport.height}`;
}

export function fitScale(
  targetWidth: number,
  targetHeight: number,
  availableWidth: number,
  availableHeight: number,
): number {
  if (targetWidth <= 0 || targetHeight <= 0) return 1;
  return Math.min(availableWidth / targetWidth, availableHeight / targetHeight, 1);
}

export function isPreviewFrameState(value: unknown): value is PreviewFrameState {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { type?: string }).type === "hd-preview-state",
  );
}

export function isPreviewFrameNav(value: unknown): value is PreviewFrameNav {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: string }).type;
  return (
    type === "hd-preview-ready" ||
    type === "hd-preview-org" ||
    type === "hd-preview-open-person" ||
    type === "hd-preview-open-occurrence" ||
    type === "hd-preview-open-routine" ||
    type === "hd-preview-open-routine-person" ||
    type === "hd-preview-back" ||
    type === "hd-preview-back-routine"
  );
}
