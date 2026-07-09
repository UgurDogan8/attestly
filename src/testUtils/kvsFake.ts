/**
 * Minimal in-memory fake of the @forge/kvs custom-entity API (test plan §3):
 * get/set, cursor-paged index queries, and transactions. Scoped exactly to
 * the query shapes this app uses (data model §2 indexes) — not a general
 * DynamoDB simulator. If a new entity/index is added to manifest.yml, add
 * its shape to INDEX_DEFINITIONS below.
 *
 * Enforces the platform's page-size cap (test plan §3: "the fake enforces
 * platform limits ... so limit bugs surface in CI, not production").
 *
 * Usage — mock the real module per test file so production code (which
 * imports the real `@forge/kvs`) is exercised unmodified:
 *
 *   jest.mock('@forge/kvs', () => {
 *     const { InMemoryKvs, FakeSort, FakeWhereConditions } = require('../testUtils/kvsFake');
 *     return { __esModule: true, default: new InMemoryKvs(), Sort: FakeSort, WhereConditions: FakeWhereConditions };
 *   });
 *   import kvsFake from '@forge/kvs';
 *   const fake = kvsFake as unknown as InMemoryKvs;
 *   beforeEach(() => fake.reset());
 */

export enum FakeSort {
  ASC = 'ASC',
  DESC = 'DESC',
}

type EqualToCondition = { condition: 'EQUAL_TO'; values: [string | number | boolean] };

export const FakeWhereConditions = {
  equalTo: (value: string | number | boolean): EqualToCondition => ({ condition: 'EQUAL_TO', values: [value] }),
};

interface IndexDefinition {
  partition: string[];
  range?: string;
}

