// `YYYY-MM-DD` for "today", built from the device's local calendar date.
//
// `new Date().toISOString().slice(0, 10)` looks equivalent but is not: it
// goes through UTC first, so anywhere west of Greenwich (Brazil included) it
// can report the wrong day near midnight — the exact window where an offline
// read served from yesterday's cache would otherwise go unnoticed. Building
// the string from local getters (`getFullYear`/`getMonth`/`getDate`) avoids
// that conversion entirely.
export function todayLocalDate(reference: Date = new Date()): string {
  const year = reference.getFullYear();
  const month = String(reference.getMonth() + 1).padStart(2, '0');
  const day = String(reference.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
