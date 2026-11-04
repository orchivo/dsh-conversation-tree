import type { home as zh } from '../zh/home.js'

/** home domain copy (English; must mirror the zh key set). */
export const home: Record<keyof typeof zh, string> = {
  'home.path.label': 'Current conversation',
  'home.anchor.label': 'The open conversation lives under this row',
  'home.ungrouped': 'Ungrouped',
}
