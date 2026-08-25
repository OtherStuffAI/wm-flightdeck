import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

const mobileMedia = styles.slice(styles.indexOf('@media (max-width: 768px)'));
const mobileSelectorStart = html.indexOf('class="mobile-scope-switcher"');
const mobileSelectorEnd = html.indexOf('<section class="auth-panel"', mobileSelectorStart);
const mobileSelector = html.slice(mobileSelectorStart, mobileSelectorEnd);
const globalBarStart = html.indexOf('class="global-pg-channel-bar"');
const globalBarEnd = html.indexOf('<div class="content-scroll-area"', globalBarStart);
const globalBar = html.slice(globalBarStart, globalBarEnd);

describe('mobile expanded-sidebar section switcher', () => {
  it('preserves the collapsed scope row and compact section switcher', () => {
    expect(mobileSelector).toContain('class="mobile-scope-context-controls"');
    expect(mobileSelector).toContain('x-show="!$store.chat.mobileNavOpen"');
    expect(mobileSelector).toContain('class="mobile-scope-trigger"');
    expect(mobileSelector).toContain('class="mobile-scope-workspace-avatar-btn"');
    expect(mobileSelector).toContain('@click="$store.chat.selectWorkContextScope(board.id, $event); open = false"');

    expect(globalBar).toContain('class="chat-channel-header"');
    expect(globalBar).toContain('class="mobile-section-switcher"');
    expect(globalBar).toContain('x-show="!$store.chat.mobileNavOpen"');
    expect(globalBar).toContain("navigateTo('status')");
    expect(globalBar).toContain("navigateTo('chat')");
    expect(globalBar).toContain("navigateTo('tasks')");
    expect(globalBar).toContain("navigateTo('docs')");
  });

  it('replaces mobile scope and channel controls with labelled section controls while expanded', () => {
    expect(mobileSelector).toContain('class="mobile-expanded-section-switcher"');
    expect(mobileSelector).toContain('x-show="$store.chat.mobileNavOpen"');
    expect(mobileSelector).toContain('aria-label="Flight Deck sections"');

    for (const [section, label] of [
      ['status', 'Deck'],
      ['chat', 'Chat'],
      ['tasks', 'Tasks'],
      ['docs', 'Docs'],
      ['files', 'Files'],
    ]) {
      expect(mobileSelector).toContain(`navigateTo('${section}')`);
      expect(mobileSelector).toContain(`$store.chat.navSection === '${section}' ? 'page' : null`);
      expect(mobileSelector).toMatch(new RegExp(`>${label}<\\/span>`));
    }

    expect(mobileSelector.match(/class="mobile-expanded-section-icon"/g)).toHaveLength(5);
    expect(globalBar).toContain("'global-pg-channel-bar-mobile-sidebar-open': $store.chat.mobileNavOpen");
    expect(mobileMedia).toMatch(/\.global-pg-channel-bar\.global-pg-channel-bar-mobile-sidebar-open\s*\{[^}]*display:\s*none;/s);
  });

  it('removes the duplicate drawer section row without leaving layout space', () => {
    expect(mobileMedia).toMatch(/\.sidebar\.sidebar-mobile-open \.sidebar-nav\s*\{[^}]*display:\s*none;/s);
    expect(mobileMedia).toMatch(/\.mobile-expanded-section-switcher\s*\{[^}]*overflow-x:\s*auto;[^}]*touch-action:\s*pan-x;/s);
    expect(mobileMedia).toMatch(/\.mobile-expanded-section-switcher-btn\s*\{[^}]*min-height:\s*44px;/s);
    expect(mobileMedia).toMatch(/\.mobile-expanded-section-switcher-btn:focus-visible\s*\{[^}]*outline:\s*2px solid #2563eb;/s);
  });

  it('restores the collapsed arrangement when section selection closes the drawer', () => {
    const navigateTo = app.slice(app.indexOf('navigateTo(section, options = {})'), app.indexOf('toggleSettings()', app.indexOf('navigateTo(section, options = {})')));

    expect(mobileSelector).toContain('x-show="!$store.chat.mobileNavOpen"');
    expect(mobileSelector).toContain('x-show="$store.chat.mobileNavOpen"');
    expect(globalBar).toContain('x-show="!$store.chat.mobileNavOpen"');
    expect(navigateTo).toContain('this.mobileNavOpen = false;');
  });
});
