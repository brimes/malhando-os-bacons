// Unit coverage for the reactive IndexedDB mirror every `lib/local/repo/*.ts`
// module builds on. No network, no axios — see the module comment on
// `foodLogsRepo`-style integration coverage for why that layer is instead
// exercised through the Playwright scenarios in the slice's verification
// section rather than here.

import { beforeEach, describe, expect, it } from 'vitest';
import { clearStore, getAll } from '../../localDb';
import { EntityCache } from '../entityStore';

interface Row {
  id: number;
  name: string;
}

describe('EntityCache', () => {
  beforeEach(async () => {
    await clearStore('food_items');
  });

  it('is empty, not undefined, before the first load', () => {
    const cache = new EntityCache<Row>('food_items');
    expect(cache.getAll()).toStrictEqual([]);
    expect(cache.isLoaded()).toBe(false);
  });

  it('loads whatever IndexedDB already has, once, and notifies subscribers', async () => {
    await clearStore('food_items');
    const seeded = new EntityCache<Row>('food_items');
    await seeded.put({ id: 1, name: 'Arroz' });

    const cache = new EntityCache<Row>('food_items');
    let notified = 0;
    cache.subscribe(() => { notified += 1; });
    await cache.ensureLoaded();

    expect(cache.getAll()).toStrictEqual([{ id: 1, name: 'Arroz' }]);
    expect(notified).toBeGreaterThan(0);
  });

  it('put() updates the in-memory mirror before IndexedDB confirms, and persists', async () => {
    const cache = new EntityCache<Row>('food_items');
    await cache.ensureLoaded();
    const write = cache.put({ id: -1, name: 'Feijão' });
    // Readable synchronously, before `write` resolves.
    expect(cache.get(-1)).toStrictEqual({ id: -1, name: 'Feijão' });
    await write;
    const persisted = await getAll<Row>('food_items');
    expect(persisted).toStrictEqual([{ id: -1, name: 'Feijão' }]);
  });

  it('remove() drops the record from both the mirror and IndexedDB', async () => {
    const cache = new EntityCache<Row>('food_items');
    await cache.put({ id: 1, name: 'Arroz' });
    await cache.remove(1);
    expect(cache.getAll()).toStrictEqual([]);
    expect(await getAll<Row>('food_items')).toStrictEqual([]);
  });

  it('remapId() moves a record from a negative local id to the real server id', async () => {
    const cache = new EntityCache<Row>('food_items');
    await cache.put({ id: -3, name: 'Feijão' });
    await cache.remapId(-3, 42);
    expect(cache.get(-3)).toBeUndefined();
    expect(cache.get(42)).toStrictEqual({ id: 42, name: 'Feijão' });
    expect(await getAll<Row>('food_items')).toStrictEqual([{ id: 42, name: 'Feijão' }]);
  });

  it('upsertMany() writes by id and never touches a record outside the batch (never clear())', async () => {
    const cache = new EntityCache<Row>('food_items');
    await cache.put({ id: 1, name: 'Arroz' });
    await cache.upsertMany([{ id: 1, name: 'Arroz integral' }, { id: 2, name: 'Feijão' }]);
    expect(cache.getAll().sort((a, b) => a.id - b.id)).toStrictEqual([
      { id: 1, name: 'Arroz integral' },
      { id: 2, name: 'Feijão' },
    ]);
  });

  it('replaceWindow() replaces only what `keep` accepts, leaving the rest untouched', async () => {
    const cache = new EntityCache<Row>('food_items');
    await cache.put({ id: 1, name: 'dentro-da-janela-antigo' });
    await cache.put({ id: 2, name: 'fora-da-janela' });

    // `keep(item)` marks id 1 as inside the window — everything inside it is
    // wholesale replaced by the new payload, so id 1 (missing from that
    // payload) disappears with no tombstone, exactly like a server-side
    // delete inside the window. Id 2, outside the window, is never touched.
    await cache.replaceWindow([{ id: 3, name: 'dentro-da-janela-novo' }], (item) => item.id === 1);

    expect(cache.getAll().sort((a, b) => a.id - b.id)).toStrictEqual([
      { id: 2, name: 'fora-da-janela' },
      { id: 3, name: 'dentro-da-janela-novo' },
    ]);
  });

  it('replaceAll() drops anything missing from the new payload (whole-collection pull)', async () => {
    const cache = new EntityCache<Row>('food_items');
    await cache.put({ id: 1, name: 'Arroz' });
    await cache.put({ id: 2, name: 'Feijão' });
    await cache.replaceAll([{ id: 2, name: 'Feijão' }]);
    expect(cache.getAll()).toStrictEqual([{ id: 2, name: 'Feijão' }]);
  });

  it('getSnapshot() returns the same array reference until the next write (no useSyncExternalStore infinite loop)', async () => {
    const cache = new EntityCache<Row>('food_items');
    await cache.put({ id: 1, name: 'Arroz' });
    const first = cache.getSnapshot();
    const second = cache.getSnapshot();
    expect(first).toBe(second);
    await cache.put({ id: 2, name: 'Feijão' });
    const third = cache.getSnapshot();
    expect(third).not.toBe(second);
  });
});
