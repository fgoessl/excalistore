/**
 * Formats an ISO timestamp as a relative string ("3 minutes ago", "in 2
 * days") using the built-in `Intl.RelativeTimeFormat` — no date library
 * dependency. Standard progressive-division approach (seconds -> minutes ->
 * hours -> days -> weeks -> months -> years).
 */

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "seconds" },
  { amount: 60, unit: "minutes" },
  { amount: 24, unit: "hours" },
  { amount: 7, unit: "days" },
  { amount: 4.34524, unit: "weeks" },
  { amount: 12, unit: "months" },
  { amount: Number.POSITIVE_INFINITY, unit: "years" },
];

const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    // Guards against blank/malformed timestamps (e.g. test fixtures using
    // "") rather than throwing — Intl.RelativeTimeFormat.format rejects
    // non-finite durations.
    return "unknown time";
  }

  let duration = (date.getTime() - Date.now()) / 1000;

  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return formatter.format(Math.round(duration), "years");
}
