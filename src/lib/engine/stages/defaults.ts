// Defaults stage: injects the client's user-agent stylesheet as a low-priority
// <style> at the top of <head>, so author inline/existing styles override it.
// This makes unstyled content render the way the target client actually shows
// it (e.g. Outlook's serif default), instead of the browser's own defaults.
import {
  findElement,
  buildStyleNode,
  prependChild,
  type ChildNode,
  type ParentNode,
} from '../parse/html';
import type { StageContext } from './context';

export function runDefaults(ctx: StageContext): void {
  const css = ctx.profile.uaStylesheet.trim();
  if (!css) return;

  const doc = ctx.parsed.document;
  const host: ParentNode =
    findElement(doc, 'head') ?? findElement(doc, 'body') ?? findElement(doc, 'html') ?? doc;

  const style = buildStyleNode(css, [{ name: 'data-ua-default', value: ctx.clientId }]);
  prependChild(host, style as unknown as ChildNode);

  ctx.mutations.push({
    client: ctx.clientId,
    stage: 'defaults',
    action: 'inject-default',
    target: { element: 'style' },
    feature: `default-${ctx.clientId}-ua-stylesheet`,
    severity: 'info',
    reason:
      `${ctx.profile.name} applies its own default styles (${ctx.profile.engine}). ` +
      `A user-agent stylesheet was injected so unstyled content reflects how this ` +
      `client renders it; your own styles still take precedence.`,
    evidence: ctx.profile.vendorDocs,
  });
}