/** Mirrors manifest.yml's `app.storage.entities[].indexes` exactly (data model §2). */
const INDEX_DEFINITIONS: Record<string, Record<string, IndexDefinition>> = {
  confirmation: {
    'by-page': { partition: ['pageId'], range: 'confirmedAt' },
    'by-user': { partition: ['accountId'], range: 'confirmedAt' },
    'by-page-user': { partition: ['pageId', 'accountId'], range: 'pageVersion' },
  },
  'page-config': {
    tracked: { partition: ['active'], range: 'spaceKey' },
  },
  'config-audit': {
    'by-page': { partition: ['pageId'], range: 'at' },
  },
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

interface StoredItem<T> {
  key: string;
  value: T;
}

interface FakeResult<T> {
  key: string;
  value: T;
}

interface FakeListResult<T> {
  results: FakeResult<T>[];
  nextCursor?: string;
}

class FakeEntityQueryBuilder<T> {
  private sortDir: FakeSort = FakeSort.ASC;
  private limitValue = DEFAULT_LIMIT;
  private cursorValue: string | undefined;
  private rangeEqualTo: string | number | boolean | undefined;

  constructor(
    private readonly kvsInstance: InMemoryKvs,
    private readonly entityName: string,
    private readonly indexName: string,
    private readonly partition: unknown[],
  ) {}

  where(condition: EqualToCondition): this {
    if (condition.condition !== 'EQUAL_TO') {
      throw new Error(`kvsFake: where() condition "${condition.condition}" is not implemented`);
    }
    this.rangeEqualTo = condition.values[0];
    return this;
  }

  sort(sort: FakeSort): this {
    this.sortDir = sort;
    return this;
  }

  cursor(cursor: string): this {
    this.cursorValue = cursor;
    return this;
  }

  limit(limit: number): this {
    if (limit > MAX_LIMIT) {
      throw new Error(`kvsFake: limit ${limit} exceeds the platform max of ${MAX_LIMIT} (tech design §5)`);
    }
    this.limitValue = limit;
    return this;
  }

  async getMany(): Promise<FakeListResult<T>> {
    const def = INDEX_DEFINITIONS[this.entityName]?.[this.indexName];
    if (!def) {
      throw new Error(`kvsFake: unknown index "${this.indexName}" on entity "${this.entityName}"`);
    }

    const partitioned = this.kvsInstance
      .rawAll<T>(this.entityName)
      .filter(({ value }) => def.partition.every((field, i) => (value as Record<string, unknown>)[field] === this.partition[i]));

    const filtered =
      this.rangeEqualTo === undefined || !def.range
        ? partitioned
        : partitioned.filter(({ value }) => (value as Record<string, unknown>)[def.range as string] === this.rangeEqualTo);

    const sorted = def.range
      ? [...filtered].sort((a, b) => {
          const av = (a.value as Record<string, unknown>)[def.range as string] as string | number;
          const bv = (b.value as Record<string, unknown>)[def.range as string] as string | number;
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return this.sortDir === FakeSort.DESC ? -cmp : cmp;
        })
      : filtered;

    const offset = this.cursorValue ? Number(this.cursorValue) : 0;
    const page = sorted.slice(offset, offset + this.limitValue);
    const nextCursor = offset + this.limitValue < sorted.length ? String(offset + this.limitValue) : undefined;

    return { results: page.map(({ key, value }) => ({ key, value })), nextCursor };
  }

  async getOne(): Promise<FakeResult<T> | undefined> {
    const { results } = await this.limit(1).getMany();
    return results[0];
  }
}

class FakeEntity<T> {
  constructor(
    private readonly kvsInstance: InMemoryKvs,
    private readonly entityName: string,
  ) {}

  async get(key: string): Promise<T | undefined> {
    return this.kvsInstance.rawGet<T>(this.entityName, key);
  }

  async set(key: string, value: T): Promise<void> {
    this.kvsInstance.rawSet(this.entityName, key, value);
  }

  query(): { index: (indexName: string, options?: { partition?: unknown[] }) => FakeEntityQueryBuilder<T> } {
    return {
      index: (indexName: string, options?: { partition?: unknown[] }) =>
        new FakeEntityQueryBuilder<T>(this.kvsInstance, this.entityName, indexName, options?.partition ?? []),
    };
  }
}

class FakeTransactionBuilder {
  private readonly ops: Array<{ entityName: string; key: string; value: unknown }> = [];

  constructor(private readonly kvsInstance: InMemoryKvs) {}

  set<T>(key: string, value: T, entity?: { entityName: string }): this {
    if (!entity?.entityName) {
      throw new Error('kvsFake: transaction set() requires an entity name (custom entities only in this app)');
    }
    this.ops.push({ entityName: entity.entityName, key, value });
    return this;
  }

  delete(): this {
    throw new Error('kvsFake: transaction delete() is unused by this app — entities are append-only (data model §1)');
  }

  check(): this {
    return this;
  }

  async execute(): Promise<void> {
    for (const op of this.ops) {
      this.kvsInstance.rawSet(op.entityName, op.key, op.value);
    }
  }
}

export class InMemoryKvs {
  private readonly stores = new Map<string, Map<string, unknown>>();

  entity<T>(entityName: string): FakeEntity<T> {
    return new FakeEntity<T>(this, entityName);
  }

  transact(): FakeTransactionBuilder {
    return new FakeTransactionBuilder(this);
  }

  /** Test-only: clears all entities between tests. */
  reset(): void {
    this.stores.clear();
  }

  rawGet<T>(entityName: string, key: string): T | undefined {
    return this.storeFor(entityName).get(key) as T | undefined;
  }

  rawSet<T>(entityName: string, key: string, value: T): void {
    this.storeFor(entityName).set(key, value);
  }

  rawAll<T>(entityName: string): StoredItem<T>[] {
    return [...this.storeFor(entityName).entries()].map(([key, value]) => ({ key, value: value as T }));
  }

  private storeFor(entityName: string): Map<string, unknown> {
    let store = this.stores.get(entityName);
    if (!store) {
      store = new Map();
      this.stores.set(entityName, store);
    }
    return store;
  }
}
