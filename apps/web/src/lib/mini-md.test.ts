import { describe, expect, it } from 'vitest';
import { miniMarkdown } from './mini-md';

describe('miniMarkdown', () => {
  it('renders headings, paragraphs and horizontal rules', () => {
    const html = miniMarkdown('# Title\n\nHello world.\n\n---\n\n## Section');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<p>Hello world.</p>');
    expect(html).toContain('<hr />');
    expect(html).toContain('<h2>Section</h2>');
  });

  it('renders bulleted lists with one level of nesting', () => {
    const html = miniMarkdown('- first\n- second\n  - nested\n  - also nested\n- third');
    expect(html).toContain('<ul><li>first</li><li>second<ul><li>nested</li><li>also nested</li></ul></li><li>third</li></ul>');
  });

  it('applies **bold** and `code` inline', () => {
    const html = miniMarkdown('A **bold** and `code` run.');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('escapes raw HTML in source text', () => {
    const html = miniMarkdown('A <script>alert(1)</script> plain paragraph.');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('allows http(s) links but refuses javascript: URLs', () => {
    const safe = miniMarkdown('[open](https://example.com/x)');
    expect(safe).toContain('<a href="https://example.com/x">open</a>');
    const bad = miniMarkdown('[run](javascript:alert(1))');
    expect(bad).not.toContain('<a');
    expect(bad).toContain('[run](javascript:alert(1))');
  });

  it("doesn't let link text inject tags", () => {
    const html = miniMarkdown('[<img onerror=x>](https://example.com)');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
