const feedbackTimers = new WeakMap();

async function writeClipboardText(text, documentRef) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = documentRef.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  documentRef.body.appendChild(textarea);
  textarea.select();
  const copied = documentRef.execCommand?.('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard API unavailable');
}

export function setCodeCopyFeedback(button, state, resetAfterMs = 1800) {
  const label = button?.querySelector('.md-code-copy-label');
  const status = button?.querySelector('.md-code-copy-status');
  if (!button || !label || !status) return;

  const previousTimer = feedbackTimers.get(button);
  if (previousTimer) clearTimeout(previousTimer);

  const succeeded = state === 'copied';
  const message = succeeded ? 'Copied' : 'Copy failed';
  button.dataset.copyState = state;
  button.setAttribute('aria-label', succeeded ? 'Code copied to clipboard' : 'Could not copy code');
  label.textContent = message;
  status.textContent = message;

  const timer = setTimeout(() => {
    delete button.dataset.copyState;
    button.setAttribute('aria-label', 'Copy code to clipboard');
    label.textContent = 'Copy';
    status.textContent = '';
    feedbackTimers.delete(button);
  }, resetAfterMs);
  feedbackTimers.set(button, timer);
}

export async function copyCodeBlock(button, documentRef = document) {
  const code = button?.closest('.md-code-block')?.querySelector('.md-code-scroll code');
  if (!code) return false;
  try {
    await writeClipboardText(code.textContent || '', documentRef);
    setCodeCopyFeedback(button, 'copied');
    return true;
  } catch {
    setCodeCopyFeedback(button, 'failed');
    return false;
  }
}

export function initMarkdownCodeBlocks(documentRef = document) {
  if (!documentRef?.addEventListener) return () => {};
  const onClick = (event) => {
    const button = event.target?.closest?.('[data-md-code-copy]');
    if (!button) return;
    event.preventDefault();
    void copyCodeBlock(button, documentRef);
  };
  documentRef.addEventListener('click', onClick);
  return () => documentRef.removeEventListener('click', onClick);
}
