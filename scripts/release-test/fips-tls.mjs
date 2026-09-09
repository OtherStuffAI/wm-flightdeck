import fs from 'node:fs';
import path from 'node:path';
import { command } from './stack.mjs';

export async function addTrustedTowerTls(definition, { runDir, runId, dockerEnv }) {
  const dir = path.join(runDir, 'mesh-fixture');
  await command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-subj', '/CN=tower-tls', '-addext', 'subjectAltName=DNS:tower-tls',
    '-keyout', path.join(dir, 'tls.key'), '-out', path.join(dir, 'tls.crt')], { log: path.join(runDir, 'tls-generation.log') });
  fs.chmodSync(path.join(dir, 'tls.crt'), 0o644);
  fs.writeFileSync(path.join(dir, 'tls.ts'), `import { appendFileSync } from 'node:fs';
const server = Bun.serve({ port:3443, hostname:'0.0.0.0', idleTimeout:0,
  tls:{key:Bun.file('/fixture/tls.key'),cert:Bun.file('/fixture/tls.crt')},
  async fetch(request, server) {
    const url = new URL(request.url);
    appendFileSync('/mesh/tls-ingress.jsonl',JSON.stringify({at:new Date().toISOString(),source:server.requestIP(request)?.address,method:request.method,path:url.pathname})+'\\n');
    const headers = new Headers(request.headers);
    headers.set('x-forwarded-proto','https'); headers.set('x-forwarded-host','tower-tls:3443');
    return fetch('http://127.0.0.1:3100'+url.pathname+url.search,{
      method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,
      signal:request.signal,redirect:'manual',
    });
  }
});
`);
  definition.services['tower-tls'] = { image: `${runId}-autopilot`, user: 'root', network_mode: 'service:mesh-tower',
    command: ['bun', '/fixture/tls.ts'], volumes: [`${dir}:/fixture:ro`, 'mesh-tower:/mesh'],
    depends_on: { tower: { condition: 'service_healthy' } },
    healthcheck: { test: ['CMD', 'curl', '--fail', '--silent', '--cacert', '/fixture/tls.crt', 'https://tower-tls:3443/health'], interval: '3s', timeout: '3s', retries: 20 },
  };
  definition.services.autopilot.volumes.push(`${path.join(dir, 'tls.crt')}:/trust/tower-ca.crt:ro`);
  definition.services.autopilot.environment.NODE_EXTRA_CA_CERTS = '/trust/tower-ca.crt';
  definition.services.autopilot.environment.WAPP_TOWER_URL = 'https://tower-tls:3443';
}
