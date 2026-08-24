import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  compareDocBrowserRows,
  formatDocTableDateTime,
  nextDocTableSort,
  normalizeDocTableTimestamp,
  sortDocBrowserRows,
} from '../src/docs-table.js';

function row(id, title, createdAt, updatedAt) {
  return {
    type: 'document',
    item: {
      record_id: id,
      title,
      created_at: createdAt,
      updated_at: updatedAt,
    },
  };
}

describe('Docs table sorting', () => {
  const rows = [
    row('bravo', 'Bravo', '2026-07-02T04:00:00Z', '2026-07-04T04:00:00Z'),
    row('alpha-new', 'Alpha', '2026-07-03T04:00:00Z', '2026-07-03T04:00:00Z'),
    row('alpha-old', 'Alpha', '2026-07-01T04:00:00Z', '2026-07-05T04:00:00Z'),
  ];

  it('toggles an active field and uses sensible initial directions for a new field', () => {
    expect(nextDocTableSort('name', 'asc', 'name')).toEqual({ field: 'name', direction: 'desc' });
    expect(nextDocTableSort('name', 'desc', 'created_at')).toEqual({ field: 'created_at', direction: 'desc' });
    expect(nextDocTableSort('created_at', 'desc', 'updated_at')).toEqual({ field: 'updated_at', direction: 'desc' });
    expect(nextDocTableSort('updated_at', 'desc', 'name')).toEqual({ field: 'name', direction: 'asc' });
  });

  it('sorts by name, created timestamp, and updated timestamp in both directions', () => {
    expect(sortDocBrowserRows(rows, 'name', 'asc').map(({ item }) => item.record_id))
      .toEqual(['alpha-new', 'alpha-old', 'bravo']);
    expect(sortDocBrowserRows(rows, 'name', 'desc').map(({ item }) => item.record_id))
      .toEqual(['bravo', 'alpha-new', 'alpha-old']);
    expect(sortDocBrowserRows(rows, 'created_at', 'asc').map(({ item }) => item.record_id))
      .toEqual(['alpha-old', 'bravo', 'alpha-new']);
    expect(sortDocBrowserRows(rows, 'created_at', 'desc').map(({ item }) => item.record_id))
      .toEqual(['alpha-new', 'bravo', 'alpha-old']);
    expect(sortDocBrowserRows(rows, 'updated_at', 'asc').map(({ item }) => item.record_id))
      .toEqual(['alpha-new', 'bravo', 'alpha-old']);
    expect(sortDocBrowserRows(rows, 'updated_at', 'desc').map(({ item }) => item.record_id))
      .toEqual(['alpha-old', 'bravo', 'alpha-new']);
  });

  it('keeps missing timestamps last and resolves equal values deterministically', () => {
    const equalAndMissing = [
      row('zeta', 'Zeta', null, 'invalid'),
      row('beta-2', 'Beta', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
      row('beta-1', 'Beta', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
      row('alpha', 'Alpha', undefined, undefined),
    ];

    expect(sortDocBrowserRows(equalAndMissing, 'created_at', 'asc').map(({ item }) => item.record_id))
      .toEqual(['beta-1', 'beta-2', 'alpha', 'zeta']);
    expect(sortDocBrowserRows(equalAndMissing, 'created_at', 'desc').map(({ item }) => item.record_id))
      .toEqual(['beta-1', 'beta-2', 'alpha', 'zeta']);
    expect(compareDocBrowserRows(equalAndMissing[1], equalAndMissing[2], 'updated_at', 'desc')).toBeGreaterThan(0);
  });
});

describe('Docs table timestamp display', () => {
  it('formats valid timestamps and safely represents missing or invalid values', () => {
    const formatter = (date) => date.toISOString().replace('T', ' ').replace('.000Z', ' UTC');
    expect(formatDocTableDateTime('2026-07-28T04:15:00Z', formatter)).toBe('2026-07-28 04:15:00 UTC');
    expect(formatDocTableDateTime('', formatter)).toBe('—');
    expect(formatDocTableDateTime('not-a-date', formatter)).toBe('—');
    expect(normalizeDocTableTimestamp('2026-07-28T04:15:00Z')).toBe('2026-07-28T04:15:00.000Z');
    expect(normalizeDocTableTimestamp('not-a-date')).toBe('');
  });
});

describe('Docs table template', () => {
  it('renders one responsive table with accessible buttons for every visible header', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const tableStart = html.indexOf('<div class="doc-table-scroll">');
    const tableEnd = html.indexOf('<div class="docs-empty-panel"', tableStart);
    const table = html.slice(tableStart, tableEnd);

    expect(table).toContain('role="table" aria-label="Documents"');
    expect(table.match(/role="columnheader"/g)).toHaveLength(3);
    expect(table.match(/class="doc-table-sort-btn"/g)).toHaveLength(3);
    expect(table).toContain("@click=\"$store.chat.setDocTableSort('name')\"");
    expect(table).toContain("@click=\"$store.chat.setDocTableSort('created_at')\"");
    expect(table).toContain("@click=\"$store.chat.setDocTableSort('updated_at')\"");
    expect(table).toContain('$store.chat.formatDocTableDateTime(row.item.created_at)');
    expect(table).toContain('$store.chat.formatDocTableDateTime(row.item.updated_at)');
  });
});
