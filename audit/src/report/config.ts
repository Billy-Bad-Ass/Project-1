import { loadEnv } from '../lib/env';

// Pick up .env.local before any value below is read.
loadEnv();

/** Who the report is from. Edit this once; it brands every audit you send. */

export interface SenderConfig {
  name: string;
  business: string;
  email: string;
  phone?: string;
  website?: string;
  /** Shown in the closing section. Keep it short and specific. */
  offer: string;
  /** Accent colour used across the report. */
  accent: string;
}

export const sender: SenderConfig = {
  name: process.env.AUDIT_SENDER_NAME?.trim() || 'Your Name',
  business: process.env.AUDIT_SENDER_BUSINESS?.trim() || 'Your Business',
  email: process.env.AUDIT_SENDER_EMAIL?.trim() || 'you@example.com',
  phone: process.env.AUDIT_SENDER_PHONE?.trim() || undefined,
  website: process.env.AUDIT_SENDER_WEBSITE?.trim() || undefined,
  offer:
    process.env.AUDIT_SENDER_OFFER?.trim() ||
    'I fix these issues for small businesses. Happy to walk you through this report free of charge, whether or not you hire me.',
  accent: process.env.AUDIT_ACCENT?.trim() || '#2563eb',
};
