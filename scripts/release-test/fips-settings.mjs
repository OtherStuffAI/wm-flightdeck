import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { meshExec } from './fips-mesh.mjs';
import { waitFor, privateJson } from './stack.mjs';

export async function verifyFipsSettings(config) {
  // NIP-07 test extension signs only the normal login challenge inside the
  // disposable container. No private key leaves it or enters a browser profile.
  const pubkey = await meshExec(config, 'autopilot', ['bun', 'scripts/isolated-test/ui-signer.ts', 'public']);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.exposeBinding('isolatedLoginSignature', (_, event) => {
      const result = spawnSync('docker', ['compose', '--project-name', config.runId, '-f', path.join(config.runDir, 'compose.json'),
        'exec', '-T', 'autopilot', 'bun', 'scripts/isolated-test/ui-signer.ts', 'sign'], {
        env: config.dockerEnv, input: JSON.stringify(event), encoding: 'utf8', timeout: 15000,
      });
      if (result.status !== 0) throw new Error('Disposable administrator login signing failed');
      return JSON.parse(result.stdout);
    });
    await context.addInitScript(publicKey => { window.nostr = { getPublicKey: async () => publicKey,
      signEvent: event => window.isolatedLoginSignature(event) }; }, pubkey);
    const page = await context.newPage();
    await page.goto(`${config.runtimeUrl}/settings/automation/workspaces`);
    await page.getByRole('button', { name: 'Log In', exact: true }).click();
    await page.getByText('Browser Extension', { exact: true }).click();
    await page.locator('[data-action="nip07-login"]').click();
    await waitFor(async () => !(await page.getByRole('button', { name: 'Log In', exact: true }).count()), 'normal UI login completed');
    await page.goto(`${config.runtimeUrl}/settings/automation/workspaces`);
    const card = page.getByTestId('tower-transport-settings');
    await card.waitFor();
    assert.equal(await card.getByTestId('tower-transport-mode').inputValue(), 'fips');
    assert.equal(await card.getByTestId('tower-transport-httpsEndpoint').inputValue(), '');
    const tested = page.waitForResponse(response => response.url().endsWith('/transport/test'));
    await card.getByTestId('tower-transport-test').click();
    assert.equal((await tested).status(), 200);
    await waitFor(async () => (await card.getByTestId('tower-transport-status').textContent()).includes('Effective: fips')
      && await card.getByTestId('tower-transport-test').isEnabled(), 'settings test connection completed');
    const endpoint = card.getByTestId('tower-transport-fipsEndpoint');
    const saved = await endpoint.inputValue();
    const draft = saved + '/';
    await endpoint.fill(draft);
    await page.getByTestId('workspace-refresh').click();
    await waitFor(async () => await endpoint.inputValue() === draft, 'draft survives settings refresh');
    await page.reload();
    await card.waitFor();
    assert.equal(await endpoint.inputValue(), draft, 'Draft was lost across page reload');
    await endpoint.fill(saved);
    const applied = page.waitForResponse(response => response.url().endsWith('/transport') && response.request().method() === 'POST');
    await card.getByTestId('tower-transport-apply').click();
    assert.equal((await applied).status(), 200);
    await waitFor(async () => await card.getByTestId('tower-transport-apply').isEnabled(), 'settings apply completed');
    const screenshot = path.join(config.runDir, 'tower-fips-settings.png');
    await card.waitFor();
    await page.screenshot({ path: screenshot });
    privateJson(path.join(config.runDir, 'tower-fips-settings.json'), { passed: true, selected: 'fips',
      testConnection: true, draftRefreshAndReload: true, controlsReenabled: true, screenshot });
  } finally { await browser.close(); }
}
