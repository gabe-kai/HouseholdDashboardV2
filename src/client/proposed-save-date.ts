/** Keep an intentional future start; rebase implicit "today" starts to the current household date. */
export function proposedSaveDate(
  startingDate: string,
  previousDate: string,
  currentDate: string,
): string {
  return startingDate > previousDate ? startingDate : currentDate;
}
