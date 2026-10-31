// Synthetic presentation fixture. These excerpts are contiguous lines in diff below.
export const pull = {
  owner: 'example',
  repo: 'reading-list',
  number: 42,
  title: 'Keep saved articles in sync across devices',
  headSha: '8d2e7f4a91c0b6e5d3a2f19c4e8b7d0a6c5e2f1b'
};

export const diff = `diff --git a/src/store.js b/src/store.js
index 7a8c001..38d912f 100644
--- a/src/store.js
+++ b/src/store.js
@@ -12,7 +12,11 @@ export function saveArticle(article) {
-  localStorage.setItem('articles', JSON.stringify(articles));
+  localStorage.setItem('articles', JSON.stringify(articles));
+  syncQueue.push({ type: 'upsert', id: article.id, title: article.title, url: article.url, savedAt: article.savedAt });
+  scheduleSync();
   return article;
 }
diff --git a/src/sync.js b/src/sync.js
new file mode 100644
index 0000000..ee7201a
--- /dev/null
+++ b/src/sync.js
@@ -0,0 +1,12 @@
+export async function flushQueue(queue, transport) {
+  if (queue.length === 0) return { sent: 0 };
+  const pending = [...queue];
+  await transport.post('/api/articles/sync', { changes: pending });
+  queue.splice(0, pending.length);
+  return { sent: pending.length };
+}
diff --git a/src/merge.js b/src/merge.js
new file mode 100644
index 0000000..3df871a
--- /dev/null
+++ b/src/merge.js
@@ -0,0 +1,10 @@
+export function mergeArticles(local, remote) {
+  const byId = new Map(local.map(article => [article.id, article]));
+  for (const article of remote) {
+    const saved = byId.get(article.id);
+    if (!saved || article.savedAt > saved.savedAt) byId.set(article.id, article);
+  }
+  return [...byId.values()];
+}
`;

export const changedFiles = ['src/store.js', 'src/sync.js', 'src/merge.js'];

export const walkthrough = {
  anchor: {
    title: 'Local saves now enter a sync queue',
    rule: 'Save immediately, then send the change in the background.',
    explanation: 'The browser still writes the article locally before queuing a compact change. That keeps the save action responsive while the network catches up.',
    file: 'src/store.js',
    excerpt: `-  localStorage.setItem('articles', JSON.stringify(articles));
+  localStorage.setItem('articles', JSON.stringify(articles));
+  syncQueue.push({ type: 'upsert', id: article.id, title: article.title, url: article.url, savedAt: article.savedAt });
+  scheduleSync();`
  },
  slices: [
    {
      title: 'Queue each saved article',
      navLabel: 'Queue saves',
      takeaway: 'A local save records the data needed for later sync.',
      explanation: 'The save path takes an article, stores it locally, then queues an upsert containing its identity and display fields. It still returns the article immediately. The scheduled sync receives that queue next, so a save can trigger background synchronization without waiting for the network.',
      file: 'src/store.js',
      excerpt: `+  syncQueue.push({ type: 'upsert', id: article.id, title: article.title, url: article.url, savedAt: article.savedAt });
+  scheduleSync();`,
      next: 'See how the queued changes leave the browser.'
    },
    {
      title: 'Send the pending batch',
      navLabel: 'Send batch',
      takeaway: 'The queue clears only after the request succeeds.',
      explanation: 'The scheduled sync passes the queue and transport to this sender. It snapshots pending operations, posts that batch, and returns the number sent. Only a successful request removes those entries; a failed request leaves them available for retry. An empty queue still sends nothing.',
      file: 'src/sync.js',
      excerpt: `+  const pending = [...queue];
+  await transport.post('/api/articles/sync', { changes: pending });
+  queue.splice(0, pending.length);
+  return { sent: pending.length };`,
      next: 'See how remote articles join the local list.'
    },
    {
      title: 'Merge by article identity',
      navLabel: 'Merge articles',
      takeaway: 'The newer saved copy wins when both devices have an article.',
      explanation: 'After the sync response supplies remote articles, the merge starts with the local list and compares each remote copy by saved time. It returns one article per ID for the caller to display or persist. Local articles with no remote match remain in the result.',
      file: 'src/merge.js',
      excerpt: `+  const byId = new Map(local.map(article => [article.id, article]));
+  for (const article of remote) {
+    const saved = byId.get(article.id);
+    if (!saved || article.savedAt > saved.savedAt) byId.set(article.id, article);
+  }
+  return [...byId.values()];`,
    }
  ],
  omittedFiles: []
};

