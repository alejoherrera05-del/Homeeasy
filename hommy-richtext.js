(() => {
  'use strict';

  function appendInline(target, value) {
    const text = String(value || '');
    const pattern = /\*\*(.+?)\*\*/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) target.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      const strong = document.createElement('strong');
      strong.textContent = match[1];
      target.appendChild(strong);
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) target.appendChild(document.createTextNode(text.slice(cursor)));
  }

  function renderMessage(node) {
    if (!(node instanceof HTMLElement) || node.dataset.richTextDone === 'true') return;
    node.dataset.richTextDone = 'true';
    const source = node.textContent || '';
    if (!source.includes('\n') && !source.includes('**')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'assistant-copy';
    const lines = source.replace(/\r/g, '').split('\n');
    let activeList = null;
    let activeType = '';

    function resetList() {
      activeList = null;
      activeType = '';
    }

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        resetList();
        continue;
      }

      const numbered = line.match(/^\d+[.)]\s+(.+)$/);
      const bullet = line.match(/^[-•]\s+(.+)$/);
      if (numbered || bullet) {
        const type = numbered ? 'ol' : 'ul';
        if (!activeList || activeType !== type) {
          activeList = document.createElement(type);
          activeType = type;
          wrapper.appendChild(activeList);
        }
        const item = document.createElement('li');
        appendInline(item, (numbered || bullet)[1]);
        activeList.appendChild(item);
        continue;
      }

      resetList();
      const paragraph = document.createElement('p');
      appendInline(paragraph, line);
      wrapper.appendChild(paragraph);
    }

    node.replaceChildren(wrapper);
  }

  function scan(root = document) {
    root.querySelectorAll?.('.message-row.assistant .message-text').forEach(renderMessage);
  }

  scan();
  const conversation = document.getElementById('conversation');
  if (!conversation) return;
  new MutationObserver(records => {
    for (const record of records) {
      for (const added of record.addedNodes) {
        if (!(added instanceof HTMLElement)) continue;
        if (added.matches?.('.message-row.assistant')) scan(added.parentElement || conversation);
        else scan(added);
      }
    }
  }).observe(conversation, { childList: true, subtree: true });
})();
