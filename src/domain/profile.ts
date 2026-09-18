import { isValidHouseholdDate, compareHouseholdDates } from "./time.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FRIENDLY_NAME_MAX = 80;
const FULL_NAME_MAX = 120;
const EMAIL_MAX = 254;

export type ProfileValidationIssue = { path: string; message: string };

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function validateFriendlyName(value: string): ProfileValidationIssue[] {
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    return [{ path: "displayName", message: "Friendly name is required" }];
  }
  if (trimmed.length > FRIENDLY_NAME_MAX) {
    return [{ path: "displayName", message: "Friendly name is too long" }];
  }
  return [];
}

export function validateFullName(value: string | null | undefined): ProfileValidationIssue[] {
  const normalized = normalizeOptionalText(value);
  if (normalized && normalized.length > FULL_NAME_MAX) {
    return [{ path: "fullName", message: "Full name is too long" }];
  }
  return [];
}

export function validateEmail(value: string | null | undefined): ProfileValidationIssue[] {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return [];
  if (normalized.length > EMAIL_MAX) {
    return [{ path: "email", message: "Email is too long" }];
  }
  if (!EMAIL_RE.test(normalized)) {
    return [{ path: "email", message: "Email is not valid" }];
  }
  return [];
}

/** Birthday is a household calendar date; leap days must be real; never after household today. */
export function validateBirthday(
  value: string | null | undefined,
  householdToday: string,
): ProfileValidationIssue[] {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return [];
  if (!isValidHouseholdDate(normalized)) {
    return [{ path: "birthday", message: "Birthday must be a real calendar date" }];
  }
  if (compareHouseholdDates(normalized, householdToday) > 0) {
    return [{ path: "birthday", message: "Birthday cannot be after household today" }];
  }
  return [];
}

export function validateProfileFields(input: {
  displayName: string;
  fullName?: string | null;
  birthday?: string | null;
  email?: string | null;
  householdToday: string;
}): ProfileValidationIssue[] {
  return [
    ...validateFriendlyName(input.displayName),
    ...validateFullName(input.fullName),
    ...validateBirthday(input.birthday, input.householdToday),
    ...validateEmail(input.email),
  ];
}
