/**
 * Path-based History API destinations for P0-006A/C/007A (D-027, D-033, D-037).
 *
 * Required addressable views:
 *   / or /today                         → Today
 *   /plan                               → Plan list (routines + responsibilities)
 *   /plan/routines/:definitionId        → routine detail (active or ended)
 *   /plan/responsibilities/:definitionId → responsibility detail (active or ended)
 *   /household                          → Household menu
 *   /household/people                   → People & Groups overview
 *   /household/people/:membershipId     → person detail
 *   /household/groups/:groupId          → group detail
 *   /household/school-calendar          → school calendar
 *   /household/history                  → History summary (?date/from/to/person/routine/status/kind)
 *   /household/history/:occurrenceId    → History occurrence detail (filters preserved in search)
 *   /household/settings                 → Data & testing
 *   /household/displays                 → Household displays (manage grant)
 *
 * Edit/create/picker/ended-list and other secondary surfaces stay in-app local
 * state under their parent URL unless noted. Browser Back follows history;
 * in-app Back follows logical parent.
 */

import type { WorkKind } from "../shared/schemas";

export type HistoryFilters = {
  date?: string;
  from?: string;
  to?: string;
  personId?: string;
  routineId?: string;
  status?: "complete" | "incomplete";
  /** Work kind filter; retains saved routine filters when set. */
  kind?: WorkKind;
};

export type AppLocation =
  | { name: "today" }
  | { name: "plan" }
  | { name: "plan-routine"; definitionId: string }
  | { name: "plan-responsibility"; definitionId: string }
  | { name: "household" }
  | { name: "household-people" }
  | { name: "household-person"; membershipId: string }
  | { name: "household-group"; groupId: string }
  | { name: "household-school-calendar" }
  | { name: "household-history"; filters?: HistoryFilters }
  | {
      name: "household-history-occurrence";
      occurrenceId: string;
      filters?: HistoryFilters;
    }
  | { name: "household-settings" }
  | { name: "household-displays" }
  | { name: "unavailable"; attemptedPath: string };

const INTENDED_PATH_KEY = "hd_intended_path";

