/**
 * Floating crop-knowledge assistant (all phases but the hero). Answers come from src/rag: retrieval
 * plus an extractive answer in the browser, or a generative one when the API server offers it.
 * With a locked field the question carries a FieldContext so the answer can use the field's data.
 */
import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, MessageCircleQuestion, X } from 'lucide-react';
import type { AskResult, FieldContext, Lang } from '@/contracts';
import { useT } from '@/i18n';
import { ask, buildFieldContext, suggestQuestions, warmUp } from '@/rag';
import { useMission } from '@/state/mission';
import { Button, ConfidenceBars, IconButton, ScrollArea, SkeletonText, Tag, cn, confidenceLevel } from '@/ui/design';
import { AnswerText, SourceDetail } from './Answer';
import './strings';

interface Turn {
  id: number;
  query: string;
  lang: Lang;
  result: AskResult | null;
}

function useFieldContext(enabled: boolean): FieldContext | undefined {
  const parcel = useMission((s) => s.parcel);
  const telemetry = useMission((s) => s.telemetry);
  const score = useMission((s) => s.score);
  const cursor = useMission((s) => s.timeline.cursor);
  const cropId = useMission((s) => s.cropId);
  const groundTruth = useMission((s) => s.groundTruth);
  return useMemo(() => {
    if (!enabled || !parcel) return undefined;
    try {
      return buildFieldContext({ parcel, telemetry, score, cursor, cropId, groundTruth });
    } catch {
      return undefined;
    }
  }, [enabled, parcel, telemetry, score, cursor, cropId, groundTruth]);
}

export function AskPanel() {
  const phase = useMission((s) => s.phase);
  const open = useMission((s) => s.askOpen);
  const setOpen = useMission((s) => s.setAskOpen);
  const lang = useMission((s) => s.lang);
  const triggerRef = useRef<HTMLElement | null>(null);
  const visible = open && phase !== 'hero';

  useEffect(() => {
    if (visible) warmUp();
  }, [visible]);
  useLayoutEffect(() => {
    if (visible) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else {
      if (document.activeElement === document.body) triggerRef.current?.focus({ preventScroll: true });
      triggerRef.current = null;
    }
  }, [visible]);

  // The launcher is the Ask entry in the rail or the tab bar.
  if (!visible) return null;
  return <AskSheet lang={lang} locked={phase === 'locked'} onClose={() => setOpen(false)} />;
}

