// Compare the renderer's source, never DOM modified by storage-image hydration.
export function installStableHtml(Alpine) {
  Alpine.directive('stable-html', (el, { expression }, { effect, evaluateLater }) => {
    const evaluate = evaluateLater(expression);
    let source;
    effect(() => evaluate((value) => {
      const next = String(value ?? '');
      if (next === source) return;
      source = next;
      Alpine.mutateDom(() => {
        [...el.children].forEach((child) => Alpine.destroyTree(child));
        el.innerHTML = next;
        el._x_ignoreSelf = true;
        Alpine.initTree(el);
        delete el._x_ignoreSelf;
      });
    }));
  });
}
