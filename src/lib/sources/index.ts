import type { DataSource } from './types';
import { cheapsharkSource } from './cheapshark';
import { openLibrarySource } from './openlibrary';

/** Register a new adapter here and it becomes selectable via `site.source`. */
export const SOURCES: Record<string, DataSource> = {
  [cheapsharkSource.id]: cheapsharkSource,
  [openLibrarySource.id]: openLibrarySource,
};

export function getSource(id: string): DataSource {
  const source = SOURCES[id];
  if (!source) {
    throw new Error(
      `Unknown source "${id}". Available: ${Object.keys(SOURCES).join(', ')}`,
    );
  }
  return source;
}

export type { DataSource };
