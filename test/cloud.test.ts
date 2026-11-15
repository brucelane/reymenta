import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { clientUrl, parseConnectionString, phoneRoles, signJwt } from '../src/cloud/wps';

const CS = 'Endpoint=https://example.webpubsub.azure.com;AccessKey=c2VjcmV0LWtleQ==;Version=1.0;';

test('connection string', () => {
  assert.deepEqual(parseConnectionString(CS), { endpoint: 'https://example.webpubsub.azure.com', key: 'c2VjcmV0LWtleQ==' });
  assert.equal(parseConnectionString('nothing'), undefined);
});

test('JWT is HS256 over header.payload with the access key', () => {
  const jwt = signJwt({ sub: 'x' }, 'k');
  const [h, p, s] = jwt.split('.');
  const expected = createHmac('sha256', 'k').update(`${h}.${p}`).digest('base64url');
  assert.equal(s, expected);
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url').toString()), { sub: 'x' });
});

test('phone URL: hub reymenta, its id, only its room groups', () => {
  const ps = parseConnectionString(CS)!;
  const url = new URL(clientUrl(ps, 'phone-12345678', phoneRoles('demo')));
  assert.equal(url.protocol, 'wss:');
  assert.equal(url.pathname, '/client/hubs/reymenta');
  const claims = JSON.parse(Buffer.from(url.searchParams.get('access_token')!.split('.')[1], 'base64url').toString());
  assert.equal(claims.sub, 'phone-12345678');
  assert.equal(claims.aud, 'https://example.webpubsub.azure.com/client/hubs/reymenta');
  assert.deepEqual(claims.role, ['webpubsub.sendToGroup.in-demo', 'webpubsub.joinLeaveGroup.out-demo']);
  assert.ok(claims.exp - claims.iat === 3 * 3600);
});
