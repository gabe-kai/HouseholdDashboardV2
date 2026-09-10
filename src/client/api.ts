import type {
  Grant,
  GrantPreset,
  MemberPublic,
  OccurrenceView,
  ObligationMeaning,
  StepStatus,
  SyncNotification,
} from "../shared/schemas";
import { newClientId } from "./id";

const CSRF_STORAGE_KEY = "hd_csrf_token";

function readStoredCsrf(): string {
  if (typeof sessionStorage === "undefined") return "";
  try {
    return sessionStorage.getItem(CSRF_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredCsrf(token: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (token) sessionStorage.setItem(CSRF_STORAGE_KEY, token);
    else sessionStorage.removeItem(CSRF_STORAGE_KEY);
  } catch {
    /* private mode / quota */
  }
}

/** Survives Vite HMR; empty until login/claim/session restore. */
let csrfToken = readStoredCsrf();

export type ApiError = Error & { code?: string; requestId?: string };

export type SessionInfo = {
  member: { id: string; displayName: string };
  grants: Grant[];
  csrfToken: string;
  householdTimezone: string;
  householdDate: string;
};

export type RoutineStep = {
  text: string;
  obligation: ObligationMeaning;
  position: number;
  logicalItemId: string;
};

export type Routine = {
  id: string;
  kind: "morning";
  revisions: Array<{
    id: string;
    effectiveDate: string;
    title: string;
    weekdays: number[];
    createdAt: string;
    steps: RoutineStep[];
    assigneeMemberIds: string[];
  }>;
};

export type PersonalAddition = {
  id: string;
  position: number;
  text: string;
  obligation: ObligationMeaning;
  anchorLogicalItemId: string | null;
  place: "before" | "after" | "end";
};

export type PersonalLayer = {
  id: string;
  membershipId: string;
  definitionId: string;
  effectiveDate: string;
  createdAt: string;
  additions: PersonalAddition[];
};

export type RoutinePreview = {
  householdDate: string;
  membershipId: string;
  definitionId: string;
  revisionId: string;
  personalRevisionId: string | null;
  title: string;
  weekdays: number[];
  steps: Array<{
    position: number;
    text: string;
    obligation: ObligationMeaning;
    source: "shared" | "personal";
    logicalItemId: string;
  }>;
};

export type Proposal = {
  id: string;
  householdId: string;
  membershipId: string;
  text: string;
  obligation: ObligationMeaning;
  anchorLogicalItemId: string | null;
  place: "before" | "after" | "end";
  status: "pending" | "approved" | "rejected";
  proposedAt: string;
  decidedAt: string | null;
  deciderMembershipId: string | null;
  personalRevisionId: string | null;
};

export type PersonalTask = {
  id: string;
  householdId: string;
  ownerMembershipId: string;
  title: string;
  visibility: "private" | "household";
  status: "open" | "completed";
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type AdditionInput = {
  id?: string;
  text: string;
  obligation: ObligationMeaning;
  anchorLogicalItemId?: string | null;
  place: "before" | "after" | "end";
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
    throw error;
  }
  return data;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  mutationDelayMs?: number,
  retried = false,
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (mutating) headers.set("x-csrf-token", csrfToken);
  if (mutationDelayMs && mutationDelayMs > 0) {
    headers.set("x-mutation-delay-ms", String(mutationDelayMs));
  }
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  if (mutating && !retried && res.status === 403) {
    let code: string | undefined;
    try {
      code = ((await res.clone().json()) as { code?: string }).code;
    } catch {
      code = undefined;
    }
    if (code === "CSRF") {
      const refreshed = await fetchSession();
      if (refreshed) {
        return request<T>(path, init, mutationDelayMs, true);
      }
    }
  }
  return parseJson<T>(res);
}

export function rememberCsrfToken(token: string): void {
  csrfToken = token;
  writeStoredCsrf(token);
}

function retainSessionToken(session: SessionInfo): SessionInfo {
  rememberCsrfToken(session.csrfToken);
  return session;
}

export async function fetchMeta() {
  return request<{ evaluationMode: boolean; banner: string; profile: string }>(
    "/api/v1/meta",
  );
}

export async function login(loginName: string, passphrase: string) {
  return retainSessionToken(
    await request<SessionInfo>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ loginName, passphrase }),
    }),
  );
}

export async function claim(body: {
  token: string;
  loginName: string;
  passphrase: string;
  displayName: string;
}) {
  const { token, ...account } = body;
  return retainSessionToken(
    await request<SessionInfo>("/api/v1/auth/claim", {
      method: "POST",
      body: JSON.stringify({ ...account, claimToken: token }),
    }),
  );
}

export async function logout(): Promise<void> {
  try {
    await request<{ ok: true }>("/api/v1/auth/logout", { method: "POST" });
  } finally {
    rememberCsrfToken("");
  }
}

export async function fetchSession(): Promise<SessionInfo | null> {
  const res = await fetch("/api/v1/auth/session", { credentials: "include" });
  if (res.status === 401) {
    rememberCsrfToken("");
    return null;
  }
  return retainSessionToken(await parseJson<SessionInfo>(res));
}

