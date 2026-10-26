#!/usr/bin/env node
/**
 * AICTE Nexus — prod smoke test harness.
 *
 * Hits the deployed Vercel URL on a few representative paths and asserts
 * on status + basic HTML shape. No secrets required.
 */
const TARGET = process.env.TARGET_URL;
if (!TARGET) {
  console.error('Usage: TARGET_URL=... node scripts/smoke-prod.mjs');
  process.exit(2);
}

async function get(path) {
  const res = await fetch(new URL(path, TARGET), {
    headers: { Accept: 'text/html' },
  });
  return { status: res.status, text: await res.text() };
}

function hasTitle(html, label) {
  return html.includes(`<title>${label}`);
}

async function run() {
  const tests = [
    { path: '/', expectTitle: 'AICTE Nexus', expectStatus: 200 },
    { path: '/login', expectTitle: 'AICTE Nexus', expectStatus: 200 },
    { path: '/search', expectTitle: 'Search · AICTE Nexus', expectStatus: 200 },
  ];
  let failures = 0;
  for (const t of tests) {
    const { status, text } = await get(t.path);
    const okStatus = status === t.expectStatus;
    const okBody = text.length > 500 && hasTitle(text, t.expectTitle);
    if (!okStatus || !okBody) {
      failures++;
      console.error(`FAIL ${t.path}: status=${status} (want ${t.expectStatus}), bodyLen=${text.length}, titleOk=${okBody}`);
    } else {
      console.log(`OK   ${t.path}`);
    }
  }
  if (failures > 0) {
    console.error(`Smoke test failed: ${failures} failing route(s)`);
    process.exit(1);
  }
  console.log('Smoke test passed for all routes.');
}

run().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(3);
});
