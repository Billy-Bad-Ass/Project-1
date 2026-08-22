/**
 * Rough bounding boxes, used only to work out which country a place is in.
 *
 * OpenStreetMap admin boundaries mostly do not carry a country code — a live
 * run found fifteen areas named "Bristol" and not one of them said which
 * country it was in. Coordinates do say, and unambiguously enough for this
 * job: Bristol UK and Bristol Tennessee are four thousand miles apart.
 *
 * These are deliberately generous. They are for telling countries apart, not
 * for drawing borders, and a box that is slightly too big costs nothing while
 * one that is too small silently loses a real place.
 */

export interface BoundingBox {
  code: string;
  name: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export const COUNTRY_BOXES: BoundingBox[] = [
  { code: 'GB', name: 'United Kingdom', minLat: 49.5, maxLat: 61.0, minLon: -8.8, maxLon: 2.1 },
  { code: 'IE', name: 'Ireland', minLat: 51.3, maxLat: 55.5, minLon: -10.6, maxLon: -5.9 },
  { code: 'US', name: 'United States', minLat: 24.4, maxLat: 49.4, minLon: -125.0, maxLon: -66.9 },
  { code: 'CA', name: 'Canada', minLat: 41.6, maxLat: 83.2, minLon: -141.1, maxLon: -52.6 },
  { code: 'AU', name: 'Australia', minLat: -43.7, maxLat: -10.6, minLon: 112.9, maxLon: 153.7 },
  { code: 'NZ', name: 'New Zealand', minLat: -47.3, maxLat: -34.4, minLon: 166.4, maxLon: 178.6 },
  { code: 'DE', name: 'Germany', minLat: 47.2, maxLat: 55.1, minLon: 5.8, maxLon: 15.1 },
  { code: 'FR', name: 'France', minLat: 41.3, maxLat: 51.1, minLon: -5.2, maxLon: 9.7 },
  { code: 'ES', name: 'Spain', minLat: 35.9, maxLat: 43.9, minLon: -9.4, maxLon: 3.4 },
  { code: 'IT', name: 'Italy', minLat: 35.4, maxLat: 47.1, minLon: 6.6, maxLon: 18.6 },
  { code: 'NL', name: 'Netherlands', minLat: 50.7, maxLat: 53.6, minLon: 3.3, maxLon: 7.3 },
  { code: 'BE', name: 'Belgium', minLat: 49.4, maxLat: 51.6, minLon: 2.5, maxLon: 6.5 },
  { code: 'PT', name: 'Portugal', minLat: 36.9, maxLat: 42.2, minLon: -9.6, maxLon: -6.1 },
  { code: 'ZA', name: 'South Africa', minLat: -35.0, maxLat: -22.0, minLon: 16.3, maxLon: 33.0 },
  { code: 'IN', name: 'India', minLat: 6.7, maxLat: 35.6, minLon: 68.1, maxLon: 97.4 },
];

/**
 * Which of the known countries a point falls in.
 *
 * Boxes overlap at the edges (Ireland sits inside the UK box), so the smallest
 * matching box wins — it is the more specific claim.
 */
export function countryAt(lat: number, lon: number): BoundingBox | null {
  const matches = COUNTRY_BOXES.filter(
    (b) => lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon,
  );
  if (matches.length === 0) return null;

  const area = (b: BoundingBox) => (b.maxLat - b.minLat) * (b.maxLon - b.minLon);
  return [...matches].sort((a, b) => area(a) - area(b))[0]!;
}

export function knownCountryCodes(): string[] {
  return COUNTRY_BOXES.map((b) => b.code);
}
