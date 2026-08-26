import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { migrateSourceBaseUrl } from './tank-gauging-source-config.js';
import { syncTankGaugingMap } from './tank-gauging-poll-job.js';

const PORT_ID = 1;
const OLD_URL = 'http://172.16.246.10';
const NEW_URL = 'http://172.16.247.90';
const OTHER_URL = 'http://172.16.11.77';

function createState(initial = {}) {
  return {
    sources: initial.sources ?? [],
    maps: initial.maps ?? [],
    tanks: initial.tanks ?? [],
    latest: initial.latest ?? [],
    samples: initial.samples ?? [],
    nextTankId: initial.nextTankId ?? 100,
    nextSort: initial.nextSort ?? 1,
  };
}

function createMockDb(state) {
  return {
    state,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, ' ').trim();

      if (s.startsWith('UPDATE tank_gauging_tank_map SET source_base_url')) {
        const [newBase, portId, oldBase] = params;
        let count = 0;
        for (const m of state.maps) {
          if (m.port_id === portId && m.source_base_url === oldBase) {
            m.source_base_url = newBase;
            count += 1;
          }
        }
        return { rowCount: count, rows: [] };
      }

      if (s.startsWith('UPDATE tank_gauging_latest SET source_base_url')) {
        const [newBase, oldBase, portId] = params;
        const tankIds = new Set(
          state.maps
            .filter((m) => m.port_id === portId && m.source_base_url === newBase)
            .map((m) => m.tank_id)
        );
        let count = 0;
        for (const row of state.latest) {
          if (row.source_base_url === oldBase && tankIds.has(row.tank_id)) {
            row.source_base_url = newBase;
            count += 1;
          }
        }
        return { rowCount: count, rows: [] };
      }

      if (s.startsWith('UPDATE tank_gauging_samples SET source_base_url')) {
        const [newBase, oldBase] = params;
        let count = 0;
        for (const row of state.samples) {
          if (row.source_base_url === oldBase) {
            row.source_base_url = newBase;
            count += 1;
          }
        }
        return { rowCount: count, rows: [] };
      }

      if (s.includes('DELETE FROM tank_gauging_tank_map m') && s.includes('NOT EXISTS')) {
        const [portId] = params;
        const before = state.maps.length;
        state.maps = state.maps.filter((m) => {
          if (m.port_id !== portId) return true;
          return state.sources.some(
            (src) => src.port_id === m.port_id && src.base_url === m.source_base_url
          );
        });
        return { rowCount: before - state.maps.length, rows: [] };
      }

      if (s.startsWith('DELETE FROM tank_gauging_tank_map WHERE port_id')) {
        const [portId, base] = params;
        const before = state.maps.length;
        state.maps = state.maps.filter(
          (m) => !(m.port_id === portId && m.source_base_url === base)
        );
        return { rowCount: before - state.maps.length, rows: [] };
      }

      if (s.includes('FROM master_tanks') && s.includes('LOWER(code)')) {
        const [portId, code] = params;
        const row = state.tanks.find(
          (t) =>
            t.port_id === portId &&
            t.deleted_at == null &&
            t.code.toLowerCase() === String(code).toLowerCase()
        );
        return { rows: row ? [{ id: row.id }] : [] };
      }

      if (s.includes('FROM tank_gauging_tank_map m') && s.includes('EXISTS')) {
        const [tankId, base] = params;
        const hit = state.maps.find(
          (m) =>
            m.tank_id === tankId &&
            m.source_base_url !== base &&
            state.sources.some(
              (src) => src.port_id === m.port_id && src.base_url === m.source_base_url
            )
        );
        return { rows: hit ? [{ '?column?': 1 }] : [] };
      }

      if (s.startsWith('UPDATE master_tanks')) {
        const [tankId, name] = params;
        const tank = state.tanks.find((t) => t.id === tankId);
        if (tank && name) tank.name = name;
        return { rows: [] };
      }

      if (s.includes('COALESCE(MAX(sort_order)')) {
        const max = state.tanks.reduce((n, t) => Math.max(n, t.sort_order ?? 0), 0);
        return { rows: [{ next: max + 1 }] };
      }

      if (s.startsWith('INSERT INTO master_tanks')) {
        const [portId, code, name, sortOrder] = params;
        const id = state.nextTankId++;
        state.tanks.push({
          id,
          port_id: portId,
          code,
          name,
          sort_order: sortOrder,
          deleted_at: null,
        });
        return { rows: [{ id }] };
      }

      if (s.startsWith('INSERT INTO tank_gauging_tank_map')) {
        const [portId, base, unitName, externalTankId, tankId] = params;
        const idx = state.maps.findIndex(
          (m) =>
            m.port_id === portId &&
            m.source_base_url === base &&
            m.external_tank_id === externalTankId
        );
        const row = {
          port_id: portId,
          source_base_url: base,
          source_unit_name: unitName,
          external_tank_id: externalTankId,
          tank_id: tankId,
        };
        if (idx >= 0) state.maps[idx] = row;
        else state.maps.push(row);
        return { rows: [] };
      }

      throw new Error(`Unhandled mock query: ${s.slice(0, 120)}`);
    },
  };
}

