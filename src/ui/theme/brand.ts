import { CATEGORY_BY_ID, UNCATEGORIZED, type CategoryDef } from '../../core/categories';
import type { CategoryId } from '../../core/types';
import { withAlpha } from './palette';

/**
 * Brand tiles for banks and well-known merchants (colours from the design's
 * mock data). Unknown names get a deterministic colour from a hash of the name.
 */
export interface BrandTile {
  initials: string;
  color: string;
}

interface BrandEntry extends BrandTile {
  /** Normalised name prefixes that identify the brand. Longest match wins. */
  keys: string[];
}

const BRANDS: BrandEntry[] = [
  // Banks
  { keys: ['hdfc'], initials: 'HD', color: '#004C8F' },
  { keys: ['sbi', 'statebankofindia'], initials: 'SB', color: '#1E3F8F' },
  { keys: ['kotak'], initials: 'KO', color: '#C8102E' },
  { keys: ['icici'], initials: 'IC', color: '#9E2A1F' },
  { keys: ['axis'], initials: 'AX', color: '#97144D' },
  // Merchants
  { keys: ['swiggyinstamart', 'instamart'], initials: 'SI', color: '#FC8019' },
  { keys: ['swiggy'], initials: 'S', color: '#FC8019' },
  { keys: ['uber'], initials: 'U', color: '#000000' },
  { keys: ['dmart'], initials: 'D', color: '#0B7A3E' },
  { keys: ['bescom'], initials: 'BE', color: '#B88A00' },
  { keys: ['bluetokai'], initials: 'BT', color: '#1F3A5F' },
  { keys: ['amazon'], initials: 'a', color: '#232F3E' },
  { keys: ['airtel'], initials: 'A', color: '#D9001B' },
  { keys: ['myntra'], initials: 'M', color: '#E72C70' },
  { keys: ['naturesbasket'], initials: 'NB', color: '#5B8C2A' },
  { keys: ['zomato'], initials: 'Z', color: '#E23744' },
  { keys: ['bigbasket'], initials: 'BB', color: '#6FA51B' },
  { keys: ['rohanmehta'], initials: 'RM', color: '#6A4FA3' },
];

/** Fallback palette for unknown names (mid-tone, white text stays legible in both themes). */
const HASH_COLORS = [
  '#3B6BFF',
  '#0B7A3E',
  '#B4380E',
  '#6A4FA3',
  '#00788A',
  '#A2367E',
  '#5C6B12',
  '#1F3A5F',
  '#8A5A00',
  '#C2255C',
];

export function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function initialsOf(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  if (words.length === 1) {
    return words[0][0].toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function brandFor(name: string): BrandTile {
  const n = normaliseName(name);
  let best: BrandEntry | undefined;
  let bestLen = 0;
  for (const b of BRANDS) {
    for (const k of b.keys) {
      if (n.startsWith(k) && k.length > bestLen) {
        best = b;
        bestLen = k.length;
      }
    }
  }
  if (best) {
    return { initials: best.initials, color: best.color };
  }
  return { initials: initialsOf(name), color: HASH_COLORS[hash(n) % HASH_COLORS.length] };
}

export interface CategoryVisual {
  def: CategoryDef;
  color: string;
  /** Same colour at 14 % alpha (design: `color + '24'`). */
  soft: string;
}

export function categoryVisual(id: CategoryId): CategoryVisual {
  const def = CATEGORY_BY_ID[id] ?? CATEGORY_BY_ID[UNCATEGORIZED];
  return { def, color: def.color, soft: withAlpha(def.color) };
}
