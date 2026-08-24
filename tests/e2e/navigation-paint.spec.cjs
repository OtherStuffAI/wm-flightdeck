const { test, expect } = require('playwright/test');

test('destination state reaches the paint boundary before expensive work', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/navigation-paint.html');
  await page.waitForFunction(() => Boolean(window.harnessResult));
  const result = await page.evaluate(() => window.harnessResult);
  expect(result.text).toBe('destination');
  expect(result.events.map((event) => event.name)).toEqual([
    'assigned',
    'paint-boundary',
    'expensive-end',
  ]);
  expect(result.events[1].at).toBeGreaterThan(result.events[0].at);
  expect(result.events[2].at - result.events[1].at).toBeGreaterThanOrEqual(75);
  console.log(JSON.stringify({
    assignmentToPaintMs: result.events[1].at - result.events[0].at,
    expensiveWorkMs: result.events[2].at - result.events[1].at,
  }));
});
