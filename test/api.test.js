const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../db');
const { createApp } = require('../server');

let server, base;
before(async () => {
  server = createApp(openDb(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

test('full secret santa flow', async () => {
  const [a, b, c] = [client(), client(), client()];
  assert.equal((await a('GET', '/api/auth/me')).status, 401);

  const ra = await a('POST', '/api/auth/register', { name: 'Alice', email: 'alice@x.com', password: 'secret1' });
  assert.equal(ra.status, 200);
  await b('POST', '/api/auth/register', { name: 'Bob', email: 'bob@x.com', password: 'secret1' });
  await c('POST', '/api/auth/register', { name: 'Cara', email: 'cara@x.com', password: 'secret1' });
  assert.equal((await c('POST', '/api/auth/register', { name: 'X', email: 'ALICE@x.com', password: 'secret1' })).status, 409);

  // login with a fresh client
  const a2 = client();
  assert.equal((await a2('POST', '/api/auth/login', { email: 'alice@x.com', password: 'nope' })).status, 401);
  assert.equal((await a2('POST', '/api/auth/login', { email: 'Alice@x.com', password: 'secret1' })).status, 200);

  const { family } = (await a('POST', '/api/families', { name: 'The Smiths' })).body;
  assert.match(family.code, /^[A-Z0-9]{6}$/);
  assert.equal(family.memberCount, 1);
  assert.equal((await b('POST', '/api/families/join', { code: 'nope00' })).status, 404);
  assert.equal((await b('GET', `/api/families/${family.id}`)).status, 403);
  await b('POST', '/api/families/join', { code: family.code.toLowerCase() });
  await c('POST', '/api/families/join', { code: family.code });

  const detail = (await b('GET', `/api/families/${family.id}`)).body.family;
  assert.deepEqual(detail.members.map((m) => m.name), ['Alice', 'Bob', 'Cara']);
  const [alice, bob] = detail.members;

  // present profile + secret suggestions
  await a('POST', '/api/presents', { itemName: 'Socks', cost: '5.50', link: 'example.com/socks' });
  const mine = (await a('GET', '/api/presents/mine')).body.ideas;
  assert.equal(mine[0].link, 'https://example.com/socks');
  assert.equal(mine[0].cost, 5.5);
  assert.equal((await b('PUT', `/api/presents/${mine[0].id}`, { itemName: 'hack' })).status, 403);

  await b('POST', `/api/families/${family.id}/members/${alice.id}/suggestions`, { itemName: 'Secret book' });
  assert.equal((await a('GET', `/api/families/${family.id}/members/${alice.id}`)).status, 403);
  assert.equal((await a('POST', `/api/families/${family.id}/members/${alice.id}/suggestions`, { itemName: 'x' })).status, 403);
  const viewByCara = (await c('GET', `/api/families/${family.id}/members/${alice.id}`)).body;
  assert.equal(viewByCara.ideas.length, 1);
  assert.equal(viewByCara.suggestions[0].suggestedBy.name, 'Bob');
  // Alice's own profile never includes the secret suggestion
  assert.equal((await a('GET', '/api/presents/mine')).body.ideas.length, 1);

  // before arranging
  assert.equal((await a('GET', `/api/families/${family.id}/assignment`)).body.recipient, null);

  // arrange: a valid derangement, repeated to catch randomness issues
  for (let run = 0; run < 20; run++) {
    assert.equal((await c('POST', `/api/families/${family.id}/arrange`)).status, 200);
    const recips = await Promise.all([a, b, c].map(async (cl) => (await cl('GET', `/api/families/${family.id}/assignment`)).body));
    const ids = recips.map((r) => r.recipient.id);
    assert.equal(new Set(ids).size, 3, 'everyone receives exactly once');
    detail.members.forEach((m, i) => assert.notEqual(ids[i], m.id, 'nobody draws themself'));
    const forAlice = recips.find((r) => r.recipient.id === alice.id);
    assert.equal(forAlice.ideas[0].itemName, 'Socks');
    assert.equal(forAlice.suggestions[0].itemName, 'Secret book');
  }
  assert.equal((await a('GET', `/api/families/${family.id}`)).body.family.allocated, true);

  // solo family can't arrange
  const solo = (await b('POST', '/api/families', { name: 'Solo' })).body.family;
  assert.equal((await b('POST', `/api/families/${solo.id}/arrange`)).status, 400);
  assert.equal((await b('GET', '/api/families')).body.families.length, 2);

  await a('POST', '/api/auth/logout');
  assert.equal((await a('GET', '/api/auth/me')).status, 401);
});