function AskSheet({ lang, locked, onClose }: { lang: Lang; locked: boolean; onClose: () => void }) {
  const t = useT();
  const context = useFieldContext(true);
  const [query, setQuery] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [showCtx, setShowCtx] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  const starters = useMemo(() => suggestQuestions(context, lang), [context, lang]);
  const last = turns.at(-1);
  const chips = last?.result?.followUps.length ? last.result.followUps : turns.length ? [] : starters;

  const submit = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    const id = nextId.current++;
    setTurns((ts) => [...ts, { id, query: text, lang, result: null }]);
    setQuery('');
    setBusy(true);
    try {
      const result = await ask({ query: text, lang, context });
      setTurns((ts) => ts.map((x) => (x.id === id ? { ...x, result } : x)));
    } catch {
      setTurns((ts) => ts.map((x) => (x.id === id ? { ...x, result: { answer: t('ask.failed'), mode: 'extractive', citations: [], followUps: [], confidence: 0 } } : x)));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(query);
  };

  return (
    <section
      role="dialog"
      aria-label={t('ask.title')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      className={cn(
        'workspace-theme workspace-reveal plate-raised fixed z-(--z-assistant) flex flex-col',
        'top-2 right-2 bottom-2 w-[400px] rounded-lg',
        'narrow:inset-x-0 narrow:top-auto narrow:right-0 narrow:bottom-(--tabbar-h) narrow:h-[80dvh] narrow:w-full narrow:rounded-none',
        locked && 'workspace-field-assistant',
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line-1 px-(--panel-pad) py-2">
        <MessageCircleQuestion size={16} strokeWidth={1.5} aria-hidden className="text-ink-3" />
        <h2 className="t-heading flex-1 truncate">{t('ask.title')}</h2>
        {turns.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setTurns([])}>
            {t('ask.clear')}
          </Button>
        )}
        <IconButton label={t('ask.close')} icon={<X />} onClick={onClose} size="md" tooltipSide="left" />
      </header>

      <div className="shrink-0 border-b border-line-1">
        <button
          type="button"
          aria-expanded={showCtx}
          onClick={() => setShowCtx((v) => !v)}
          className="flex w-full items-center gap-2 px-(--panel-pad) py-2 text-left hover:bg-surface-2"
        >
          <span className="min-w-0 flex-1">
            <span className="t-label block">{t('ask.knows')}</span>
            <span className="t-caption block truncate">
              {context ? `${context.parcelName}${context.cropId ? ` · ${context.cropId}` : ''} · ${t('ask.facts', { n: Object.keys(context.facts).length })}` : t('ask.noField')}
            </span>
          </span>
          <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-ink-3 transition-transform duration-(--dur-fast)', showCtx && 'rotate-180')} />
        </button>
        {showCtx && <ContextFacts context={context} />}
      </div>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-(--panel-pad) py-3">
        <div className="flex flex-col gap-5" aria-live="polite">
          {turns.length === 0 && <p className="t-caption">{t('ask.intro')}</p>}
          {turns.map((turn) => (
            <TurnView key={turn.id} turn={turn} />
          ))}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      {chips.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-line-1 px-(--panel-pad) py-2" aria-label={turns.length ? t('ask.followUps') : t('ask.starters')} role="group">
          {chips.slice(0, 4).map((c) => (
            <button
              key={c}
              type="button"
              disabled={busy}
              onClick={() => void submit(c)}
              className="max-w-full rounded-full border border-line-2 bg-surface-0 px-3 py-1 text-left text-xs text-ink-1 hover:bg-surface-2 disabled:opacity-45 stacked:min-h-11 stacked:rounded-sm stacked:text-sm"
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="flex shrink-0 items-end gap-2 border-t border-line-1 p-(--panel-pad) pt-2.5">
        <label htmlFor="ask-input" className="sr-only">
          {t('ask.inputLabel')}
        </label>
        <textarea
          id="ask-input"
          ref={inputRef}
          rows={2}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit(query);
            }
          }}
          placeholder={t('ask.placeholder')}
          className="min-h-11 flex-1 resize-none rounded-sm border border-line-2 bg-surface-0 px-3 py-2 text-base text-ink-1 outline-none placeholder:text-ink-3 focus:border-signal"
        />
        <IconButton label={t('ask.send')} icon={<ArrowUp />} type="submit" variant="primary" size="lg" loading={busy} disabled={!query.trim()} />
      </form>
    </section>
  );
}

function ContextFacts({ context }: { context: FieldContext | undefined }) {
  const t = useT();
  if (!context) return <p className="t-caption px-(--panel-pad) pb-3">{t('ask.noFieldBody')}</p>;
  const facts = Object.entries(context.facts).filter(([k]) => !k.startsWith('score_')).slice(0, 14);
  return (
    <dl className="m-0 max-h-48 overflow-y-auto px-(--panel-pad) pb-3">
      {context.productivity != null && <Row k={t('ask.productivity')} v={`${Math.round(context.productivity)} /100`} />}
      {context.limitingFactor && <Row k={t('ask.limiting')} v={context.limitingFactor} />}
      {facts.map(([k, v]) => (
        <Row key={k} k={k} v={v} />
      ))}
    </dl>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 border-b border-line-1 py-1 last:border-b-0">
      <dt className="t-meta truncate" title={k}>
        {k}
      </dt>
      <dd className="m-0 text-xs text-ink-2">{v}</dd>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const t = useT();
  const r = turn.result;
  return (
    <article className="flex flex-col gap-2" lang={turn.lang}>
      <p className="self-end rounded-sm bg-surface-3 px-2.5 py-1.5 text-sm text-ink-1">{turn.query}</p>
      {!r ? (
        <SkeletonText lines={3} />
      ) : (
        <>
          <AnswerText text={r.answer} citations={r.citations} />
          <div className="flex flex-wrap items-center gap-2">
            <Tag title={t(`ask.modeHint.${r.mode}`)}>{t(`ask.mode.${r.mode}`)}</Tag>
            {r.citations.length > 0 && (
              <span className="inline-flex items-center gap-1 text-ink-2" title={t('ask.confidence')}>
                <ConfidenceBars level={confidenceLevel(r.confidence)} />
                <span className="t-status">{t(`ask.conf.${confidenceLevel(r.confidence)}`)}</span>
              </span>
            )}
          </div>
          {r.citations.length > 0 && (
            <details className="group">
              <summary className="t-caption cursor-pointer list-none hover:text-ink-1">
                {t('ask.sources', { n: r.citations.length })} <ChevronDown size={12} aria-hidden className="inline group-open:rotate-180" />
              </summary>
              <ol className="mt-2 flex list-none flex-col gap-3 p-0">
                {r.citations.map((c, i) => (
                  <li key={c.chunkId} className="grid grid-cols-[1.75rem_1fr] gap-1">
                    <span className="t-value text-2xs text-ink-3">S{i + 1}</span>
                    <SourceDetail c={c} />
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </article>
  );
}
