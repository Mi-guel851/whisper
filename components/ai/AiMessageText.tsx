"use client";

import { Fragment, useMemo } from "react";

/**
 * Renders Whispers AI's replies.
 *
 * The assistant is told to answer in plain text with bullets or numbered steps,
 * and models mostly comply — but "mostly" is the problem: a stray `**bold**` or
 * a `- ` at the start of a line rendered literally is the single most obvious
 * tell that a chat UI is unfinished.
 *
 * So this handles exactly what the system prompt asks for and nothing else:
 * paragraphs, unordered lists, ordered lists, and inline bold. No headings, no
 * tables, no links, no code fences. Deliberately not a markdown library — the
 * app has no markdown dependency, this is ~60 lines, and a parser that only
 * accepts four constructs cannot be talked into rendering a fifth.
 *
 * Everything is built as React elements from string slices, so model output is
 * never interpreted as HTML. There is no `dangerouslySetInnerHTML` here and
 * there should never be one: the reply is third-party text.
 */

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d{1,2}[.)]\s+/;

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      // A blank line closes whatever was open; the next line starts fresh.
      if (blocks.length > 0 && blocks[blocks.length - 1].kind === "p") {
        blocks.push({ kind: "p", lines: [] });
      }
      continue;
    }

    const previous = blocks[blocks.length - 1];

    if (BULLET.test(line)) {
      const item = line.replace(BULLET, "");
      if (previous?.kind === "ul") previous.items.push(item);
      else blocks.push({ kind: "ul", items: [item] });
      continue;
    }

    if (NUMBERED.test(line)) {
      const item = line.replace(NUMBERED, "");
      if (previous?.kind === "ol") previous.items.push(item);
      else blocks.push({ kind: "ol", items: [item] });
      continue;
    }

    if (previous?.kind === "p") previous.lines.push(line);
    else blocks.push({ kind: "p", lines: [line] });
  }

  return blocks.filter((block) => (block.kind === "p" ? block.lines.length > 0 : block.items.length > 0));
}

/** `**bold**` only. Odd trailing markers are left as literal text. */
function inline(text: string, keyPrefix: string) {
  const parts = text.split(/\*\*(.+?)\*\*/g);

  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <strong key={`${keyPrefix}-b${index}`} style={{ fontWeight: 700 }}>
        {part}
      </strong>
    ) : (
      <Fragment key={`${keyPrefix}-t${index}`}>{part}</Fragment>
    )
  );
}

export default function AiMessageText({ text }: { text: string }) {
  const blocks = useMemo(() => toBlocks(text), [text]);

  return (
    <div className="space-y-2">
      {blocks.map((block, blockIndex) => {
        const key = `b${blockIndex}`;

        if (block.kind === "p") {
          return (
            <p key={key} className="whitespace-pre-wrap">
              {block.lines.map((line, lineIndex) => (
                <Fragment key={`${key}-l${lineIndex}`}>
                  {lineIndex > 0 && "\n"}
                  {inline(line, `${key}-l${lineIndex}`)}
                </Fragment>
              ))}
            </p>
          );
        }

        const ListTag = block.kind === "ol" ? "ol" : "ul";

        return (
          <ListTag
            key={key}
            className={`space-y-1 ${block.kind === "ol" ? "list-decimal" : "list-disc"}`}
            style={{ paddingInlineStart: "1.15rem" }}
          >
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-i${itemIndex}`} style={{ paddingInlineStart: "0.1rem" }}>
                {inline(item, `${key}-i${itemIndex}`)}
              </li>
            ))}
          </ListTag>
        );
      })}
    </div>
  );
}
