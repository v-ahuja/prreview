(() => {
  const root = document.querySelector('.walkthrough');
  if (!root) return;
  const { data, options } = JSON.parse(document.getElementById('walkthrough-data').textContent);
  const $ = selector => root.querySelector(selector);
  const parts = [data.anchor, ...data.slices], count = data.slices.length;
  const key = `pr-walkthrough:${root.dataset.progressKey}`;
  const steps = [...root.querySelectorAll('.walkthrough-step')];
  const checkpoints = [...root.querySelectorAll('.checkpoint-button')];
  const split = new Set(), conversations = new Map(), codeCache = new Map();
  let current = 0, beat = 0, selection = '', contextLines = 0, snippetRequest = 0;
  const readStorage = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  const saved = Number(readStorage(key, '0'));
  if (Number.isInteger(saved) && saved >= 0 && saved <= count) current = saved;
  function endpoint(action) {
    const url = new URL(`${options.apiBase || ''}/${action}`, location.origin);
    if (options.query) url.search = options.query;
    return url;
  }
  async function request(action, input) {
    const response = await fetch(endpoint(action), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, csrf: options.csrf }) });
    const result = await response.json().catch(() => ({ error: 'The session expired or the server could not complete this request. Reload and try again.' }));
    if (!response.ok) throw new Error(result.error || 'Request failed. Try again.');
    return result;
  }
  window.walkthroughApi = {
    async code(file, side = 'head') {
      const id = `${file}:${side}`;
      if (!codeCache.has(id)) {
        const url = endpoint('code'); url.searchParams.set('file', file); url.searchParams.set('side', side);
        const pending = fetch(url).then(async response => {
          const result = await response.json().catch(() => ({ error: 'Unable to load the source. Please sign in again.' }));
          if (!response.ok) throw new Error(result.error || 'Unable to load the pinned source.');
          return result;
        }).catch(error => { codeCache.delete(id); throw error; });
        codeCache.set(id, pending);
      }
      return codeCache.get(id);
    }
  };
  const beats = part => part.beats?.length ? part.beats : [{ title: part.title, text: part.explanation, excerpt: part.excerpt, location: part.location }];
  function renderCode(text, start = null) {
    const fragment = document.createDocumentFragment();
    text.split('\n').forEach((line, i) => {
      const row = document.createElement('span');
      row.className = start !== null ? '' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'hunk' : '';
      const number = document.createElement('em'); number.className = 'diff-number'; number.textContent = start === null ? i + 1 : start + i;
      row.append(number, document.createTextNode(line || ' ')); fragment.append(row);
    });
    $('.linked-diff code').replaceChildren(fragment);
  }
  function focusBeat(index, focus = false) {
    const part = parts[current], linked = beats(part);
    beat = Math.max(0, Math.min(linked.length - 1, index));
    const active = linked[beat];
    for (const node of steps[current].querySelectorAll('.explanation-beat')) {
      node.classList.toggle('active-beat', Number(node.dataset.beat) === beat);
      node.hidden = split.has(current) && Number(node.dataset.beat) !== beat;
    }
    snippetRequest++; contextLines = 0;
    $('.current-file').textContent = part.file;
    $('.linked-label').textContent = `↖ Linked to paragraph ${String(beat + 1).padStart(2, '0')}`;
    $('.code-line-label').textContent = active.location ? `L${active.location.line} · ${active.location.side}` : '';
    $('.expand-context').textContent = 'Expand context +20';
    renderCode(active.excerpt);
    if (window.reviewEditor?.visible) window.reviewEditor.open(part.file, active.location || part.location);
    $('.split-slice').textContent = split.has(current) ? `Part ${beat + 1} of ${linked.length} · Rejoin` : '⑂ Split slice';
    if (focus) steps[current].querySelector(`[data-beat="${beat}"]`)?.focus({ preventScroll: false });
    updateControls();
  }
  function updateControls() {
    $('.step-back').hidden = current === 0 && beat === 0;
    let next = current + 1;
    while ($('#focus-risk').checked && next <= count && parts[next].risk === 'low') next++;
    const last = next > count && (!split.has(current) || beat === beats(parts[current]).length - 1);
    $('.step-next').hidden = last;
    $('.finish-review').hidden = !last;
    $('.step-next').textContent = current === 0 ? 'Start walkthrough →' : split.has(current) && beat < beats(parts[current]).length - 1 ? 'Next part →' : 'Next slice →';
  }
  function clearSelection() { selection = ''; lastSelection = ''; $('.selection-preview').hidden = true; $('.clear-context').hidden = true; $('.context-name').textContent = parts[current].title; }
  function show(step, focus = false) {
    current = Math.max(0, Math.min(count, step)); beat = 0;
    steps.forEach((section, i) => { section.hidden = i !== current; });
    checkpoints.forEach((checkpoint, i) => {
      checkpoint.dataset.state = i === current ? 'current' : i < current ? 'complete' : 'upcoming';
      if (i === current) checkpoint.setAttribute('aria-current', 'step'); else checkpoint.removeAttribute('aria-current');
    });
    $('.progress-count').textContent = `${current} of ${count} slices`;
    $('.progress-track').value = current;
    $('.split-slice').hidden = current === 0 || beats(parts[current]).length < 2;
    $('.reading-scroll').scrollTop = 0;
    $('.workspace-status').textContent = '';
    clearSelection(); renderMessages(); focusBeat(0);
    try { localStorage.setItem(key, String(current)); } catch { /* Navigation works without storage. */ }
    if (focus) { const title = steps[current].querySelector('h2'); title.tabIndex = -1; title.focus({ preventScroll: true }); }
  }
  function move(direction) {
    if (split.has(current) && beat + direction >= 0 && beat + direction < beats(parts[current]).length) return focusBeat(beat + direction, true);
    let target = current + direction;
    while ($('#focus-risk').checked && target > 0 && target <= count && parts[target].risk === 'low') target += direction;
    if (target > count) { $('.finish-review').focus(); return; }
    show(target, true);
  }
  $('.step-next').addEventListener('click', () => move(1));
  $('.step-back').addEventListener('click', () => move(-1));
  checkpoints.forEach((node, i) => node.addEventListener('click', () => show(i, true)));
  root.querySelectorAll('[data-jump]').forEach(node => node.addEventListener('click', () => show(Number(node.dataset.jump), true)));
  steps.forEach((step, i) => step.querySelectorAll('[data-beat]').forEach(node => {
    const select = event => { if (i === current && !event.target.closest('a') && !window.getSelection()?.toString()) focusBeat(Number(node.dataset.beat)); };
    node.addEventListener('click', select);
    node.addEventListener('keydown', event => { if (event.key === 'Enter') focusBeat(Number(node.dataset.beat)); });
  }));
  document.addEventListener('keydown', event => {
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.target.closest('input,textarea,select,[contenteditable="true"],.monaco-editor') || window.getSelection()?.toString()) return;
    if (event.key === 'ArrowRight' && !$('.step-next').hidden) { event.preventDefault(); move(1); }
    if (event.key === 'ArrowLeft' && !$('.step-back').hidden) { event.preventDefault(); move(-1); }
    if (event.key === 'ArrowDown') { event.preventDefault(); focusBeat(beat + 1, true); }
    if (event.key === 'ArrowUp') { event.preventDefault(); focusBeat(beat - 1, true); }
  });
  $('.split-slice').addEventListener('click', () => { if (split.has(current)) split.delete(current); else split.add(current); focusBeat(0); });
  $('#focus-risk').addEventListener('change', () => {
    checkpoints.forEach((node, i) => node.classList.toggle('deemphasized', $('#focus-risk').checked && parts[i].risk === 'low'));
    $('.workspace-status').textContent = $('#focus-risk').checked ? 'Next will skip low-risk slices. Every slice remains available in the outline.' : '';
  });
  $('.toggle-editor').addEventListener('click', () => {
    if (window.reviewEditor.visible) window.reviewEditor.close();
    else window.reviewEditor.open(parts[current].file, beats(parts[current])[beat].location || parts[current].location);
  });
  $('.expand-context').addEventListener('click', async () => {
    const id = ++snippetRequest, part = parts[current], location = beats(part)[beat].location || part.location;
    contextLines += 20;
    const amount = contextLines;
    $('.expand-context').textContent = 'Loading…';
    try {
      if (!location) throw new Error('This older walkthrough has no source line mapping. Regenerate it to expand context.');
      const code = await window.walkthroughApi.code(part.file, location.side);
      if (id !== snippetRequest) return;
      const lines = code.content.split('\n'), start = Math.max(1, location.line - amount);
      const end = Math.min(lines.length, location.line + amount);
      if (window.reviewEditor.visible) window.reviewEditor.close();
      renderCode(lines.slice(start - 1, end).join('\n'), start);
      $('.linked-label').textContent = `Source context · lines ${start}–${end}`;
      $('.expand-context').textContent = 'Expand context +20';
    } catch (e) { if (id === snippetRequest) { $('.workspace-status').textContent = e.message; $('.expand-context').textContent = 'Try expanding again'; } }
  });
  function openChat() { $('.chat-panel').hidden = false; $('.toggle-chat').setAttribute('aria-expanded', 'true'); }
  $('.toggle-chat').addEventListener('click', () => { const panel = $('.chat-panel'); panel.hidden = !panel.hidden; $('.toggle-chat').setAttribute('aria-expanded', String(!panel.hidden)); });
  let lastSelection = '';
  document.addEventListener('selectionchange', () => {
    const selected = window.getSelection();
    if (selected?.toString().trim() && root.contains(selected.anchorNode) && !$('.chat-panel').contains(selected.anchorNode)) lastSelection = selected.toString().slice(0, 16000);
  });
  $('.select-context').addEventListener('click', () => {
    selection = (window.reviewEditor?.visible && window.reviewEditor.selection()) || lastSelection;
    if (selection) {
      $('.selection-preview').textContent = selection; $('.selection-preview').hidden = false; $('.clear-context').hidden = false;
      $('.context-name').textContent = `Selection · ${parts[current].file}`;
    }
    openChat(); $('#chat-question').focus();
  });
  $('.clear-context').addEventListener('click', () => { lastSelection = ''; clearSelection(); });
  function renderMessages() {
    const messages = conversations.get(current) || [];
    const container = $('.chat-messages'); container.replaceChildren();
    if (!messages.length) {
      const welcome = document.createElement('p'); welcome.className = 'chat-welcome'; welcome.textContent = 'Ask about the behavior, an edge case, or a selected passage.'; container.append(welcome);
    }
    for (const message of messages) {
      const node = document.createElement('div'); node.className = `chat-message ${message.role}`;
      const author = document.createElement('strong'); author.textContent = message.role === 'user' ? 'You' : options.demo ? 'Demo assistant' : 'Walkthrough assistant';
      const text = document.createElement('div'); text.dataset.markdown = message.text; text.textContent = message.text; if (window.richContent) window.richContent.render(message.text,text); node.append(author, text); container.append(node);
    }
    container.scrollTop = container.scrollHeight;
  }
  let pendingChat = false, attachment = '';
  $('.chat-image').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2_000_000) { $('.workspace-status').textContent = 'Choose a PNG, JPEG, or WebP image smaller than 2 MB.'; event.target.value = ''; return; }
    attachment = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    $('.image-name').textContent = file.name; $('.remove-image').hidden = false;
  });
  $('.remove-image').addEventListener('click', () => { attachment = ''; $('.chat-image').value = ''; $('.image-name').textContent = ''; $('.remove-image').hidden = true; });
  $('.chat-form').addEventListener('submit', async event => {
    event.preventDefault(); if (pendingChat) return;
    const step = current, question = $('#chat-question').value.trim(); if (!question) return;
    const messages = conversations.get(step) || [], history = messages.slice(-8);
    messages.push({ role: 'user', text: question }); conversations.set(step, messages); renderMessages();
    $('#chat-question').value = ''; pendingChat = true;
    const button = $('.chat-form button[type=submit]'); button.disabled = true; button.textContent = 'Thinking…';
    try {
      const response = await request('chat', { step, question, selection, history, image: attachment, harness: $('.chat-form [name=harness]').value, model: $('.chat-form [name=model]').value });
      messages.push({ role: 'assistant', text: response.answer });
    } catch (e) { messages.push({ role: 'assistant', text: e.message }); }
    finally { pendingChat = false; button.disabled = false; button.textContent = 'Send ↑'; if (current === step) renderMessages(); }
  });
  $('.finish-review').addEventListener('click', async () => {
    const button = $('.finish-review'); button.disabled = true;
    try { const response = await request('reviewed', {}); $('.workspace-status').textContent = response.message; button.textContent = 'Completed ✓'; }
    catch (e) { $('.workspace-status').textContent = e.message; button.disabled = false; }
  });
  show(current);
})();
