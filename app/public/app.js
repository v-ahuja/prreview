(() => {
  document.querySelectorAll('.model-fields').forEach(fields => {
    const harness=fields.querySelector('[name=harness]'), model=fields.querySelector('[name=model]');
    const values=new Map([[harness.value,model.value]]);let previous=harness.value;
    harness.addEventListener('change',()=>{values.set(previous,model.value);model.value=values.get(harness.value) || '';previous=harness.value;model.placeholder=harness.value==='opencode'?'provider/model':'Harness default';});
  });
  document.querySelectorAll('.scope-form').forEach(form => {
    const scope = form.querySelector('[name="scope"]'), range = form.querySelector('.commit-range');
    const update = () => { range.hidden = scope.value !== 'range'; range.querySelectorAll('input,select').forEach(input => { input.disabled = range.hidden; input.required = !range.hidden; }); };
    scope.addEventListener('change', update); update();
  });
  document.querySelectorAll('[data-viewed]').forEach(input => {
    try { input.checked = localStorage.getItem(`viewed:${input.dataset.viewed}`) === 'true'; } catch { /* optional */ }
    input.addEventListener('change', () => { try { localStorage.setItem(`viewed:${input.dataset.viewed}`, String(input.checked)); } catch { /* optional */ } });
  });
  document.querySelectorAll('.file-diff .diff [data-line]').forEach(line => line.addEventListener('click', () => {
    const form = line.closest('.file-diff').querySelector('.inline-comment');
    if (!form) return;
    form.open = true;
    form.querySelector('[name=line]').value = line.dataset.line;
    form.querySelector('[name=side]').value = line.dataset.side;
    form.querySelector('textarea').focus();
  }));
  const mentions = document.getElementById('mention-data');
  const names = mentions ? JSON.parse(mentions.textContent) : [];
  document.querySelectorAll('textarea[data-mentions]').forEach(textarea => {
    const list = document.createElement('div'); list.className = 'mention-menu'; list.hidden = true; list.setAttribute('role', 'listbox');
    textarea.insertAdjacentElement('afterend', list);
    let active = 0, matches = [], start = 0;
    const choose = name => {
      const end = textarea.selectionStart;
      textarea.setRangeText(`@${name} `, start, end, 'end'); list.hidden = true; textarea.focus();
    };
    const highlight = () => [...list.children].forEach((node, index) => node.setAttribute('aria-selected', String(index === active)));
    textarea.addEventListener('input', () => {
      const before = textarea.value.slice(0, textarea.selectionStart), match = /(?:^|\s)@([\w/-]*)$/.exec(before);
      if (!match) { list.hidden = true; return; }
      start = before.lastIndexOf('@');
      matches = names.filter(name => name.toLowerCase().includes(match[1].toLowerCase())).slice(0, 8); active = 0; list.replaceChildren();
      matches.forEach(name => { const button = document.createElement('button'); button.type = 'button'; button.textContent = `@${name}`; button.setAttribute('role','option'); button.addEventListener('mousedown', event => { event.preventDefault(); choose(name); }); list.append(button); });
      list.hidden = !matches.length; highlight();
    });
    textarea.addEventListener('keydown', event => {
      if (list.hidden) return;
      if (event.key === 'Escape') list.hidden = true;
      if (['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); active = (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; highlight(); }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); choose(matches[active]); }
    });
    textarea.addEventListener('blur', () => { setTimeout(() => { list.hidden = true; }, 120); });
  });
  document.querySelectorAll('.github-form').forEach(form => form.addEventListener('submit', () => { const button = form.querySelector('button[type="submit"], button:not([type])'); if (button) { button.disabled = true; button.textContent = 'Saving to GitHub…'; } }));
})();