describe('migrateSourceBaseUrl', () => {
  it('moves map, latest, and sample rows from old URL to new URL', async () => {
    const state = createState({
      maps: [{ port_id: PORT_ID, source_base_url: OLD_URL, tank_id: 1, external_tank_id: 1 }],
      latest: [{ tank_id: 1, source_base_url: OLD_URL }],
      samples: [{ id: 1, source_base_url: OLD_URL }],
    });
    const db = createMockDb(state);

    const result = await migrateSourceBaseUrl(db, PORT_ID, OLD_URL, NEW_URL);

    assert.equal(result.mapsMigrated, 1);
    assert.equal(result.latestMigrated, 1);
    assert.equal(result.samplesMigrated, 1);
    assert.equal(state.maps[0].source_base_url, NEW_URL);
    assert.equal(state.latest[0].source_base_url, NEW_URL);
    assert.equal(state.samples[0].source_base_url, NEW_URL);
  });
});

describe('syncTankGaugingMap', () => {
  it('reuses clean tank code after IP change when stale map is orphaned', async () => {
    const state = createState({
      sources: [{ port_id: PORT_ID, base_url: NEW_URL }],
      tanks: [{ id: 1, port_id: PORT_ID, code: '5201', name: 'TK 5201', deleted_at: null }],
      maps: [{ port_id: PORT_ID, source_base_url: OLD_URL, tank_id: 1, external_tank_id: 1 }],
    });
    const db = createMockDb(state);

    const result = await syncTankGaugingMap(db, PORT_ID, NEW_URL, 'NXA820_BT_1', [
      { externalTankId: 1, name: 'TK 5201', code: '5201' },
    ]);

    assert.equal(result.mapped, 1);
    assert.equal(result.ensured, 0);
    assert.equal(state.tanks.length, 1);
    assert.equal(state.tanks[0].code, '5201');
    assert.equal(state.maps.length, 1);
    assert.equal(state.maps[0].source_base_url, NEW_URL);
    assert.equal(state.maps[0].tank_id, 1);
  });

  it('still suffixes tank code when another active source owns the same code', async () => {
    const state = createState({
      sources: [
        { port_id: PORT_ID, base_url: OTHER_URL },
        { port_id: PORT_ID, base_url: NEW_URL },
      ],
      tanks: [{ id: 1, port_id: PORT_ID, code: '5201', name: 'TK 5201', deleted_at: null }],
      maps: [
        {
          port_id: PORT_ID,
          source_base_url: OTHER_URL,
          tank_id: 1,
          external_tank_id: 99,
        },
      ],
    });
    const db = createMockDb(state);

    await syncTankGaugingMap(db, PORT_ID, NEW_URL, 'NXA820_BT_1', [
      { externalTankId: 1, name: 'TK 5201', code: '5201' },
    ]);

    const suffixed = state.tanks.find((t) => t.code.includes('@'));
    assert.ok(suffixed, 'expected a disambiguated tank code with @host suffix');
    assert.match(suffixed.code, /^5201@172\.16\.247\.90$/);
    const newMap = state.maps.find((m) => m.source_base_url === NEW_URL);
    assert.equal(newMap.tank_id, suffixed.id);
  });
});
