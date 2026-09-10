// Generic editor state shaped like a short timeline pasted from a rich editor.
const text = (value, marks = []) => ({ type: 'text', text: value, marks });
const paragraph = (value) => ({ type: 'paragraph', content: [text(value)] });

export function shortRichDocumentFixture() {
  return { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [text('Phase 1: Preparation\u00a0')] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [paragraph('Gather feedback and improve the guide.\u00a0')] },
      { type: 'listItem', content: [
        paragraph('Check the sample workflow.\t'),
        paragraph('Keep the continuation paragraph.'),
        { type: 'orderedList', attrs: { start: 10 }, content: [
          { type: 'listItem', content: [paragraph('Read the guide.'), paragraph('Record the result.')] },
        ] },
        paragraph('Retain the conclusion after the nested list.'),
      ] },
    ] },
    { type: 'paragraph', content: [text('Deliverables:\u00a0', [{ type: 'bold' }])] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [paragraph('Publish the example and its documentation.')] },
      { type: 'listItem', content: [
        { type: 'paragraph' },
        { type: 'bulletList', content: [
          { type: 'listItem', content: [paragraph('Keep a nested item under an empty parent.')] },
        ] },
      ] },
    ] },
  ] };
}
