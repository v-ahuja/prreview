import * as monaco from 'monaco-editor';
self.MonacoEnvironment = {
  getWorker(_id, label) {
    const file = ['javascript', 'typescript'].includes(label) ? 'typescript' : ['css', 'scss', 'less'].includes(label) ? 'css' : ['html', 'handlebars', 'razor'].includes(label) ? 'html' : label === 'json' ? 'json' : 'editor';
    return new Worker(`/vendor/${file}.worker.js`, { type: 'module' });
  }
};
window.monaco = monaco;
export default monaco;