walkthrough.slices[0].risk = 'low';
walkthrough.slices[0].riskReason = 'The existing local write and immediate return stay in place.';
walkthrough.slices[0].importance = 'high';
walkthrough.slices[0].importanceReason = 'This is the entry point for every synchronized save.';
walkthrough.slices[0].beats = [
  { title: 'A save becomes a small operation', text: 'The save path still persists the article locally. It then appends an **upsert** with the article’s identity, display fields, and saved time. The queue contains everything the sender needs, so it does not have to read the article again later.', excerpt: walkthrough.slices[0].excerpt.split('\n')[0] },
  { title: 'Hand off without waiting', text: '`scheduleSync()` hands work to the background sender. The function still returns the article immediately. The caller can update the screen while the network catches up.', excerpt: '+  scheduleSync();' }
];
walkthrough.slices[1].risk = 'medium';
walkthrough.slices[1].riskReason = 'Network errors and concurrent saves affect queue delivery.';
walkthrough.slices[1].importance = 'high';
walkthrough.slices[1].importanceReason = 'The batch sender is the bridge from local saves to the server.';
walkthrough.slices[1].beats = [
  { title: 'Take a snapshot of the pending work', text: 'The sender copies the queue before making the request. That fixes the batch being sent even if new articles are saved while the request is in flight.', excerpt: '+  const pending = [...queue];' },
  { title: 'Wait for the server to accept the batch', text: 'The request sends the snapshot to `/api/articles/sync`. Because it is awaited, the code below only runs when the transport resolves. A rejected request leaves the queued entries in place.', excerpt: "+  await transport.post('/api/articles/sync', { changes: pending });" },
  { title: 'Remove only the operations that were sent', text: 'After success, the sender removes exactly the number of entries captured in the snapshot. New operations appended during the request remain in the queue. The caller receives the count sent.', excerpt: '+  queue.splice(0, pending.length);\n+  return { sent: pending.length };' }
];
walkthrough.slices[2].risk = 'high';
walkthrough.slices[2].riskReason = 'Timestamp conflict resolution determines which user data survives.';
walkthrough.slices[2].importance = 'high';
walkthrough.slices[2].importanceReason = 'The merge establishes the cross-device consistency rule.';
walkthrough.slices[2].beats = [
  { title: 'Keep one entry per article', text: 'A map starts with all local articles, indexed by ID. Remote articles are compared against that existing entry. An article that is only local remains in the map.', excerpt: '+  const byId = new Map(local.map(article => [article.id, article]));' },
  { title: 'Choose the more recently saved copy', text: 'The remote copy replaces a local entry only if its `savedAt` value is greater. Equal timestamps preserve the local copy. That rule depends on timestamps being comparable across devices; the excerpt does not establish how clocks are synchronized.', excerpt: '+    const saved = byId.get(article.id);\n+    if (!saved || article.savedAt > saved.savedAt) byId.set(article.id, article);' }
];

export const sources = {
  'src/store.js': `// Local article storage\nconst articles = [];\nconst syncQueue = [];\n\nfunction scheduleSync() {\n  // The application scheduler flushes the queue.\n}\n\nexport function saveArticle(article) {\n  articles.push(article);\n  // Save before scheduling a network request.\n  localStorage.setItem('articles', JSON.stringify(articles));\n  syncQueue.push({ type: 'upsert', id: article.id, title: article.title, url: article.url, savedAt: article.savedAt });\n  scheduleSync();\n  return article;\n}\n`,
  'src/sync.js': `export async function flushQueue(queue, transport) {\n  if (queue.length === 0) return { sent: 0 };\n  const pending = [...queue];\n  await transport.post('/api/articles/sync', { changes: pending });\n  queue.splice(0, pending.length);\n  return { sent: pending.length };\n}\n`,
  'src/merge.js': `export function mergeArticles(local, remote) {\n  const byId = new Map(local.map(article => [article.id, article]));\n  for (const article of remote) {\n    const saved = byId.get(article.id);\n    if (!saved || article.savedAt > saved.savedAt) byId.set(article.id, article);\n  }\n  return [...byId.values()];\n}\n`
};
