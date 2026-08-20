export type TranslationBundle = {
  language: string;
  version: number;
  publicationStatus: 'draft' | 'approved';
  counts: { total: number; approved: number; draft: number };
  messages: Record<string, string>;
};

type TextState = { source: string; rendered: string };
type AttributeState = Record<string, { source: string; rendered: string }>;
const textStates = new WeakMap<Text, TextState>();
const attributeStates = new WeakMap<Element, AttributeState>();
const translatedAttributes = ['placeholder', 'title', 'aria-label', 'alt'];
const excludedElements = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT']);

function normalized(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function translatedValue(source: string, language: string, messages: Record<string, string>) {
  if (language === 'en') return source;
  const key = normalized(source);
  const translation = messages[key];
  if (!translation || translation === key) return source;
  const leading = source.match(/^\s*/)?.[0] || '';
  const trailing = source.match(/\s*$/)?.[0] || '';
  return `${leading}${translation}${trailing}`;
}

function excluded(node: Node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return Boolean(element?.closest('[data-no-translate="true"]')) || Boolean(element && excludedElements.has(element.tagName));
}

export function applyPlatformTranslations(root: HTMLElement, language: string, messages: Record<string, string>) {
  const translateText = (node: Text) => {
    if (excluded(node)) return;
    const current = node.nodeValue || '';
    if (!normalized(current)) return;
    let state = textStates.get(node);
    if (!state || (current !== state.rendered && current !== state.source)) state = { source: current, rendered: current };
    const rendered = translatedValue(state.source, language, messages);
    textStates.set(node, { source: state.source, rendered });
    if (current !== rendered) node.nodeValue = rendered;
  };

  const translateElement = (element: Element) => {
    if (excluded(element)) return;
    const states = attributeStates.get(element) || {};
    for (const attribute of translatedAttributes) {
      if (!element.hasAttribute(attribute)) continue;
      const current = element.getAttribute(attribute) || '';
      let state = states[attribute];
      if (!state || (current !== state.rendered && current !== state.source)) state = { source: current, rendered: current };
      const rendered = translatedValue(state.source, language, messages);
      states[attribute] = { source: state.source, rendered };
      if (current !== rendered) element.setAttribute(attribute, rendered);
    }
    attributeStates.set(element, states);
  };

  const translateTree = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) translateText(node as Text);
    if (node.nodeType === Node.ELEMENT_NODE) translateElement(node as Element);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let child = walker.nextNode();
    while (child) {
      if (child.nodeType === Node.TEXT_NODE) translateText(child as Text);
      else translateElement(child as Element);
      child = walker.nextNode();
    }
  };

  translateTree(root);
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') translateText(mutation.target as Text);
      if (mutation.type === 'attributes') translateElement(mutation.target as Element);
      for (const node of mutation.addedNodes) translateTree(node);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: translatedAttributes });
  return () => observer.disconnect();
}

export function readCachedBundle(language: string): TranslationBundle | null {
  try {
    const value = localStorage.getItem(`agri-translations-${language}`);
    return value ? JSON.parse(value) : null;
  } catch { return null; }
}

export function cacheBundle(bundle: TranslationBundle) {
  try { localStorage.setItem(`agri-translations-${bundle.language}`, JSON.stringify(bundle)); } catch { /* Storage may be unavailable. */ }
}