export async function issueEnrollmentClaim(body: {
  membershipId?: string;
  displayName?: string;
  preset: GrantPreset;
}) {
  return request<{
    claim: { token: string; expiresAt: string; membershipId: string };
  }>("/api/v1/enrollment/claims", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchMemberships() {
  return request<{ memberships: MemberPublic[] }>("/api/v1/memberships");
}

export async function fetchRoutine() {
  return request<{ routine: Routine | null }>("/api/v1/routines");
}

export async function createRoutine(body: {
  title: string;
  assigneeMemberIds: string[];
  weekdays: number[];
  steps: Array<{
    text: string;
    obligation: ObligationMeaning;
    logicalItemId?: string;
  }>;
}) {
  return request<{ routine: Routine }>("/api/v1/routines", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function createRevision(
  definitionId: string,
  body: {
    title: string;
    assigneeMemberIds: string[];
    weekdays: number[];
    steps: Array<{
      text: string;
      obligation: ObligationMeaning;
      logicalItemId?: string;
    }>;
    effectiveDate?: string;
  },
) {
  return request<{ routine: Routine }>(
    `/api/v1/routines/${encodeURIComponent(definitionId)}/revisions`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function fetchToday(date?: string) {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return request<{
    householdDate: string;
    householdTimezone: string;
    occurrences: OccurrenceView[];
  }>(`/api/v1/today${query}`);
}

export async function fetchHistory(date: string) {
  return request<{ householdDate: string; occurrences: OccurrenceView[] }>(
    `/api/v1/history?date=${encodeURIComponent(date)}`,
  );
}

export async function setStepStatus(
  occurrenceId: string,
  stepId: string,
  body: { mutationId: string; status: StepStatus; performedAt: string },
  options?: { delayMs?: number },
) {
  return request<{ occurrence: OccurrenceView; report: unknown }>(
    `/api/v1/occurrences/${encodeURIComponent(occurrenceId)}/steps/${encodeURIComponent(stepId)}/status`,
    { method: "POST", body: JSON.stringify(body) },
    options?.delayMs,
  );
}

export async function savePersonalLayer(additions: AdditionInput[]) {
  return request<{ layer: PersonalLayer }>("/api/v1/personal-layer", {
    method: "PUT",
    body: JSON.stringify({ additions }),
  });
}

export async function fetchPreview(membershipId?: string, date?: string) {
  const params = new URLSearchParams();
  if (membershipId) params.set("membershipId", membershipId);
  if (date) params.set("date", date);
  const query = params.size ? `?${params.toString()}` : "";
  return request<{ preview: RoutinePreview }>(
    `/api/v1/personal-layer/preview${query}`,
  );
}

export async function createProposal(body: Omit<AdditionInput, "id">) {
  return request<{ proposal: Proposal }>("/api/v1/proposals", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchProposals() {
  return request<{ proposals: Proposal[] }>("/api/v1/proposals");
}

export async function decideProposal(
  proposalId: string,
  decision: "approved" | "rejected",
) {
  return request<{ proposal: Proposal }>(
    `/api/v1/proposals/${encodeURIComponent(proposalId)}/decide`,
    { method: "POST", body: JSON.stringify({ decision }) },
  );
}

export async function createPersonalTask(
  title: string,
  visibility: "private" | "household",
) {
  return request<{ task: PersonalTask }>("/api/v1/personal-tasks", {
    method: "POST",
    body: JSON.stringify({ title, visibility }),
  });
}

export async function fetchPersonalTasks() {
  return request<{ tasks: PersonalTask[] }>("/api/v1/personal-tasks");
}

export async function setPersonalTaskStatus(
  taskId: string,
  status: "open" | "completed",
) {
  return request<{ task: PersonalTask }>(
    `/api/v1/personal-tasks/${encodeURIComponent(taskId)}/status`,
    {
      method: "POST",
      body: JSON.stringify({ mutationId: newClientId(), status }),
    },
  );
}

export function connectSync(
  onMessage: (notification: SyncNotification) => void,
  onStatus?: (status: "connected" | "reconnecting") => void,
): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRetry = () => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    onStatus?.("reconnecting");
    clearRetry();
    const delay = Math.min(1_000 * 2 ** attempt, 15_000);
    attempt += 1;
    retryTimer = setTimeout(open, delay);
  };

  const open = () => {
    if (stopped) return;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const next = new WebSocket(`${protocol}://${location.host}/api/v1/sync`);
    socket = next;
    next.onopen = () => {
      attempt = 0;
      onStatus?.("connected");
    };
    next.onmessage = (event) => {
      try {
        onMessage(JSON.parse(String(event.data)) as SyncNotification);
      } catch {
        // Invalid notifications are ignored; authoritative reads remain the source of truth.
      }
    };
    next.onerror = () => {
      try {
        next.close();
      } catch {
        // Ignore close failures; onclose schedules reconnect.
      }
    };
    next.onclose = () => {
      if (socket === next) socket = null;
      if (!stopped) scheduleReconnect();
    };
  };

  open();

  const testApi = {
    closeForTest: () => {
      socket?.close();
    },
  };
  (window as unknown as { __hdSync?: typeof testApi }).__hdSync = testApi;

  return () => {
    stopped = true;
    clearRetry();
    const exposed = window as unknown as { __hdSync?: typeof testApi };
    if (exposed.__hdSync === testApi) delete exposed.__hdSync;
    socket?.close();
  };
}
