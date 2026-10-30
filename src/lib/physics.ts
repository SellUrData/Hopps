export const G = 9.80665;

export type Units = 'cm' | 'in';

export const heightFromFlightTime = (flightSec: number): number => (G * flightSec * flightSec) / 8;

export const flightTimeFromHeight = (heightM: number): number => Math.sqrt((8 * heightM) / G);

export const cmToUnits = (cm: number, units: Units): number => (units === 'in' ? cm / 2.54 : cm);

export function formatHeight(cm: number, units: Units, digits = 1): string {
  return `${cmToUnits(cm, units).toFixed(digits)} ${units}`;
}
