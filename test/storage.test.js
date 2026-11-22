'use strict';
const wt = require('../src');
const { querySummary } = require('../src/storage');

let clock = 1000;
const tick = (ms) => { clock += ms; };

function start() {
  const sent = [];
  const fetch = jest.fn((url, init) => { sent.push(JSON.parse(init.body)); return Promise.resolve({ ok: true, status: 202 }); });
  wt.init({ key: 'wtp_test_not_real', service: 'app', endpoint: 'http://edge:4318/', native: null, fetch, captureErrors: false, network: false, stalls: false });
  return async () => { await wt.flush(); return sent.flatMap((b) => b.events); };
}

beforeEach(() => { jest.spyOn(Date, 'now').mockImplementation(() => clock); });
afterEach(() => { wt.close(); jest.restoreAllMocks(); });

test('query summary keeps operation and table, never values', () => {
  expect(querySummary("SELECT * FROM users WHERE email = 'a@b'")).toEqual({ operation: 'SELECT', collection: 'users' });
  expect(querySummary(42)).toEqual({ operation: 'QUERY', collection: undefined });
});

test('sync sqlite calls over one frame are flagged as JS-thread work; fast ones are not sent', async () => {
  const events = start();
  const db = wt.instrumentSQLite({
    executeSync: (sql) => { tick(sql.includes('big') ? 30 : 2); return { rows: [] }; },
    execute: async () => { tick(150); return { rows: [] }; },
  }, { name: 'app.db' });
  db.executeSync('SELECT 1 FROM small');
  db.executeSync("SELECT * FROM big WHERE id = 'secret'");
  await db.execute('INSERT INTO orders VALUES (?)', [1]);
  const out = (await events()).filter((e) => e.type === 'db');
  expect(out.map((e) => [e.name, e.value, e.attrs['db.main_thread']])).toEqual([['SELECT big', 30, true], ['INSERT orders', 150, undefined]]);
  expect(out[0].attrs).toMatchObject({ 'db.system.name': 'sqlite', 'db.namespace': 'app.db', 'db.operation.name': 'SELECT', 'db.collection.name': 'big' });
  expect(JSON.stringify(out)).not.toContain('secret');
});

test('failures are always reported with the error code and rethrown', async () => {
  const events = start();
  const storage = wt.instrumentAsyncStorage({ setItem: () => Promise.reject(Object.assign(new Error('full'), { code: 'E_FULL' })) });
  await expect(storage.setItem('k', 'v')).rejects.toThrow('full');
  const realm = wt.instrumentRealm({ path: '/data/user/0/app/files/default.realm', write: () => { throw new TypeError('bad'); } });
  expect(() => realm.write(() => {})).toThrow('bad');
  const out = (await events()).filter((e) => e.type === 'db');
  expect(out.map((e) => [e.attrs['db.system.name'], e.attrs['error.type'], e.attrs['db.namespace']])).toEqual([
    ['asyncstorage', 'E_FULL', undefined], ['realm', 'TypeError', 'default.realm'],
  ]);
});

test('mmkv size, watermelon tables, and no double wrapping', async () => {
  const events = start();
  const mmkv = { id: 'prefs', size: 4096, getString: () => { tick(20); return 'x'; } };
  wt.instrumentMMKV(mmkv);
  wt.instrumentMMKV(mmkv);
  mmkv.getString('k');
  const database = wt.instrumentWatermelon({ adapter: { query: async (q) => { tick(200); return [q]; } } });
  await database.adapter.query({ table: 'tasks' });
  const all = await events();
  expect(all.filter((e) => e.type === 'storage').map((e) => [e.name, e.value, e.attrs['db.namespace']])).toEqual([
    ['wt.embedded.file_size', 4096, 'prefs'], ['wt.embedded.file_size', 4096, 'prefs'],
  ]);
  expect(all.filter((e) => e.type === 'db').map((e) => e.name)).toEqual(['getString', 'query tasks']);
});

test('without init the wrappers only pass through', () => {
  const db = wt.instrumentSQLite({ executeSync: () => 7 });
  expect(db.executeSync('SELECT 1')).toBe(7);
});
