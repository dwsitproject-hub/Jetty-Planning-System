/**
 * One-record DataHub sync: scope the staged plan to a single hub code,
 * and refuse a local row that is not linked.
 * Run: npm run test:datahub
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCommoditySyncPlan } from './datahub-commodity-sync.js';
import { pullAndStageLocalRecord, scopePlanToHubCode, stageEntityFromHub } from './datahub-master-stage.js';

const linked = {
  id: 1,
  hub_code: 'CMD-0001',
  name: 'Crude Palm Oil',
  hub_type: 'liquid',
  kl_to_mt_factor: null,
  default_metric_id: 2,
  hs_code: '1511',
  material_code: 'M1',
};

const localOnly = {
  id: 2,
  hub_code: null,
  name: 'Plant only',
  hub_type: null,
  kl_to_mt_factor: null,
  default_metric_id: null,
  hs_code: null,
  material_code: null,
};

const hub = {
  hubCode: 'CMD-0001',
  hubRecordId: 'hub-1',
  values: {
    name: 'Crude Palm Oil',
    hub_type: 'liquid',
    uom: 'MT',
    hs_code: '1511',
    material_code: 'M1',
  },
};

function commodityDb() {
  return {
    async query(sql) {
      if (String(sql).includes('FROM metric')) return { rows: [{ id: 2, code: 'MT' }] };
      if (String(sql).includes('si_commodities')) return { rows: [linked, localOnly] };
      throw new Error(`unexpected query: ${sql}`);
    },
    async connect() {
      throw new Error('should not insert a sync run');
    },
  };
}

describe('datahub record sync', () => {
  it('drops other commodities, including local-only rows, from a one-record plan', () => {
    const plan = buildCommoditySyncPlan([hub], [linked, localOnly], { MT: 2 });
    assert.equal(plan.items.some((item) => item.localOnly), true);
    const scoped = scopePlanToHubCode(plan.items, plan.summary, 'CMD-0001');
    assert.equal(scoped.items.length, 1);
    assert.equal(scoped.items[0].hubCode, 'CMD-0001');
    assert.equal(scoped.items[0].localOnly, undefined);
    assert.equal(scoped.summary.localUnchangedCount, 0);
    assert.equal(scoped.summary.hubRecordCount, 1);
  });

  it('returns noChanges when that one record already matches', async () => {
    const result = await stageEntityFromHub(commodityDb(), 'commodity', [hub], {
      onlyHubCode: 'CMD-0001',
      source: 'record',
    });
    assert.equal(result.runId, null);
    assert.equal(result.summary.changedCount, 0);
    assert.equal(result.summary.newCount, 0);
  });

  it('refuses a local row that has no hub code', async () => {
    const db = {
      async query() {
        return { rows: [{ id: 5, hub_code: null }] };
      },
      async connect() {
        throw new Error('should not stage');
      },
    };
    await assert.rejects(
      () => pullAndStageLocalRecord(db, 'vessel', {}, 5),
      (e) => {
        assert.equal(e.status, 400);
        assert.match(e.message, /not linked/);
        return true;
      }
    );
  });

  it('returns 404 when the local row is missing', async () => {
    const db = {
      async query() {
        return { rows: [] };
      },
    };
    await assert.rejects(
      () => pullAndStageLocalRecord(db, 'vessel', {}, 9),
      (e) => {
        assert.equal(e.status, 404);
        return true;
      }
    );
  });
});
