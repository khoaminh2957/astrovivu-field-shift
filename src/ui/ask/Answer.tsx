/** Renders an assistant answer: paragraphs, `- ` lists and `[S#]` citation marks tied to sources. */
import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Citation } from '@/contracts';
import { useT } from '@/i18n';
import { Popover } from '@/ui/design';
import './strings';

function CitationMark({ n, c }: { n: number; c: Citation | undefined }) {
  const t = useT();
  if (!c) return <span className="t-meta">[S{n}]</span>;
  return (
    <Popover
      label={t('ask.source')}
      side="top"
      trigger={
        <button
          type="button"
          aria-label={t('ask.citeLabel', { n, title: c.title })}
          className="t-value mx-0.5 inline-flex h-4 items-center rounded-xs border border-line-2 px-1 align-[1px] text-2xs text-ink-1 hover:bg-surface-3"
        >
          S{n}
        </button>
      }
    >
      <SourceDetail c={c} />
    </Popover>
  );
}

export function SourceDetail({ c }: { c: Citation }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium text-ink-1">{c.title}</p>
      <p className="t-meta">{c.source}</p>
      {c.snippet && <p className="line-clamp-4 text-xs text-ink-2">{c.snippet}</p>}
      <p className="t-caption">
        {t('ask.licence')}: {c.license}
      </p>
      {c.url && (
        <a href={c.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-ink-1 underline decoration-line-3 underline-offset-2 hover:decoration-ink-1">
          {t('ask.open')} <ExternalLink size={12} aria-hidden />
        </a>
      )}
    </div>
  );
}

/** Inline formatting: citation marks and `**bold**` (the generative path may use it). */
function inline(text: string, citations: Citation[], key: string): ReactNode[] {
  return text.split(/(\[S\d+\]|\*\*[^*]+\*\*)/g).map((part, i) => {
    const cite = /^\[S(\d+)\]$/.exec(part);
    if (cite) {
      const n = Number(cite[1]);
      return <CitationMark key={`${key}-${i}`} n={n} c={citations[n - 1]} />;
    }
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={`${key}-${i}`} className="font-semibold text-ink-1">{part.slice(2, -2)}</strong>;
    return part;
  });
}

export function AnswerText({ text, citations }: { text: string; citations: Citation[] }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2.5 text-sm leading-[1.45rem] text-ink-1 stacked:text-base stacked:leading-6">
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const items = lines.filter((l) => /^\s*[-•]\s+/.test(l));
        if (items.length && items.length === lines.filter((l) => l.trim()).length) {
          return (
            <ul key={bi} className="flex list-none flex-col gap-1 p-0">
              {items.map((l, li) => (
                <li key={li} className="flex gap-2">
                  <span aria-hidden className="mt-[10px] h-px w-2 shrink-0 bg-line-3" />
                  <span className="min-w-0">{inline(l.replace(/^\s*[-•]\s+/, ''), citations, `${bi}-${li}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi} className="m-0">
            {lines.map((l, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {inline(l, citations, `${bi}-${li}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
