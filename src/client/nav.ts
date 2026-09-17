/**
 * Path-based History API destinations for P0-006A (D-027).
 *
 * Required addressable views:
 *   / or /today                         → Today
 *   /plan                               → Routines list (nav label Plan)
 *   /plan/routines/:definitionId        → routine detail (active or ended)
 *   /household                          → Household menu
 *   /household/people                   → People & Groups overview
 *   /household/people/:membershipId     → person detail
 *   /household/groups/:groupId          → group detail
 *   /household/school-calendar          → school calendar
 *
 * Edit/create/picker/ended-list and other secondary surfaces stay in-app local
 * state under their parent URL unless noted. Browser Back follows history;
 * in-app Back follows logical parent.
 */

export type AppLocation =
  | { name: "today" }
  | { name: "plan" }
  | { name: "plan-routine"; definitionId: string }
  | { name: "household" }
  | { name: "household-people" }
  | { name: "household-person"; membershipId: string }
  | { name: "household-group"; groupId: string }
  | { name: "household-school-calendar" }
  | { name: "unavailable"; attemptedPath: string };

const INTENDED_PATH_KEY = "hd_intended_path";

export function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function parsePath(pathname: string): AppLocation {
  const path = normalizePathname(pathname);
  if (path === "/" || path === "/today") return { name: "today" };
  if (path === "/plan") return { name: "plan" };

  const routineMatch = /^\/plan\/routines\/([^/]+)$/.exec(path);
  if (routineMatch?.[1]) {
    return { name: "plan-routine", definitionId: decodeURIComponent(routineMatch[1]) };
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

  return { name: "unavailable", attemptedPath: path };
}

export function pathFor(location: AppLocation): string {
  switch (location.name) {
    case "today":
      return "/today";
    case "plan":
      return "/plan";
    case "plan-routine":
      return `/plan/routines/${encodeURIComponent(location.definitionId)}`;
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
      return { name: "plan" };
    case "household-people":
    case "household-school-calendar":
    case "unavailable":
      return { name: "household" };
    case "household-person":
    case "household-group":
      return { name: "household-people" };
  }
}

export function locationsEqual(a: AppLocation, b: AppLocation): boolean {
  return pathFor(a) === pathFor(b);
}

export function rememberIntendedPath(pathname: string): void {
  try {
    const path = normalizePathname(pathname);
    if (path === "/" || path === "/today") {
      sessionStorage.removeItem(INTENDED_PATH_KEY);
      return;
    }
    sessionStorage.setItem(INTENDED_PATH_KEY, path);
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
  if (normalizePathname(window.location.pathname) === normalizePathname(next)) return;
  window.history.replaceState(null, "", next);
}

export function pushHistory(location: AppLocation): void {
  const next = pathFor(location);
  if (normalizePathname(window.location.pathname) === normalizePathname(next)) return;
  window.history.pushState(null, "", next);
}
