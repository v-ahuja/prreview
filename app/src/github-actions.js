import { githubFetch, repoPath } from './github.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const names = (value, pattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/) => {
  const items = [...new Set(String(value || '').split(',').map(s => s.trim().replace(/^@/, '')).filter(Boolean))];
  if (items.length > 20 || items.some(s => !pattern.test(s))) fail('Enter up to 20 valid names separated by commas.');
  return items;
};
function reviewComment(value) {
  const line=Number(value.line), start=value.start_line ? Number(value.start_line) : null;
  if(!value.path || typeof value.path!=='string' || value.path.length>1000 || !Number.isSafeInteger(line) || line<1 || !['LEFT','RIGHT'].includes(value.side) || typeof value.body!=='string' || !value.body.trim() || value.body.length>65000) fail('Choose a valid file, line, side, and comment.');
  if(start!==null && (!Number.isSafeInteger(start)||start<1||start>line)) fail('The comment range must end after its start.');
  return {path:value.path,line,side:value.side,body:value.body,...(start!==null&&start!==line?{start_line:start,start_side:value.side}:{})};
}
export async function performPullAction({ token, pull, repository, user, form, request = githubFetch }) {
  const root = repoPath(pull.base.repo.owner.login, pull.base.repo.name);
  const path = `${root}/pulls/${pull.number}`, issue = `${root}/issues/${pull.number}`;
  const action = form.get('action');
  const canWrite = !!(repository.permissions?.push || repository.permissions?.admin);
  const canManage = canWrite || user.login === pull.user.login;
  const call = (url, method, body) => request(url, { token, method, body });
  const body = String(form.get('body') || '').trim();
  if (body.length > 65000) fail('The comment is too long.');
  if (['review','inline','merge'].includes(action) && form.get('head') !== pull.head.sha)
    fail('This PR changed while you were reviewing it. Reload and review the new commits before submitting.', 409);
  if (['comment','reply','inline'].includes(action) && !body) fail('Write a comment first.');
  if (['edit','close','reopen','reviewers','assignees'].includes(action) && !canManage) fail('You do not have permission to manage this PR.', 403);
  if (['merge','labels'].includes(action) && !canWrite) fail('Repository write access is required.', 403);
  if (['review','inline','merge'].includes(action) && pull.state !== 'open') fail('This pull request is no longer open.', 409);
  switch (action) {
    case 'comment': return call(`${issue}/comments`, 'POST', { body });
    case 'reply': {
      const id = Number(form.get('commentId'));
      if (!Number.isSafeInteger(id) || id < 1) fail('Invalid thread');
      return call(`${path}/comments/${id}/replies`, 'POST', { body });
    }
    case 'review': {
      const event = form.get('event');
      if (!['COMMENT','APPROVE','REQUEST_CHANGES'].includes(event)) fail('Choose a review decision.');
      let comments=[];
      try{comments=JSON.parse(form.get('comments')||'[]');}catch{fail('Invalid review comments.');}
      if(!Array.isArray(comments)||comments.length>100) fail('Submit up to 100 review comments at once.');
      comments=comments.map(reviewComment);
      if (event !== 'APPROVE' && !body && !comments.length) fail('Add a summary or line comment to your review.');
      if (event !== 'COMMENT' && user.login === pull.user.login) fail('You cannot approve or request changes on your own PR.');
      return call(`${path}/reviews`, 'POST', { event, body, commit_id: pull.head.sha, ...(comments.length?{comments}:{}) });
    }
    case 'inline': {
      const line = Number(form.get('line')), side = form.get('side'), file = form.get('file');
      if (!Number.isSafeInteger(line) || line < 1 || !['LEFT','RIGHT'].includes(side) || !file || file.length > 1000) fail('Choose a valid changed line and side.');
      return call(`${path}/comments`, 'POST', { ...reviewComment({body,path:file,line,side,start_line:form.get('start_line')}), commit_id: pull.head.sha });
    }
    case 'reviewers': {
      const reviewers = names(form.get('reviewers')), team_reviewers = names(form.get('teams'));
      if (!reviewers.length && !team_reviewers.length) fail('Enter a teammate or team to request a review.');
      return call(`${path}/requested_reviewers`, 'POST', { reviewers, team_reviewers });
    }
    case 'assignees': return call(issue, 'PATCH', { assignees: names(form.get('assignees')) });
    case 'labels': return call(issue, 'PATCH', { labels: names(form.get('labels'), /^[^\r\n]{1,50}$/) });
    case 'edit': {
      const title = String(form.get('title') || '').trim();
      if (!title || title.length > 256) fail('Enter a title of up to 256 characters.');
      return call(path, 'PATCH', { title, body });
    }
    case 'close': case 'reopen':
      if (pull.merged) fail('A merged pull request cannot be reopened.', 409);
      return call(path, 'PATCH', { state: action === 'close' ? 'closed' : 'open' });
    case 'merge': {
      const method = form.get('method');
      if (!['squash','merge','rebase'].includes(method) || pull.draft) fail('Choose an enabled merge method for a ready PR.');
      const result = await call(`${path}/merge`, 'PUT', { sha: pull.head.sha, merge_method: method });
      if (!result.merged) fail(result.message || 'GitHub did not merge the PR.', 409);
      return result;
    }
    default: fail('Unknown PR action');
  }
}
