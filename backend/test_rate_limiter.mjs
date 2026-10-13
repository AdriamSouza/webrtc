import { User } from './src/users/user.js';
import { config } from './src/config/config.js';

console.log('--- TEST 1: Token Bucket Rate Limiter Verification ---');
console.log('Config rate limit:', config.rateLimit);

const mockWs = { send: () => {} };
const user = new User('test-user-1', mockWs, 'Tester');

let accepted = 0;
let rejected = 0;

// Test burst of 150 messages simultaneously
for (let i = 0; i < 150; i++) {
  if (user.checkRateLimit()) {
    accepted++;
  } else {
    rejected++;
  }
}

console.log(`Sent 150 messages in immediate burst: accepted=${accepted}, rejected=${rejected}`);

if (accepted === 150 && rejected === 0) {
  console.log('✅ PASS: Burst of 150 messages successfully absorbed without RATE_LIMIT_EXCEEDED error!');
} else {
  console.error('❌ FAIL: Burst of 150 messages was not accepted properly.');
  process.exit(1);
}

// Test exceeding capacity (burst capacity is 160)
// Now we send another 30 messages immediately without refill
for (let i = 0; i < 30; i++) {
  if (user.checkRateLimit()) {
    accepted++;
  } else {
    rejected++;
  }
}
console.log(`After +30 messages (total 180): total accepted=${accepted}, rejected=${rejected}`);
if (rejected > 0) {
  console.log(`✅ PASS: Token bucket correctly throttles beyond capacity (${rejected} rejected).`);
} else {
  console.error('❌ FAIL: Token bucket did not throttle when capacity exceeded.');
  process.exit(1);
}

// Test refill after 600ms
await new Promise(r => setTimeout(r, 600));
let refilledAccepted = 0;
for (let i = 0; i < 30; i++) {
  if (user.checkRateLimit()) {
    refilledAccepted++;
  }
}
console.log(`After 600ms refill (expected ~36 tokens refilled): accepted=${refilledAccepted}`);
if (refilledAccepted >= 30) {
  console.log('✅ PASS: Token bucket successfully refilled tokens over time.');
} else {
  console.error('❌ FAIL: Token bucket failed to refill.');
  process.exit(1);
}

console.log('\n--- ALL RATE LIMITER TESTS PASSED! ---');
