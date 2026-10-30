import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasSplitModuleGraph } from './capture-screenshots.mjs';

// Minimal excerpts from the deployed bundle: HTML template text and DOM lookups.
const releaseSnippet = '`<label>Import log<input id="import" type="file" accept="application/json,.json"></label>`;i("import").onchange=()=>{var n;const e=(n=i("import").files)==null?void 0:n[0];if(!e)return;};';

test('accepts deployed Import control literals', () => {
  assert.equal(hasSplitModuleGraph(releaseSnippet), false);
});

test('accepts comments, regexes, and literal module-looking text', () => {
  assert.equal(hasSplitModuleGraph('// import "./ignored.js"\nconst a = /["\']import/; const b = "import(\\"./text.js\\")"; /* export*from"./ignored.js" */'), false);
});

for (const source of [
  'import{a}from"./chunk-x.js"',
  'import("./lazy-1.js")',
  'export*from"./b.js"',
  'import"./side.js"',
  'import a from "../chunk.mjs"',
  'import/* comment */("/chunk.js")',
  'export {a} from "./chunk.js"',
  'new URL("./worker.js", import.meta.url)',
  'import(path)',
  '`raw text ${import("./lazy.js")}`',
  '`raw ${`nested ${import("./lazy.js")}`}`',
  'const x = {} / import("./lazy.js") / 2;',
]) {
  test(`rejects module dependency: ${source}`, () => {
    assert.equal(hasSplitModuleGraph(source), true);
  });
}

for (const html of [
  '<link rel="modulepreload" href="/chunk.js">',
  "<link href='./chunk.mjs' rel='modulepreload'>",
  '<LINK REL=modulepreload href="./chunk.js">',
  '<link rel="alternate modulepreload" href="./chunk.js">',
]) {
  test(`rejects module preload: ${html}`, () => {
    assert.equal(hasSplitModuleGraph('', html), true);
  });
}

test('accepts single-bundle HTML', () => {
  assert.equal(hasSplitModuleGraph('', '<script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css">'), false);
});