export function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function historySearch(filters?: HistoryFilters): string {
  if (!filters) return "";
  const query = new URLSearchParams();
  if (filters.date) query.set("date", filters.date);
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  if (filters.personId) query.set("person", filters.personId);
  if (filters.routineId) query.set("routine", filters.routineId);
  if (filters.status) query.set("status", filters.status);
  if (filters.kind) query.set("kind", filters.kind);
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export function parseHistoryFilters(search: string): HistoryFilters | undefined {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return undefined;
  const query = new URLSearchParams(raw);
  const filters: HistoryFilters = {};
  const date = query.get("date") ?? undefined;
  const from = query.get("from") ?? undefined;
  const to = query.get("to") ?? undefined;
  const personId = query.get("person") ?? query.get("personId") ?? undefined;
  const routineId = query.get("routine") ?? query.get("routineId") ?? undefined;
  const statusRaw = query.get("status");
  const kindRaw = query.get("kind") ?? query.get("workKind");
  if (date) filters.date = date;
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (personId) filters.personId = personId;
  if (routineId) filters.routineId = routineId;
  if (statusRaw === "complete" || statusRaw === "incomplete") {
    filters.status = statusRaw;
  }
  if (kindRaw === "routine" || kindRaw === "responsibility") {
    filters.kind = kindRaw;
  }
  return Object.keys(filters).length > 0 ? filters : undefined;
}

export function parsePath(pathname: string, search = ""): AppLocation {
  const path = normalizePathname(pathname);
  if (path === "/" || path === "/today") return { name: "today" };
  if (path === "/plan") return { name: "plan" };

  const routineMatch = /^\/plan\/routines\/([^/]+)$/.exec(path);
  if (routineMatch?.[1]) {
    return { name: "plan-routine", definitionId: decodeURIComponent(routineMatch[1]) };
  }

  const responsibilityMatch = /^\/plan\/responsibilities\/([^/]+)$/.exec(path);
  if (responsibilityMatch?.[1]) {
    return {
      name: "plan-responsibility",
      definitionId: decodeURIComponent(responsibilityMatch[1]),
    };
  }

  if (path === "/household") return { name: "household" };
  if (path === "/household/people") return { name: "household-people" };

  const personMatch = /^\/household\/people\/([^/]+)$/.exec(path);
  if (personMatch?.[1]) {
    return { name: "household-person", membershipId: decodeURIComponent(personMatch[1]) };
  }

  const groupMatch = /^\/household\/groups\/([^/]+)$/.exec(path);
  if (groupMatch?.[1]) {
    return { name: "household-group", groupId: decodeURIComponent(groupMatch[1]) };
  }

  if (path === "/household/school-calendar") {
    return { name: "household-school-calendar" };
  }

  if (path === "/household/settings") {
    return { name: "household-settings" };
  }

  if (path === "/household/displays") {
    return { name: "household-displays" };
  }

  if (path === "/household/history") {
    return { name: "household-history", filters: parseHistoryFilters(search) };
  }

  const historyDetailMatch = /^\/household\/history\/([^/]+)$/.exec(path);
  if (historyDetailMatch?.[1]) {
    return {
      name: "household-history-occurrence",
      occurrenceId: decodeURIComponent(historyDetailMatch[1]),
      filters: parseHistoryFilters(search),
    };
  }

  return { name: "unavailable", attemptedPath: path };
}

/** Parse a stored path that may include a query string. */
export function parseHref(href: string): AppLocation {
  const q = href.indexOf("?");
  if (q < 0) return parsePath(href);
  return parsePath(href.slice(0, q), href.slice(q));
}

export function pathFor(location: AppLocation): string {
  switch (location.name) {
    case "today":
      return "/today";
    case "plan":
      return "/plan";
    case "plan-routine":
      return `/plan/routines/${encodeURIComponent(location.definitionId)}`;
    case "plan-responsibility":
      return `/plan/responsibilities/${encodeURIComponent(location.definitionId)}`;
    case "household":
      return "/household";
    case "household-people":
      return "/household/people";
    case "household-person":
      return `/household/people/${encodeURIComponent(location.membershipId)}`;
    case "household-group":
      return `/household/groups/${encodeURIComponent(location.groupId)}`;
    case "household-school-calendar":
      return "/household/school-calendar";
    case "household-history":
      return `/household/history${historySearch(location.filters)}`;
    case "household-history-occurrence":
      return `/household/history/${encodeURIComponent(location.occurrenceId)}${historySearch(location.filters)}`;
    case "household-settings":
      return "/household/settings";
    case "household-displays":
      return "/household/displays";
    case "unavailable":
      return location.attemptedPath || "/today";
  }
}

/** Logical parent for in-app Back (not browser history). */
export function parentLocation(location: AppLocation): AppLocation {
  switch (location.name) {
    case "today":
    case "plan":
    case "household":
      return { name: "today" };
    case "plan-routine":
    case "plan-responsibility":
      return { name: "plan" };
    case "household-people":
    case "household-school-calendar":
    case "household-history":
    case "household-settings":
    case "household-displays":
    case "unavailable":
      return { name: "household" };
    case "household-person":
    case "household-group":
      return { name: "household-people" };
    case "household-history-occurrence":
      return { name: "household-history", filters: location.filters };
  }
}

export function locationsEqual(a: AppLocation, b: AppLocation): boolean {
  return pathFor(a) === pathFor(b);
}

function currentPathWithSearch(): string {
  return `${normalizePathname(window.location.pathname)}${window.location.search}`;
}

export function rememberIntendedPath(pathname: string, search = ""): void {
  try {
    const path = normalizePathname(pathname);
    const query =
      !search || search === "?"
        ? ""
        : search.startsWith("?")
          ? search
          : `?${search}`;
    const full = `${path}${query}`;
    if (path === "/" || path === "/today") {
      sessionStorage.removeItem(INTENDED_PATH_KEY);
      return;
    }
    sessionStorage.setItem(INTENDED_PATH_KEY, full);
  } catch {
    /* private mode */
  }
}

export function consumeIntendedPath(): string | null {
  try {
    const value = sessionStorage.getItem(INTENDED_PATH_KEY);
    sessionStorage.removeItem(INTENDED_PATH_KEY);
    return value;
  } catch {
    return null;
  }
}

export function peekIntendedPath(): string | null {
  try {
    return sessionStorage.getItem(INTENDED_PATH_KEY);
  } catch {
    return null;
  }
}

export function replaceHistory(location: AppLocation): void {
  const next = pathFor(location);
  if (currentPathWithSearch() === next) return;
  window.history.replaceState(null, "", next);
}

export function pushHistory(location: AppLocation): void {
  const next = pathFor(location);
  if (currentPathWithSearch() === next) return;
  window.history.pushState(null, "", next);
}
