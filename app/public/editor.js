(() => {
  const root = document.querySelector('.walkthrough');
  if (!root) return;
  let editor, monacoReady, requestId = 0;
  const models = new Map();
  const shell = root.querySelector('.editor-shell');
  const error = root.querySelector('.editor-error');
  const files = root.querySelector('.editor-files');
  const side = root.querySelector('.editor-side');
  const language = file => ({ js: 'javascript', jsx: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', py: 'python', css: 'css', html: 'html', md: 'markdown', sql: 'sql', yaml: 'yaml', yml: 'yaml', go: 'go', rs: 'rust', java: 'java', rb: 'ruby', sh: 'shell', c: 'c', cpp: 'cpp' })[file.split('.').at(-1)] || 'plaintext';
  function initialize() {
    if (!monacoReady) monacoReady = import('/vendor/monaco.js').then(({ default: monaco }) => {
      monaco.editor.defineTheme('walkthrough', { base: 'vs', inherit: true, rules: [], colors: { 'editor.background': '#fcfdfd', 'editorLineNumber.foreground': '#a3adb4', 'editor.lineHighlightBackground': '#edf7f2' } });
      editor = monaco.editor.create(document.getElementById('monaco-editor'), { value: '', language: 'plaintext', theme: 'walkthrough', automaticLayout: true, fontSize: 13, lineHeight: 22, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 16 }, wordWrap: 'off', renderLineHighlight: 'all', accessibilitySupport: 'auto' });
      return editor;
    }).catch(error => { monacoReady = null; throw error; });
    return monacoReady;
  }
  let currentFile, currentLine = 1;
  window.reviewEditor = {
    async open(file, location = { side: 'head', line: 1 }) {
      const id = ++requestId;
      currentFile = file; currentLine = location?.line || 1;
      files.value = file; side.value = location?.side || 'head';
      shell.hidden = false; error.textContent = 'Loading pinned source…';
      root.querySelector('.toggle-editor').setAttribute('aria-expanded', 'true');
      root.querySelector('.toggle-editor').textContent = 'Collapse editor ↙';
      root.querySelector('.linked-diff').hidden = true;
      try {
        const sourceSide = side.value;
        const key = `${sourceSide}:${file}`;
        const instance = await initialize();
        let model = models.get(key);
        if (!model) {
          const source = await window.walkthroughApi.code(file, sourceSide);
          model = window.monaco.editor.createModel(source.content, language(file), window.monaco.Uri.parse(`inmemory://review/${encodeURIComponent(sourceSide)}/${file}`));
          models.set(key, model);
        }
        if (id !== requestId) return;
        instance.setModel(model);
        const line = Math.min(currentLine, model.getLineCount());
        instance.setPosition({ lineNumber: line, column: 1 });
        instance.revealLineInCenter(line);
        error.textContent = '';
      } catch (e) { if (id === requestId) { if (editor) editor.setModel(null); error.textContent = e.message; } }
    },
    close() {
      requestId++;
      shell.hidden = true;
      root.querySelector('.linked-diff').hidden = false;
      root.querySelector('.toggle-editor').setAttribute('aria-expanded', 'false');
      root.querySelector('.toggle-editor').textContent = 'Open editor ↗';
    },
    selection() {
      const selected = editor?.getSelection(), model = editor?.getModel();
      if (!selected || !model || selected.isEmpty()) return '';
      return `${currentFile}:${selected.startLineNumber}-${selected.endLineNumber} (${side.value}, scratch copy)\n${model.getValueInRange(selected)}`;
    },
    get visible() { return !shell.hidden; }
  };
  files.addEventListener('change', () => window.reviewEditor.open(files.value, { side: side.value, line: 1 }));
  side.addEventListener('change', () => window.reviewEditor.open(files.value, { side: side.value, line: 1 }));
  root.querySelector('.download-code').addEventListener('click', () => {
    if (!editor?.getModel()) return;
    const url = URL.createObjectURL(new Blob([editor.getValue()], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = currentFile.split('/').at(-1); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
