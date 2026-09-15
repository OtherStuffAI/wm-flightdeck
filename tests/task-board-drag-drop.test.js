import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readProjectFile(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

describe('task board drag and drop', () => {
  it('keeps cards draggable outside manual sort mode', () => {
    const html = readProjectFile('index.html');

    expect(html).toContain(':draggable="col.state !== \'summary\'"');
    expect(html).not.toContain(':draggable="col.state !== \'summary\' && $store.chat.taskSortIsManual"');
    expect(html).toContain('@drop.prevent="col.state !== \'summary\' && $store.chat.handleTaskDrop($event, col.state)"');
  });

  it('moves task state directly when the visible sort is not manual', () => {
    const source = readProjectFile('src/app.js');
    const start = source.indexOf('async handleTaskDrop(e, targetState, targetTaskId = null, position = \'end\')');
    const end = source.indexOf('const reorderPatches = buildTaskBoardReorderPatches', start);
    const preamble = source.slice(start, end);

    expect(preamble).toContain('if (!this.taskSortIsManual)');
    expect(preamble).toContain('await this.applyTaskPatch(taskId, { state: targetState }');
    expect(preamble).toContain('backgroundPg: isTowerPgBackendMode()');
  });

  it('wraps and modestly reduces long task titles on constrained task surfaces', () => {
    const html = readProjectFile('index.html');
    const styles = readProjectFile('src/styles.css');
    const source = readProjectFile('src/app.js');

    expect(source).toContain('isLongTaskTitle(title) {');
    expect(source).toContain("return { 'task-title-long': this.isLongTaskTitle(title) };");
    expect(html.match(/getTaskTitleLengthClass/g)).toHaveLength(9);
    expect(html.match(/isLongTaskTitle/g)).toHaveLength(2);
    expect(styles).toMatch(/\.flightdeck-summary-card-task \.attention-card-title\s*\{[^}]*white-space:\s*normal;[^}]*overflow:\s*visible;[^}]*overflow-wrap:\s*anywhere;/s);
    expect(styles).toMatch(/\.flightdeck-summary-card-task \.attention-card-title\.task-title-long\s*\{[^}]*font-size:\s*0\.86rem;/s);
    expect(styles).toMatch(/\.flightdeck-summary-card-task\.task-title-long\s*\{[^}]*grid-template-columns:\s*2\.35rem minmax\(0, 1fr\);/s);
    expect(styles).toMatch(/\.flightdeck-summary-card-task\.task-title-long \.attention-card-meta\s*\{[^}]*grid-column:\s*2;[^}]*justify-content:\s*flex-start;/s);
    expect(styles).toMatch(/\.kanban-card-title\.task-title-long\s*\{[^}]*font-size:\s*0\.8rem;/s);
    expect(styles).toMatch(/\.task-list-title\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/s);
    expect(styles).toMatch(/\.task-detail-title-display\.task-title-long\s*\{[^}]*font-size:\s*1\.9rem;/s);
    expect(styles).toMatch(/@media \(max-width: 768px\)[\s\S]*\.task-detail-title-display\.task-title-long\s*\{[^}]*font-size:\s*1\.45rem;/s);
    expect(styles).toMatch(/\.subtask-title\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/s);
    expect(styles).toMatch(/\.task-parent-btn\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*text-align:\s*left;/s);
  });
});
