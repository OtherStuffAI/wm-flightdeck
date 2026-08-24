import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { globSync } from 'node:fs';
import { TOWER_WORKSPACE_COMMAND_NAMES } from '../src/tower-command-port.js';

const ROOT = new URL('../src/', import.meta.url).pathname;
const LOW_LEVEL = /from\s+['"]\.\/(?:api|pg-read-hydrator|sync-worker-client)\.js['"]/g;
const TEMPORARY_EXCEPTIONS = new Set([
  'audio-recording-manager.js',
  'channels-manager.js',
  'chat-message-manager.js',
  'connect-settings-manager.js',
  'docs-manager.js',
  'files-manager.js',
  'notifications-manager.js',
  'people-profiles-manager.js',
  'reactions-manager.js',
  'scopes-manager.js',
  'storage-image-manager.js',
  'sync-manager.js',
  'task-detail-manager.js',
  'workroom-creation-manager.js',
  'workroom-detail-manager.js',
  'workspace-manager.js',
]);

describe('Tower sync dependency boundary', () => {
  it('keeps PG read results on the Dexie side of the Alpine boundary', () => {
    const source = readFileSync(join(ROOT, 'pg-read-hydrator.js'), 'utf8');
    expect(source).not.toMatch(/store\??\.(?:apply|replace)[A-Z]/);
    expect(source).not.toMatch(/store\??\.patch(?:Message|Document)Local/);
    expect(source).not.toMatch(/store\??\.(?:scopes|channels|tasks|documents|messages|dailyNotes|workrooms|workroomParticipants|workroomEvents|workroomLinks|workroomApprovals|pgWorkspaceMembers|groups)\s*=/);
  });

  it('requires live-query consumers for every stage 2-5 materialised family', () => {
    const source = readFileSync(join(ROOT, 'section-live-queries.js'), 'utf8');
    for (const query of [
      'getWappsByOwner', 'getScopesByOwner', 'getChannelsByOwner', 'getGroupsByOwner',
      'getWorkspaceMembers', 'getDailyNotesByOwner', 'getTasksByOwner', 'getDocumentsByOwner',
      'getMessagesByChannel', 'getCommentsByTarget', 'getReactionsByTargets',
      'getWorkroomsByWorkspace', 'getWorkroomParticipants', 'getWorkroomEvents',
      'getWorkroomLinks', 'getPendingWorkroomApprovals',
    ]) expect(source).toContain(query);
  });

  it('prevents new UI managers from importing low-level Tower read primitives', () => {
    const violations = [];
    for (const file of globSync(join(ROOT, '*manager.js'))) {
      const name = basename(file);
      if (TEMPORARY_EXCEPTIONS.has(name)) continue;
      const imports = readFileSync(file, 'utf8').match(LOW_LEVEL) || [];
      if (imports.length) violations.push({ name, imports });
    }
    expect(violations).toEqual([]);
  });

  it('keeps migrated collection hydration out of UI managers', () => {
    const migratedHydrators = /hydrateTowerPg(?:Scopes|Channels|Tasks|DocumentsAndFiles|ChannelTasks|ChannelDocumentsAndFiles)/;
    const violations = [];
    for (const file of globSync(join(ROOT, '*manager.js'))) {
      if (basename(file) === 'sync-manager.js') continue;
      const source = readFileSync(file, 'utf8');
      if (migratedHydrators.test(source)) violations.push(basename(file));
    }
    expect(violations).toEqual([]);
  });

  it('keeps migrated detail hydration and reads out of UI managers', () => {
    const migratedReads = /(?:hydrateTowerPg(?:Task|TaskComments|Doc|DocComments|ChannelMessages|ThreadMessages|ReactionTarget|DailyNotes?|Workrooms?|WorkroomParticipants)|getTowerPg(?:ChannelMessages|ChannelThreads|TaskComments|DocComments|Reactions|DailyNotes|Workroom))/;
    const violations = [];
    for (const file of globSync(join(ROOT, '*manager.js'))) {
      if (basename(file) === 'sync-manager.js') continue;
      const source = readFileSync(file, 'utf8');
      if (migratedReads.test(source)) violations.push(basename(file));
    }
    expect(violations).toEqual([]);
  });

  it('keeps migrated PG write adapters behind the Tower command port', () => {
    const violations = [];
    for (const file of [join(ROOT, 'app.js'), ...globSync(join(ROOT, '*manager.js'))]) {
      const source = readFileSync(file, 'utf8');
      if (/from\s+['"]\.\/pg-write-adapter\.js['"]/.test(source)) violations.push(basename(file));
    }
    expect(violations).toEqual([]);
    expect(readFileSync(join(ROOT, 'tower-command-port.js'), 'utf8')).toContain("from './pg-write-adapter.js'");
  });

  it('keeps channel, scope, and workspace configuration commands behind service intents', () => {
    const migratedCommands = [
      'createTowerPgWorkspaceScope', 'updateTowerPgWorkspaceScope', 'deleteTowerPgWorkspaceScope',
      'createTowerPgScopeChannel', 'updateTowerPgChannel', 'deleteTowerPgChannel', 'reorderTowerPgChannel',
      'createTowerPgChannelGrant', 'updateTowerPgChannelGrant', 'deleteTowerPgChannelGrant',
      'createTowerPgWorkspaceMember', 'updateTowerPgWorkspaceMemberProfile', 'createTowerPgWorkspaceGroup',
      'addTowerPgWorkspaceGroupMember', 'removeTowerPgWorkspaceGroupMember',
      'addTowerPgWorkspaceChildGroup', 'removeTowerPgWorkspaceChildGroup',
      'updateTowerPgWorkspace', 'deleteTowerPgWorkspace', 'createTowerPgAdminWorkspace',
      'updateTowerPgNotificationPreferences', 'upsertTowerPgPushSubscription', 'revokeTowerPgPushSubscription',
    ];
    const violations = [];
    for (const file of [join(ROOT, 'app.js'), ...globSync(join(ROOT, '*.js'))]) {
      const source = readFileSync(file, 'utf8');
      const apiImports = [...source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/api\.js['"]/g)]
        .map((match) => match[1]);
      const commands = migratedCommands.filter((name) => apiImports.some((block) => new RegExp(`\\b${name}\\b`).test(block)));
      if (commands.length && basename(file) !== 'tower-command-port.js') violations.push({ file: basename(file), commands });
    }
    expect(violations).toEqual([]);
  });

  it('does not schedule a broad task-comment readback after a command succeeds', () => {
    const source = readFileSync(join(ROOT, 'task-detail-manager.js'), 'utf8');
    expect(source).not.toContain("scheduleTaskCommentsRefresh(taskId, 'PG task comment create')");
    expect(source).toContain("commandTowerWorkspace('task-comment.create'");
  });

  it('does not schedule broad channel or scope readbacks after migrated command success', () => {
    const channels = readFileSync(join(ROOT, 'channels-manager.js'), 'utf8');
    const scopes = readFileSync(join(ROOT, 'scopes-manager.js'), 'utf8');
    expect(channels).not.toContain("scheduleChannelsRefresh('PG channel metadata update')");
    expect(channels).not.toContain("scheduleChannelsRefresh('PG channel create')");
    expect(channels).not.toContain("scheduleChannelsRefresh('PG DM channel create')");
    expect(scopes).not.toContain('await this.requestTowerSyncFamily?.(\'scopes\', \'\', { force: true })');
  });

  it('enumerates every active command consumer in the service command contract', () => {
    const intents = readFileSync(join(ROOT, 'tower-command-intents.js'), 'utf8');
    const issued = [...intents.matchAll(/issue(?:TypedApi)?\(store,\s*['"]([^'"]+)['"]/g)]
      .map((match) => match[1]);
    if (intents.includes("'compatibility.pending-write'")) issued.push('compatibility.pending-write');
    expect([...new Set(issued)].sort()).toEqual([...TOWER_WORKSPACE_COMMAND_NAMES].sort());
    expect(new Set(TOWER_WORKSPACE_COMMAND_NAMES).size).toBe(TOWER_WORKSPACE_COMMAND_NAMES.length);
  });

  it('keeps active compatibility pending writes behind the service descriptor', () => {
    const violations = [];
    for (const file of [join(ROOT, 'app.js'), ...globSync(join(ROOT, '*manager.js'))]) {
      const source = readFileSync(file, 'utf8');
      if (/\baddPendingWrite\s*\(/.test(source)) violations.push(basename(file));
    }
    expect(violations).toEqual([]);
    expect(readFileSync(join(ROOT, 'tower-command-port.js'), 'utf8')).toContain("name === 'compatibility.pending-write'");
  });

  it('keeps residual typed PG metadata and resource-view commands behind service intents', () => {
    const migratedCommands = ['putTowerPgResourceViewState', 'updateTowerPgDoc', 'updateTowerPgFile'];
    const violations = [];
    for (const file of [join(ROOT, 'app.js'), ...globSync(join(ROOT, '*manager.js'))]) {
      const source = readFileSync(file, 'utf8');
      const apiImports = [...source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/api\.js['"]/g)].map((match) => match[1]);
      const commands = migratedCommands.filter((name) => apiImports.some((block) => new RegExp(`\\b${name}\\b`).test(block)));
      if (commands.length) violations.push({ file: basename(file), commands });
    }
    expect(violations).toEqual([]);
  });

  it('does not retain known broad post-write refresh seams', () => {
    const sources = ['app.js', 'docs-manager.js', 'files-manager.js', 'scopes-manager.js',
      'chat-message-manager.js', 'wapp-publishing-manager.js', 'workroom-creation-manager.js',
      'workroom-detail-manager.js'].map((file) => readFileSync(join(ROOT, file), 'utf8')).join('\n');
    for (const seam of [
      "scheduleTasksRefresh('PG task create", "scheduleTasksRefresh('PG task patch",
      "scheduleTasksRefresh('PG task save", "scheduleTasksRefresh('PG task background writes",
      "scheduleTasksRefresh('PG subtask create", "scheduleDocumentsRefresh?.('PG document save",
      "scheduleDocumentsRefresh?.('PG document scope move", "scheduleDocumentsRefresh?.('PG file edit",
      "scheduleChannelsRefresh?.('PG channel delete",
    ]) expect(sources).not.toContain(seam);
  });
});
