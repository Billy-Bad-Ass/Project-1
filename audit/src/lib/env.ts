import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Loads .env.local (then .env) into the environment.
 *
 * Exists so the sender details do not have to be exported by hand before every
 * command. Values already present in the environment win, so CI and one-off
 * overrides still take precedence over the file.
 *
 * Deliberately no dependency: this is twenty lines and dotenv is a supply-chain
 * surface for something the standard library can do.
 */

let loaded = false;

function parse(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const equals = line.indexOf('=');
    if (equals === -1) continue;

    const key = line.slice(0, equals).trim();
    if (key === '') continue;

    let value = line.slice(equals + 1).trim();
    // Strip matching quotes, which people add out of habit and rarely intend
    // as part of the value.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

export function loadEnv(cwd = process.cwd()): void {
  if (loaded) return;
  loaded = true;

  // .env.local first: it is the personal, gitignored one and should win.
  for (const file of ['.env.local', '.env']) {
    let contents: string;
    try {
      contents = readFileSync(join(cwd, file), 'utf8');
    } catch {
      continue;
    }

    for (const [key, value] of Object.entries(parse(contents))) {
      // Never clobber a real environment variable.
      if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = value;
      }
    }
  }
}
