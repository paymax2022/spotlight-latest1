import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import Link from 'next/link';
import Layout from '@/components/layout/Layout';

export const metadata = {
  title: 'Privacy Policy | Spotlight SuperApp',
  description:
    'Read how Spotlight SuperApp collects, uses, shares and protects personal information, and learn about your privacy rights.',
};

export const dynamic = 'force-static';

const policyMarkdown = readFileSync(
  path.join(process.cwd(), 'app/privacy-policy/privacy-policy.md'),
  'utf8',
);
const policyBody = policyMarkdown.slice(policyMarkdown.indexOf('## 1. Introduction'));

type PolicyBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'subheading'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] };

type PolicySection = {
  id: string;
  title: string;
  blocks: PolicyBlock[];
};

function headingId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function parsePolicy(markdown: string): PolicySection[] {
  const sections: PolicySection[] = [];
  let section: PolicySection | undefined;
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;

  const flushParagraph = () => {
    if (section && paragraph.length > 0) {
      section.blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (section && list) {
      section.blocks.push({ kind: 'list', ...list });
      list = undefined;
    }
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const title = heading[1];
      section = { id: headingId(title), title, blocks: [] };
      sections.push(section);
      continue;
    }
    if (!section) continue;

    const subheading = line.match(/^###\s+(.+)$/);
    if (subheading) {
      flushParagraph();
      flushList();
      section.blocks.push({ kind: 'subheading', text: subheading[1] });
      continue;
    }

    const bullet = line.match(/^-\s+(.+)$/);
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet || numbered)![1]);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (line.startsWith('# ')) continue;

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return sections;
}

function renderInline(text: string): ReactNode[] {
  const tokenPattern = /(\*\*[^*]+\*\*|https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g;
  return text.split(tokenPattern).filter(Boolean).map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={index} className="font-semibold text-[#17182b]">{token.slice(2, -2)}</strong>;
    }
    if (/^https?:\/\//.test(token)) {
      const url = token.replace(/[.,;:!?]+$/, '');
      return (
        <span key={index}>
          <a href={url} target="_blank" rel="noreferrer" className="text-[#384bff] underline underline-offset-2">
            {url}
          </a>
          {token.slice(url.length)}
        </span>
      );
    }
    if (/^[\w.+-]+@/.test(token)) {
      return <a key={index} href={`mailto:${token}`} className="text-[#384bff] underline underline-offset-2">{token}</a>;
    }
    return token;
  });
}

function PolicyContent({ sections }: { sections: PolicySection[] }) {
  return (
    <article className="rounded-2xl border border-[#e7eaf0] bg-white px-6 py-8 shadow-[0_12px_40px_rgba(20,25,50,0.04)] sm:px-10 md:px-12">
      {sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className="scroll-mt-28 border-b border-[#edf0f4] py-8 first:pt-0 last:border-0 last:pb-0"
        >
          <h2 className="font-display text-2xl font-semibold leading-tight text-[#17182b] md:text-[1.75rem]">
            {section.title}
          </h2>
          <div className="mt-5 space-y-4 text-[0.97rem] leading-8 text-[#555b6b]">
            {section.blocks.map((block, index) => {
              if (block.kind === 'subheading') {
                return (
                  <h3 key={index} className="pt-3 font-display text-lg font-semibold leading-7 text-[#25273a]">
                    {block.text}
                  </h3>
                );
              }
              if (block.kind === 'paragraph') {
                return <p key={index}>{renderInline(block.text)}</p>;
              }
              const List = block.ordered ? 'ol' : 'ul';
              return (
                <List
                  key={index}
                  className={`space-y-2 pl-6 marker:text-[#384bff] ${block.ordered ? 'list-decimal' : 'list-disc'}`}
                >
                  {block.items.map((item, itemIndex) => (
                    <li key={itemIndex} className="pl-1">{renderInline(item)}</li>
                  ))}
                </List>
              );
            })}
          </div>
        </section>
      ))}
    </article>
  );
}

export default function PrivacyPolicyPage() {
  const sections = parsePolicy(policyBody);

  return (
    <Layout headerStyle={1} footerStyle={1} onePageNav={false} breadcrumbTitle={null} breadcrumbClassName={undefined} breadcrumbPadding={undefined}>
      <div className="bg-[#f5f7fb]">
        <section className="relative overflow-hidden border-b border-[#e7eaf0] bg-white">
          <div className="pointer-events-none absolute -right-20 -top-32 h-96 w-96 rounded-full bg-[#384bff]/[0.06] blur-3xl" />
          <div className="container relative py-14 md:py-20">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#384bff]">
              Spotlight SuperApp · Privacy &amp; data protection
            </p>
            <h1
              className="mt-5 max-w-5xl font-display font-semibold tracking-tight text-[#17182b]"
              style={{ fontSize: 'clamp(3rem, 5vw, 4.5rem)', lineHeight: 1.08 }}
            >
              Your privacy matters.
            </h1>
            <p className="mt-6 max-w-3xl text-base leading-7 text-[#626879] md:text-lg md:leading-8">
              Learn what personal information Spotlight may collect, how it is used and protected,
              and the choices and rights available to you.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <span className="rounded-full border border-[#e7eaf0] bg-[#f7f8fb] px-4 py-2 text-sm text-[#4c5262]">
                Effective 4 November 2026
              </span>
              <span className="rounded-full border border-[#e7eaf0] bg-[#f7f8fb] px-4 py-2 text-sm text-[#4c5262]">
                Last updated 4 November 2026
              </span>
            </div>
          </div>
        </section>

        <div className="container grid gap-8 py-10 md:grid-cols-[270px_minmax(0,1fr)] md:gap-10 md:py-14">
          <aside className="h-fit md:sticky md:top-8">
            <div className="rounded-2xl border border-[#e7eaf0] bg-white p-5 shadow-[0_12px_40px_rgba(20,25,50,0.04)]">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#384bff]">On this page</p>
              <nav aria-label="Privacy policy contents" className="mt-4 max-h-[58vh] space-y-1 overflow-y-auto pr-1">
                {sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="block rounded-lg px-3 py-2 text-sm leading-5 text-[#596071] transition-colors hover:bg-[#384bff]/[0.06] hover:text-[#384bff]"
                  >
                    {section.title}
                  </a>
                ))}
              </nav>
              <div className="mt-5 border-t border-[#edf0f4] pt-5">
                <p className="text-sm font-semibold text-[#25273a]">Privacy questions?</p>
                <a href="mailto:info@spotlightng.com" className="mt-1 inline-block text-sm text-[#384bff] underline underline-offset-2">
                  info@spotlightng.com
                </a>
              </div>
            </div>
          </aside>

          <div className="min-w-0">
            <div className="mb-6 rounded-2xl border border-[#dfe5ff] bg-[#eef1ff] p-5 sm:p-6">
              <p className="text-sm font-semibold text-[#25273a]">A note about this policy</p>
              <p className="mt-2 text-sm leading-6 text-[#555b6b]">
                The information we process depends on the features you use and the permissions you
                grant. Where a partner independently controls your information, that partner&apos;s
                own privacy policy may also apply.
              </p>
            </div>
            <PolicyContent sections={sections} />
            <p className="px-2 pt-6 text-sm text-[#73798a]">
              Need to exercise a privacy right?{' '}
              <a href="mailto:info@spotlightng.com" className="font-medium text-[#384bff] underline underline-offset-2">
                Contact our privacy team
              </a>
              {' '}or visit the{' '}
              <Link href="/contact" className="font-medium text-[#384bff] underline underline-offset-2">
                contact page
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
