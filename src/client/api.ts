import type {
  MemberPublic,
  OccurrenceView,
  ObligationMeaning,
  StepStatus,
  SyncNotification,
} from "../shared/schemas";

export type SessionInfo = {
  member: MemberPublic;
  householdTimezone: string;
  evaluationMode: boolean;
  householdDate?: string;
};

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { code?: string; message?: string };
  if (!res.ok) {
    const err = new Error(data.message ?? res.statusText);
    (err as Error & { code?: string }).code = data.code;
    throw err;
  }
  return data;
}

export async function fetchMeta() {
  const res = await fetch("/api/v1/meta");
  return parseJson<{ evaluationMode: boolean; banner: string; allowLan: boolean }>(res);
}

export async function fetchMembers() {
  const res = await fetch("/api/v1/members");
  return parseJson<{ members: MemberPublic[] }>(res);
}

export async function createSession(memberId: string) {
  const res = await fetch("/api/v1/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberId }),
  });
  return parseJson<SessionInfo>(res);
}

export async function fetchSession() {
  const res = await fetch("/api/v1/session");
  if (res.status === 401) return null;
  return parseJson<SessionInfo>(res);
}

export async function clearSession() {
  await fetch("/api/v1/session", { method: "DELETE" });
}

export async function fetchToday(date?: string) {
  const q = date ? `?date=${encodeURIComponent(date)}` : "";
  const res = await fetch(`/api/v1/today${q}`);
  return parseJson<{
    householdDate: string;
    householdTimezone: string;
    occurrences: OccurrenceView[];
  }>(res);
}

export async function fetchHistory(date: string) {
  const res = await fetch(`/api/v1/history?date=${encodeURIComponent(date)}`);
  return parseJson<{ householdDate: string; occurrences: OccurrenceView[] }>(res);
}

export async function fetchRoutine() {
  const res = await fetch("/api/v1/routines");
  return parseJson<{
    routine: null | {
      id: string;
      kind: string;
      revisions: Array<{
        id: string;
        effectiveDate: string;
        title: string;
        weekdays: number[];
        steps: Array<{ text: string; obligation: ObligationMeaning; position: number }>;
        assigneeMemberIds: string[];
      }>;
    };
  }>(res);
}

export async function createRoutine(body: {
  title: string;
  assigneeMemberIds: string[];
  weekdays: number[];
  steps: Array<{ text: string; obligation: ObligationMeaning }>;
}) {
  const res = await fetch("/api/v1/routines", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson<{ routine: unknown }>(res);
}

export async function createRevision(
  definitionId: string,
  body: {
    title: string;
    assigneeMemberIds: string[];
    weekdays: number[];
    steps: Array<{ text: string; obligation: ObligationMeaning }>;
    effectiveDate?: string;
  },
) {
  const res = await fetch(`/api/v1/routines/${definitionId}/revisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson<{ routine: unknown }>(res);
}

export async function setStepStatus(
  occurrenceId: string,
  stepId: string,
  body: { mutationId: string; status: StepStatus; performedAt: string },
  options?: { delayMs?: number },
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options?.delayMs) {
    headers["x-mutation-delay-ms"] = String(options.delayMs);
  }
  const res = await fetch(`/api/v1/occurrences/${occurrenceId}/steps/${stepId}/status`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return parseJson<{ occurrence: OccurrenceView; report: unknown }>(res);
}

export function connectSync(onMessage: (n: SyncNotification) => void): () => void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/v1/sync`);
  ws.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(String(ev.data)) as SyncNotification);
    } catch {
      /* ignore */
    }
  };
  return () => ws.close();
}
