/**
 * Display-principal HTTP/WS helpers (P0-007C-2).
 * Never stores household payloads in localStorage.
 */
import type { HouseholdOverview } from "../domain/household-overview";
import type { StepProgressCounts, WorkState } from "../domain/progress";

export type ApiError = Error & {
  code?: string;
  requestId?: string;
  status?: number;
};

export type DisplaySessionInfo = {
  displayId: string;
  label: string;
  householdId: string;
  timezone: string;
  householdDate: string;
  serverTime: string;
  absoluteExpiresAt: string;
  lastSeenAt: string;
  activityGeneration: number;
};

export type DisplayPersonSummary = {
  membershipId: string;
  displayName: string;
  sortOrder: number;
  status: "pending" | "active";
  recurringState: WorkState | "No assigned work today";
  progress: StepProgressCounts | null;
  progressLabel: string | null;
  unfinished: Array<{
    occurrenceId: string;
    title: string;
    kind: "routine" | "responsibility";
  }>;
};

export type DisplayDashboard = {
  householdDate: string;
  timezone: string;
  serverTime: string;
  activityGeneration: number;
  byPerson: DisplayPersonSummary[];
  byWork: HouseholdOverview;
};

export type DisplayPersonDetail = {
  membershipId: string;
  displayName: string;
  sortOrder: number;
  status: "pending" | "active";
  recurringWork: Array<{
    occurrenceId: string;
    definitionId: string;
    title: string;
    kind: "routine" | "responsibility";
    daypart: string;
    completed: boolean;
    state: WorkState;
    progress: StepProgressCounts;
    progressLabel: string;
  }>;
  householdVisibleTasks: Array<{
    id: string;
    title: string;
    status: "open" | "completed";
    ownerMembershipId: string;
  }>;
};

export type DisplayOccurrenceDetail = {
  id: string;
  definitionId: string;
  title: string;
  kind: "routine" | "responsibility";
  daypart: string;
  householdDate: string;
  accountableMemberId: string | null;
  accountableMemberName: string;
  completed: boolean;
  state: WorkState;
  progress: StepProgressCounts;
  progressLabel: string;
  steps: Array<{
    id: string;
    text: string;
    status: string;
    obligation: string;
    position: number;
    source?: string;
  }>;
};

export type DisplayInvalidateMessage = {
  type: "display_invalidate";
  householdId: string;
  reason: "work" | "people" | "reset" | "schedule" | "tasks" | "access_lost";
  at: string;
};

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & {
    code?: string;
    message?: string;
    requestId?: string;
  };
  if (!res.ok) {
    const error = new Error(data.message ?? res.statusText) as ApiError;
    error.code = data.code;
    error.requestId = data.requestId;
    error.status = res.status;
    throw error;
  }
  return data;
}

async function displayRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  return parseJson<T>(res);
}

/** Group a 16-char Base32 code as XXXX-XXXX-XXXX-XXXX for display/copy. */
export function formatDisplayCodeGrouped(code: string): string {
  const normalized = code.replace(/[\s\-_]+/g, "").toUpperCase();
  const parts: string[] = [];
  for (let i = 0; i < normalized.length; i += 4) {
    parts.push(normalized.slice(i, i + 4));
  }
  return parts.join("-");
}

export async function fetchDisplaySession(): Promise<DisplaySessionInfo | null> {
  try {
    const data = await displayRequest<{ session: DisplaySessionInfo }>(
      "/api/v1/display/session",
    );
    return data.session;
  } catch (error) {
    const apiError = error as ApiError;
    if (apiError.status === 401 || apiError.code === "UNAUTHORIZED") return null;
    throw error;
  }
}

export async function claimDisplay(code: string): Promise<{
  displayId: string;
  label: string;
  householdId: string;
  timezone: string;
  absoluteExpiresAt: string;
}> {
  return displayRequest("/api/v1/display/claim", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function fetchDisplayDashboard(): Promise<DisplayDashboard> {
  const data = await displayRequest<{ dashboard: DisplayDashboard }>(
    "/api/v1/display/dashboard",
  );
  return data.dashboard;
}

export async function fetchDisplayPerson(
  membershipId: string,
): Promise<DisplayPersonDetail> {
  const data = await displayRequest<{ person: DisplayPersonDetail }>(
    `/api/v1/display/people/${encodeURIComponent(membershipId)}`,
  );
  return data.person;
}

export async function fetchDisplayOccurrence(
  occurrenceId: string,
): Promise<DisplayOccurrenceDetail> {
  const data = await displayRequest<{ occurrence: DisplayOccurrenceDetail }>(
    `/api/v1/display/occurrences/${encodeURIComponent(occurrenceId)}`,
  );
  return data.occurrence;
}

export function connectDisplaySync(
  onMessage: (msg: DisplayInvalidateMessage) => void,
  onStatus?: (status: "connected" | "disconnected" | "reconnecting") => void,
): () => void {
  let socket: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRetry = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    onStatus?.("reconnecting");
    clearRetry();
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 4));
    attempt += 1;
    retryTimer = setTimeout(open, delay);
  };

  const open = () => {
    if (stopped) return;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const next = new WebSocket(`${protocol}://${location.host}/api/v1/display/sync`);
    socket = next;
    next.onopen = () => {
      attempt = 0;
      onStatus?.("connected");
    };
    next.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as DisplayInvalidateMessage;
        if (parsed.type === "display_invalidate") onMessage(parsed);
      } catch {
        /* ignore malformed */
      }
    };
    next.onerror = () => {
      try {
        next.close();
      } catch {
        /* ignore */
      }
    };
    next.onclose = () => {
      if (socket === next) socket = null;
      onStatus?.("disconnected");
      if (!stopped) scheduleReconnect();
    };
  };

  open();

  return () => {
    stopped = true;
    clearRetry();
    socket?.close();
  };
}
