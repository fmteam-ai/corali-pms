// Renders AI replies safely: **bold**, "#" headings and bare http(s) links; everything else stays plain text.
import { Fragment, type ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|https?:\/\/[^\s)]+)/g).filter(Boolean).map((part, i) => {
    if (/^\*\*[^*\n]+\*\*$/.test(part)) return <b key={`${key}-${i}`}>{part.slice(2, -2)}</b>;
    if (/^https?:\/\//.test(part)) return <a key={`${key}-${i}`} href={part} target="_blank" rel="noopener noreferrer">{part.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}</a>;
    return <Fragment key={`${key}-${i}`}>{part}</Fragment>;
  });
}

export function AiText({ text }: { text: string }) {
  const lines = text.split("\n");
  return <>{lines.map((line, i) => {
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    return <Fragment key={i}>{heading ? <b>{inline(heading[1].replace(/\*\*/g, ""), `h${i}`)}</b> : inline(line, `l${i}`)}{i < lines.length - 1 ? "\n" : ""}</Fragment>;
  })}</>;
}
