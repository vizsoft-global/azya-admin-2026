import { Fragment, type ReactNode } from "react";

/**
 * Puts elements into a translated sentence, so the sentence is still translated whole:
 * `rich(tx("The link will be {link}"), { link: <span dir="ltr">{url}</span> })`.
 * Call `tx` without values for the placeholders that are elements.
 */
export function rich(text: string, parts: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/).map((piece, index) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return <Fragment key={index}>{name && name in parts ? parts[name] : piece}</Fragment>;
  });
}
