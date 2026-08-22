import type { Rule } from '../lib/types';
import { accessibilityRules } from './accessibility';
import { conversionRules } from './conversion';
import { findabilityRules } from './findability';
import { speedRules } from './speed';
import { technicalRules } from './technical';
import { trustRules } from './trust';

/**
 * Every rule the engine runs. Add one here and it appears in every report.
 *
 * Ordered by how much a business owner cares, not alphabetically: something
 * being broken or unreachable outranks it being imperfectly optimised. The
 * report preserves this ordering within equal severities.
 */
export const ALL_RULES: Rule[] = [
  ...technicalRules,
  ...conversionRules,
  ...trustRules,
  ...findabilityRules,
  ...speedRules,
  ...accessibilityRules,
];

export {
  accessibilityRules,
  conversionRules,
  findabilityRules,
  speedRules,
  technicalRules,
  trustRules,
};
