/**
 * Trade and business types, mapped to how OpenStreetMap tags them.
 *
 * OSM is the right source for this: it is free, needs no key or account, and
 * crucially it records a business's `website` — which is what makes a
 * prospect auditable at all. A business with no website is a different
 * (larger) conversation and this tool has nothing to say about it.
 */

export interface Category {
  /** What you type. */
  id: string;
  label: string;
  /** OSM tag filters; any match qualifies. */
  tags: string[];
  /**
   * Other names for the same trade, so the tool answers to what the operator
   * actually calls it. The same business is a solicitor in the UK and a lawyer
   * in the US, and OSM tags it `office=lawyer` either way — the tag is shared,
   * only the word is not.
   */
  aliases?: string[];
}

export const CATEGORIES: Category[] = [
  // Trades — usually the best prospects: real budgets, weak websites.
  { id: 'plumber', label: 'Plumbers', tags: ['craft=plumber', 'shop=plumber'] },
  { id: 'electrician', label: 'Electricians', tags: ['craft=electrician'] },
  { id: 'builder', label: 'Builders', tags: ['craft=builder', 'craft=bricklayer'] },
  { id: 'roofer', label: 'Roofers', tags: ['craft=roofer'] },
  { id: 'carpenter', label: 'Carpenters and joiners', tags: ['craft=carpenter', 'craft=joiner'],
    aliases: ['joiner', 'joiners', 'woodworker'] },
  { id: 'painter', label: 'Painters and decorators', tags: ['craft=painter'] },
  { id: 'locksmith', label: 'Locksmiths', tags: ['craft=locksmith', 'shop=locksmith'] },
  { id: 'gardener', label: 'Gardeners and landscapers', tags: ['craft=gardener', 'shop=garden_centre'] },
  { id: 'cleaner', label: 'Cleaning companies', tags: ['shop=laundry', 'shop=dry_cleaning'] },

  // Healthcare — regulated, cash-generative, often dated sites.
  { id: 'dentist', label: 'Dentists', tags: ['amenity=dentist', 'healthcare=dentist'] },
  { id: 'doctor', label: 'GP and private clinics', tags: ['amenity=doctors', 'healthcare=doctor'] },
  { id: 'vet', label: 'Veterinary practices', tags: ['amenity=veterinary'] },
  { id: 'optician', label: 'Opticians', tags: ['shop=optician'] },
  { id: 'physio', label: 'Physiotherapists', tags: ['healthcare=physiotherapist'] },
  { id: 'chiropractor', label: 'Chiropractors', tags: ['healthcare=chiropractor'] },
  { id: 'pharmacy', label: 'Pharmacies', tags: ['amenity=pharmacy'] },

  // Professional services — high value per client.
  { id: 'solicitor', label: 'Solicitors', tags: ['office=lawyer'],
    aliases: ['lawyer', 'lawyers', 'attorney', 'attorneys', 'law firm', 'law firms'] },
  { id: 'accountant', label: 'Accountants', tags: ['office=accountant'] },
  { id: 'estate-agent', label: 'Estate agents', tags: ['office=estate_agent'],
    aliases: ['realtor', 'realtors', 'real estate', 'real estate agent', 'real estate agents'] },
  { id: 'insurance', label: 'Insurance brokers', tags: ['office=insurance'] },
  { id: 'financial-adviser', label: 'Financial advisers', tags: ['office=financial_advisor', 'office=financial'],
    aliases: ['financial advisor', 'financial advisors'] },
  { id: 'architect', label: 'Architects', tags: ['office=architect'] },

  // Consumer businesses — smaller budgets, but volume and quick decisions.
  { id: 'hairdresser', label: 'Hairdressers and barbers', tags: ['shop=hairdresser'] },
  { id: 'beauty', label: 'Beauty salons', tags: ['shop=beauty'] },
  { id: 'tattoo', label: 'Tattoo studios', tags: ['shop=tattoo'] },
  { id: 'gym', label: 'Gyms', tags: ['leisure=fitness_centre'] },
  { id: 'restaurant', label: 'Restaurants', tags: ['amenity=restaurant'] },
  { id: 'cafe', label: 'Cafes', tags: ['amenity=cafe'] },
  { id: 'pub', label: 'Pubs and bars', tags: ['amenity=pub', 'amenity=bar'] },
  { id: 'hotel', label: 'Hotels and B&Bs', tags: ['tourism=hotel', 'tourism=guest_house'] },
  { id: 'garage', label: 'Car garages', tags: ['shop=car_repair'] },
  { id: 'car-dealer', label: 'Car dealers', tags: ['shop=car'] },
  { id: 'florist', label: 'Florists', tags: ['shop=florist'] },
  { id: 'bakery', label: 'Bakeries', tags: ['shop=bakery'] },
  { id: 'butcher', label: 'Butchers', tags: ['shop=butcher'] },
  { id: 'jeweller', label: 'Jewellers', tags: ['shop=jewelry'] },
  { id: 'funeral', label: 'Funeral directors', tags: ['shop=funeral_directors'] },
  { id: 'pet-groomer', label: 'Pet groomers', tags: ['shop=pet_grooming', 'shop=pet'] },
  { id: 'driving-school', label: 'Driving schools', tags: ['amenity=driving_school'] },
  { id: 'nursery', label: 'Nurseries and childcare', tags: ['amenity=kindergarten', 'amenity=childcare'] },
];

export function findCategory(id: string): Category | null {
  const key = id.trim().toLowerCase();
  return (
    CATEGORIES.find((c) => c.id === key) ??
    CATEGORIES.find((c) => c.label.toLowerCase() === key) ??
    CATEGORIES.find((c) => c.aliases?.includes(key)) ??
    // Tolerate plurals and near-misses: "dentists" should find "dentist".
    CATEGORIES.find((c) => c.id === key.replace(/s$/, '')) ??
    CATEGORIES.find((c) => c.label.toLowerCase().includes(key)) ??
    null
  );
}

export function categoryList(): string {
  return CATEGORIES.map((c) => `  ${c.id.padEnd(18)} ${c.label}`).join('\n');
}
