import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Load the real TSX component graph without adding a browser-only test dependency.
const require = createRequire(import.meta.url);
const Module = require('node:module');
const root = fileURLToPath(new URL('../', import.meta.url));
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  return resolve.call(this, id.startsWith('@/') ? path.join(root, id.slice(2)) : id, ...args);
};
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (module, filename) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    module._compile(outputText, filename);
  };
}
const FeedPostCard = require('../components/feed/FeedPostCard.tsx').default;
const make = (id, children = []) => ({ id, author_id: id, body: `Text ${id}`, created_at: '2026-09-10T08:00:00Z', expires_at: '2026-09-11T08:00:00Z', children });
const tree = make('root', [make('reply-a', [make('grandchild', [make('great-grandchild')])]), make('reply-b', [make('sibling-child')])]);
const noop = () => {};
function render(expanded, replyOpen = {}) {
  return renderToStaticMarkup(React.createElement(FeedPostCard, {
    node: tree, depth: 0,
    controller: {
      myId: 'viewer', replyCost: 0, reducedMotion: true, expanded, replyOpen,
      likeCount: {}, liked: {}, replyText: {}, replySending: {}, threadLoading: {}, pollCounts: {}, pollChoice: {}, pollPending: {}, imageState: {},
      onToggleLike: noop, onToggleReplyBox: noop, onReplyTextChange: noop, onRequestSend: noop, onToggleThread: noop, onRequestDelete: noop, onShare: noop, onVote: noop, onOpenImage: noop, onOpenMenu: noop,
    },
  }));
}
function ids(html) { return [...html.matchAll(/data-post-id="([^"]+)"/g)].map((match) => match[1]); }
assert.deepEqual(ids(render({})), ['root']);
assert.deepEqual(ids(render({ root: true })), ['root', 'reply-a', 'reply-b']);
assert.deepEqual(ids(render({ root: true, 'reply-a': true })), ['root', 'reply-a', 'grandchild', 'reply-b']);
assert.deepEqual(ids(render({ root: true, 'reply-a': true, grandchild: true })), ['root', 'reply-a', 'grandchild', 'great-grandchild', 'reply-b']);
assert.deepEqual(ids(render({ root: false, 'reply-a': true })), ['root']);
assert.deepEqual(ids(render({}, { root: true })), ['root']);
assert.match(render({ root: true }), /Replies and reply box — 1 reply/);
console.log('PASS actual feed rendering: collapsed root, immediate replies only, independent nested branches, sibling isolation, counts, parent collapse and composer isolation');
