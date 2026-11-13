import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Metadata } from 'next';
import { miniMarkdown } from '@/lib/mini-md';

export const metadata: Metadata = { title: "What's new · FG One" };

/** Renders docs/CHANGELOG.md inline. Runs on the server, so there's no bundle cost. */
export default async function ChangelogPage() {
  let html: string;
  // `pnpm sync-content` copies docs/CHANGELOG.md here at dev / build time.
  // Try the local copy first; fall back to the repo docs path for when sync-content
  // hasn't run yet (e.g. a developer just cloned and is reading the page).
  const candidates = [
    path.join(process.cwd(), 'src', 'content', 'CHANGELOG.md'),
    path.join(process.cwd(), '..', '..', 'docs', 'CHANGELOG.md'),
  ];
  html = '<p>The changelog could not be read.</p>';
  for (const file of candidates) {
    try {
      const raw = await readFile(file, 'utf8');
      html = miniMarkdown(raw);
      break;
    } catch {
      /* try next */
    }
  }
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">What&apos;s new</h1>
      <p className="mb-6 text-sm text-muted">Recent changes to FG One. Latest at the top.</p>
      {/* `html` is produced by miniMarkdown, which escapes all input and only emits a fixed tag set. */}
      <div className="changelog-prose [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12.5px] [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:mb-1.5 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-muted [&_hr]:my-6 [&_hr]:border-border [&_li]:mb-1 [&_p]:mb-3 [&_p]:text-[14px] [&_p]:leading-relaxed [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-[14px] [&_ul_ul]:mt-1 [&_ul_ul]:mb-0" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
