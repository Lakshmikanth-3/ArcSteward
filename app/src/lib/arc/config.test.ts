import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usdcAmount, displayUsdc, network, GAS_DECIMALS, USDC_DECIMALS } from './config';
test('six-decimal payment parsing never rounds excess precision', () => {
  assert.equal(usdcAmount('0.01'), 10000n);
  assert.equal(usdcAmount('12345678901234567890.123456'), 12345678901234567890123456n);
  assert.equal(displayUsdc(10000n), '0.01');
  for (const input of ['0', '-1', '1e6', '0.0000001', '1.2345678', 'NaN', ' 1', '1,000']) assert.throws(() => usdcAmount(input));
  assert.equal(GAS_DECIMALS, 18); assert.equal(USDC_DECIMALS, 6);
  assert.equal(network().id, 5042); assert.equal(network('testnet').id, 5042002);
  assert.throws(() => network('base'));
});
