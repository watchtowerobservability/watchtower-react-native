'use strict';
const wt = require('../src');
const { feedbackBody } = require('../src/feedback');

const KEY = 'wtp_test_not_real';

afterEach(() => wt.close());

test('feedback body trims, cuts and links only a valid event id', () => {
  expect(feedbackBody({ message: '  broken  ', name: ' Ann ', email: '' }, '0A1B2C3D-0000-4000-8000-00000000000F'))
    .toEqual({ message: 'broken', name: 'Ann', event_id: '0a1b2c3d00004000800000000000000f' });
  expect(feedbackBody({ message: '   ' })).toBeNull();
  expect(feedbackBody({ message: 'x', eventId: 'nope' }).event_id).toBeUndefined();
  expect(feedbackBody({ message: 'a'.repeat(5000) }).message).toHaveLength(4096);
});

test('feedback posts to the edge linked to the last error and resolves the outcome', async () => {
  const sent = [];
  const fetch = jest.fn((url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true, status: 202 }); });
  wt.init({ key: KEY, service: 'shop', endpoint: 'http://edge:4318/', native: null, fetch, captureErrors: false, network: false, stalls: false, appId: 'com.example.shop' });
  wt.captureException(new Error('boom'));
  await expect(wt.feedback({ message: 'it broke' })).resolves.toBe(true);
  const fb = sent.find((s) => s.url === 'http://edge:4318/v1/rum/feedback');
  expect(fb.init.headers.Authorization).toBe(`Bearer ${KEY}`);
  expect(fb.init.headers['X-Watchtower-App-Id']).toBe('com.example.shop');
  expect(fb.init.headers.Origin).toBeUndefined();
  expect(fb.body.message).toBe('it broke');
  expect(fb.body.event_id).toMatch(/^[0-9a-f]{32}$/);
  await expect(wt.feedback({ message: '' })).resolves.toBe(false);
  fetch.mockImplementation(() => Promise.reject(new Error('offline')));
  await expect(wt.feedback({ message: 'again' })).resolves.toBe(false);
});
