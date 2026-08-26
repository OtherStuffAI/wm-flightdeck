const TARGET_LENGTH = 26_706;

export function buildSyntheticLongDocumentFixture() {
  const sections = Array.from({ length: 18 }, (_, sectionIndex) => {
    const section = sectionIndex + 1;
    return [
      `## Interview evidence ${section}`,
      '',
      `The synthetic interview record ${section} keeps detailed context, decisions, constraints, and follow-up evidence together so a long editor session exercises realistic paragraph boundaries.`,
      '',
      `1. **Uncertainty:** Validate assumption ${section} without losing punctuation.`,
      `2. **Implementation:** Preserve the complete evidence chain for workstream ${section}.`,
      `3. **Outcome:** Keep the final recommendation and its supporting link [reference ${section}](https://example.com/evidence/${section}).`,
      '',
      `> Review note ${section}: the later delivery plan must remain reachable after every save and reload.`,
    ].join('\n');
  }).join('\n\n');

  const timeline = [
    '## 12-month implementation timeline',
    '',
    ...Array.from({ length: 12 }, (_, index) => (
      `- **Month ${index + 1}:** Deliver milestone ${index + 1}, retain its acceptance evidence, and confirm the document tail remains intact.`
    )),
    '',
    'TAIL_SENTINEL: synthetic-long-document-complete',
  ].join('\n');
  const appendixHeading = '\n\n## Detailed evidence appendix\n\n';
  const fixedLength = sections.length + appendixHeading.length + 2 + timeline.length;
  const fillerLength = TARGET_LENGTH - fixedLength;
  if (fillerLength < 1) throw new Error('Synthetic long-document fixture exceeded its target length.');
  const fillerSeed = 'Representative evidence remains explicit, reviewable, and stable across editor serialization. ';
  const filler = fillerSeed.repeat(Math.ceil(fillerLength / fillerSeed.length)).slice(0, fillerLength);
  const document = `${sections}${appendixHeading}${filler}\n\n${timeline}`;
  if (document.length !== TARGET_LENGTH) throw new Error('Synthetic long-document fixture length drifted.');
  return document;
}

export const SYNTHETIC_LONG_DOCUMENT_LENGTH = TARGET_LENGTH;
