import { vi } from "vitest";

/** The browser's own Intl, as the test file found it before any test stood in for it. */
const REAL_INTL = Intl;

/** Makes the browser's own time zone, as the page asks Intl for it (times.ts `browserZone`), the one a test names: the page
 * then says the same local times on every machine, the build's and any other. Only a format made without a zone of its own
 * takes it; one that names its zone keeps that. The stand-in goes with `vi.unstubAllGlobals`, or with the next one. */
export function fixTimeZone(zone: string): void {
  const Real = REAL_INTL.DateTimeFormat;
  const Fixed = function (locales?: string | string[], options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    return new Real(locales, { timeZone: zone, ...options });
  } as unknown as typeof Intl.DateTimeFormat;
  Object.assign(Fixed, { prototype: Real.prototype, supportedLocalesOf: Real.supportedLocalesOf.bind(Real) });
  vi.stubGlobal("Intl", Object.create(REAL_INTL, { DateTimeFormat: { value: Fixed, writable: true, configurable: true } }));
}
