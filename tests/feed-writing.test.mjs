import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [suggestions, composer, feed, css, drawer] = await Promise.all([
  read("lib/feedSuggestions.ts"),
  read("components/feed/FeedComposer.tsx"),
  read("lib/feed.ts"),
  read("app/globals.css"),
  read("components/feed/FeedDrawer.tsx"),
]);

// The bank is topic-balanced: sixteen ideas for each of the eight live topics.
assert.equal((suggestions.match(/id: "[a-z]+-\d+"/g) || []).length, 128);
for (const topic of ["confession", "advice", "love", "vent", "funny", "deep", "question", "random"]) {
  assert.equal(
    (suggestions.match(new RegExp(`topic: "${topic}"`, "g")) || []).length,
    16,
    `${topic} has a complete suggestion set`
  );
}
assert.match(suggestions, /export function generateFeedSuggestion/);
assert.match(suggestions, /excludedIds/);

// AI Write generates one idea on demand; it no longer renders a suggestion menu.
assert.match(composer, /generateFeedSuggestion\(topic, generatedSuggestionIds\.current\)/);
assert.match(composer, /onClick=\{writeWithAi\}/);
assert.doesNotMatch(composer, /AI_SUGGESTIONS\.map/);
assert.doesNotMatch(composer, /showSuggestions/);

// The bank covers every topic the public feed exposes.
for (const topic of ["confession", "advice", "love", "vent", "funny", "deep", "question", "random"]) {
  assert.match(feed, new RegExp(`key: "${topic}"`));
}

// The drawer keeps a real scroll surface and has a phone-width layout rather than
// relying on desktop margins; its navigation rows also close the portal on tap.
assert.match(css, /@media \(max-width: 24rem\)[\s\S]*?\.feed-drawer \{[\s\S]*?width: 100%/);
assert.match(css, /\.feed-drawer-scroll[\s\S]*?overflow-x: hidden/);
assert.match(drawer, /createPortal\(/);
assert.match(drawer, /onClick=\{closeOnNavigate\}/);

console.log("PASS public-feed writing: 128 topic-balanced ideas generate one fresh draft per tap");
