/**
 * The crop assistant, a page of its own laid out like a chat app: one centred column with the
 * conversation, the composer at the foot of the page. Answers come from src/rag: retrieval plus an
 * extractive answer in the browser, or a generative one when the API server offers it. With a field
 * open the question carries a FieldContext, unless the visitor turns the field chip off.
 */
import { type FormEvent, type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { ArrowUp, ArrowUpRight, ChevronDown, CornerDownRight, MapPin, MessageCircleQuestion, Plus, Sprout, SquarePen, X } from 'lucide-react';
import type { AskResult, FieldContext } from '@/contracts';
import { cropName, getCrop } from '@/core/crops';
import { useGlobeStatus } from '@/globe';
import { useLang, useT } from '@/i18n';
import { buildFieldContext, suggestQuestions, warmUp } from '@/rag';
import { useMission } from '@/state/mission';
import { Button, ConfidenceBars, IconButton, Tag, confidenceLevel, usePrefersReducedMotion } from '@/ui/design';
import { AnswerText, SourceDetail } from './Answer';
import { useChat } from './chatStore';
import { type ChatTurn, chatStarters, followUpsOf, isAnswering } from './conversation';
import './strings';

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

function useReducedMotion(): boolean {
  const system = usePrefersReducedMotion();
  const app = useGlobeStatus((s) => s.reducedMotion);
  return system || app;
}

export function AskPage() {
  const t = useT();
  const lang = useLang();
  const parcelName = useMission((s) => s.parcel?.name);
  const cropId = useMission((s) => s.cropId);
  const turns = useChat((s) => s.turns);
  const draft = useChat((s) => s.draft);
  const useField = useChat((s) => s.useField);
  // Derived here, not in a selector: a selector that returns a new array would re-render forever.
  const followUps = useMemo(() => followUpsOf({ turns }), [turns]);
  const busy = isAnswering({ turns });
  const { setDraft, setUseField, send, dispatch } = useChat.getState();
  const context = useFieldContext(useField);
  const reduced = useReducedMotion();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const crop = getCrop(cropId);
  const fieldLabel = parcelName ? [parcelName, crop && cropName(crop, lang)].filter(Boolean).join(' · ') : null;
  const starters = useMemo(() => chatStarters(suggestQuestions(context, lang), !!context, lang), [context, lang]);

  useEffect(() => {
    warmUp();
    // On a touch screen the keyboard would cover the suggestions the moment the page opens.
    if (window.matchMedia?.('(pointer: fine)').matches) inputRef.current?.focus({ preventScroll: true });
  }, []);

  // The composer grows with its text; CSS caps it at six lines, after which it scrolls.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  // A new question scrolls to the foot of the conversation; a long answer is shown from its start,
  // the way chat apps do, rather than from its last line.
  const last = turns.at(-1);
  const lastId = last?.id;
  const lastDone = !!last?.result;
  const firstScroll = useRef(true);
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const behavior: ScrollBehavior = reduced || firstScroll.current ? 'auto' : 'smooth';
    firstScroll.current = false;
    const answer = lastId != null && lastDone ? box.querySelector<HTMLElement>(`[data-answer="${lastId}"]`) : null;
    const top = answer && answer.offsetHeight > box.clientHeight * 0.7 ? answer.offsetTop - 24 : box.scrollHeight;
    box.scrollTo({ top, behavior });
  }, [lastId, lastDone, reduced]);

  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    void send(text, lang, context, t('ask.failed'));
    inputRef.current?.focus({ preventScroll: true });
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    submit(draft);
    setDraft('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Composition (Vietnamese and other input methods) uses Enter to confirm a word, not to send.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  };
  const newChat = () => {
    dispatch({ type: 'clear' });
    setDraft('');
    inputRef.current?.focus({ preventScroll: true });
  };

  return (
    <main aria-labelledby="ask-title" className="workspace-theme ask-workspace">
      <header className="ask-header">
        <h1 id="ask-title" className="ask-title">
          <MessageCircleQuestion aria-hidden />
          {t('ask.title')}
        </h1>
        <Button variant="secondary" icon={<SquarePen />} title={t('ask.newChat.label')} onClick={newChat} disabled={turns.length === 0 && !draft}>
          {t('ask.newChat')}
        </Button>
      </header>

      <div ref={scrollRef} className="ask-scroll">
        <div className="ask-column">
          {turns.length === 0 && (
            <div className="ask-empty">
              <span className="ask-empty-mark" aria-hidden>
                <Sprout />
              </span>
              <h2 className="ask-empty-title">{t('ask.empty.title')}</h2>
              <p className="ask-empty-body">{t(context ? 'ask.empty.bodyField' : 'ask.empty.body')}</p>
              <ul aria-label={t('ask.starters')} className="ask-starters">
                {starters.map((q) => (
                  <li key={q}>
                    <button type="button" className="ask-starter" onClick={() => submit(q)}>
                      <span>{q}</span>
                      <ArrowUpRight aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Always mounted, so the first question is announced like the rest. */}
          <div role="log" aria-live="polite" aria-label={t('ask.log')} className="ask-log">
            {turns.map((turn) => (
              <TurnView key={turn.id} turn={turn} reduced={reduced} />
            ))}
          </div>
          {!busy && followUps.length > 0 && (
            <div role="group" aria-label={t('ask.followUps')} className="ask-followups">
              {followUps.map((q) => (
                <button key={q} type="button" className="ask-followup" onClick={() => submit(q)}>
                  <CornerDownRight aria-hidden />
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="ask-dock">
        <form onSubmit={onSubmit} className="ask-composer">
          {fieldLabel && (
            <button
              type="button"
              aria-pressed={useField}
              title={useField ? `${t('ask.about.on')} ${context ? t('ask.about.facts', { n: Object.keys(context.facts).length }) : ''}`.trim() : t('ask.about.off', { field: fieldLabel })}
              onClick={() => setUseField(!useField)}
              className="ask-field-chip"
            >
              <MapPin aria-hidden />
              <span className="min-w-0 truncate">{t('ask.about', { field: fieldLabel })}</span>
              {useField ? <X aria-hidden /> : <Plus aria-hidden />}
            </button>
          )}
          <label htmlFor="ask-input" className="sr-only">
            {t('ask.inputLabel')}
          </label>
          <div className="ask-composer-row">
            <textarea
              id="ask-input"
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              aria-describedby="ask-hint"
              placeholder={t(fieldLabel && useField ? 'ask.placeholder' : 'ask.placeholder.general')}
              className="ask-input"
            />
            <IconButton label={t('ask.send')} icon={<ArrowUp />} type="submit" variant="primary" size="lg" loading={busy} disabled={!draft.trim()} />
          </div>
        </form>
        <p id="ask-hint" className="ask-disclaimer">
          <span className="sr-only">{t('ask.hint')}. </span>
          {t('ask.disclaimer')}
        </p>
      </div>
    </main>
  );
}

function TurnView({ turn, reduced }: { turn: ChatTurn; reduced: boolean }) {
  const t = useT();
  return (
    <article className="ask-turn" lang={turn.lang}>
      <h3 className="sr-only">{t('ask.you')}</h3>
      <p className="ask-user">{turn.query}</p>
      <div className="ask-answer" data-answer={turn.id}>
        <span className="ask-avatar" aria-hidden>
          <Sprout />
        </span>
        <div className="ask-answer-body">
          <h3 className="sr-only">{t('ask.assistant')}</h3>
          {turn.result ? <AnswerBody r={turn.result} /> : <Thinking reduced={reduced} />}
        </div>
      </div>
    </article>
  );
}

/** Three dots while the answer is computed; with reduced motion, the same words without the dots. */
function Thinking({ reduced }: { reduced: boolean }) {
  const t = useT();
  if (reduced) return <p className="ask-thinking">{t('ask.thinking')}</p>;
  return (
    <p className="ask-thinking">
      <span className="ask-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span className="sr-only">{t('ask.thinking')}</span>
    </p>
  );
}

function AnswerBody({ r }: { r: AskResult }) {
  const t = useT();
  return (
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
  );
}
