import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const files = ['apps/web/src/App.tsx', 'apps/api/src/data.ts', 'apps/api/src/server.ts'];
const phrases = new Set();
const visibleAttributes = new Set(['placeholder', 'aria-label', 'title', 'alt']);
const visibleProperties = new Set(['label', 'title', 'description', 'body', 'text', 'sub', 'eyebrow', 'change', 'action', 'placeholder', 'condition', 'source', 'freshness', 'product', 'category', 'tagline', 'disclaimer', 'warning', 'summary', 'followUp', 'message']);
const visibleCalls = new Set(['toast', 'problem', 'prompt']);

function normalize(value) { return value.replace(/\s+/g, ' ').trim(); }
function looksHuman(value) {
  if (value.length < 2 || value.length > 600 || !/[A-Za-z]/.test(value)) return false;
  if (/^(https?:|\/|#|\.|[a-z]+\/|image\/|audio\/)/i.test(value)) return false;
  if (/^(agri-|usr_|lst_|aim_|SANDBOX-|req_|not_|art_|aud_)/i.test(value)) return false;
  if (/^[A-Z0-9_./:-]+$/.test(value)) return false;
  if (/^[a-z_]+(\.[a-z_]+)+$/.test(value)) return false;
  if (/^[a-z0-9_-]+\.(png|jpg|jpeg|svg|webp|json|mjs|ts|tsx)$/i.test(value)) return false;
  if (/^[\w.-]+@[\w.-]+\.[a-z]{2,}$/i.test(value)) return false;
  if (/Demo!\d|FarmerDemo|BuyerDemo|AdminDemo/.test(value)) return false;
  if (/^(GET|POST|PATCH|DELETE|ADMIN|BUYER|FARMER_SELLER|GUEST|ACTIVE|SUSPENDED)$/i.test(value)) return false;
  return true;
}
function add(value) { const normalized = normalize(value); if (looksHuman(normalized)) phrases.add(normalized); }
function callName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return '';
}
function insideJsxExpression(node) {
  let current = node.parent;
  let foundExpression = false;
  while (current && !ts.isSourceFile(current) && !ts.isBlock(current)) {
    if (ts.isJsxExpression(current)) foundExpression = true;
    if (ts.isJsxAttribute(current)) return foundExpression && visibleAttributes.has(current.name.text);
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current)) return foundExpression;
    current = current.parent;
  }
  return false;
}

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(node) {
    if (ts.isJsxText(node)) add(node.text);
    if (ts.isJsxAttribute(node) && visibleAttributes.has(node.name.text) && node.initializer && ts.isStringLiteral(node.initializer)) add(node.initializer.text);
    if (ts.isPropertyAssignment(node)) {
      const key = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : '';
      if (visibleProperties.has(key) && ts.isStringLiteralLike(node.initializer)) add(node.initializer.text);
    }
    if (file.endsWith('App.tsx') && ts.isStringLiteral(node) && insideJsxExpression(node)) add(node.text);
    if (ts.isCallExpression(node) && visibleCalls.has(callName(node.expression))) {
      for (const argument of node.arguments) if (ts.isStringLiteralLike(argument)) add(argument.text);
    }
    if (ts.isNoSubstitutionTemplateLiteral(node) && insideJsxExpression(node)) add(node.text);
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

const output = [...phrases].sort((a, b) => a.localeCompare(b));
const target = process.argv[2] || 'apps/api/src/translation-source.json';
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n');
console.log(`Extracted ${output.length} translation phrases to ${target}`);
