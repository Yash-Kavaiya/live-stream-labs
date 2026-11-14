import { DEFAULT_QUIZ, MAX_QUIZ_BANK, QUIZ_LEVELS, QUIZ_OPTIONS, type Quiz } from '@studio/shared';
import { Button, Icon, Spinner } from '@studio/ui';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import type { ClassNav, ClassRequest } from '../class-ink';
import { WaitingForStudio } from './board-window';
import { useClassChannel } from './channel';
import { CAPTION_LANGUAGES, captionFileText, captionsSupported, useLiveCaptions } from './live-captions';

const LETTERS = ['A', 'B', 'C', 'D'];
const COUNTS = [3, 5, 8, 10];
const LEVEL_LABELS: Record<(typeof QUIZ_LEVELS)[number], string> = { easy: 'Easy', mixed: 'Mixed', hard: 'Hard' };

/** Remembered in this browser, so a reload or a closed window does not lose the class so far. */
function useStoredText(key: string): [string, (next: string | ((prev: string) => string)) => void] {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(key, text);
      } catch {
        // Storage full or blocked; the transcript still works for this session.
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [key, text]);
  return [text, setText];
}

/**
 * One question in the bank. Edits are kept here while typing (the round trip through the studio
 * would otherwise drop keystrokes) and sent on every change.
 */
function QuestionCard({
  quiz,
  index,
  onAir,
  onChange,
  onShow,
  onDelete,
}: {
  quiz: Quiz;
  index: number;
  onAir: boolean;
  onChange(quiz: Quiz): void;
  onShow(): void;
  onDelete(): void;
}) {
  const [draft, setDraft] = useState(quiz);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(quiz);
  }, [quiz]);
  const change = (next: Quiz) => {
    setDraft(next);
    onChange(next);
  };
  const ready = draft.question.trim() && draft.answer !== null && draft.options[draft.answer]?.trim();

  return (
    <article
      className={`quiz-card ${onAir ? 'on-air' : ''}`}
      onFocus={() => (editing.current = true)}
      onBlur={() => (editing.current = false)}
      data-testid="quiz-card"
    >
      <div className="quiz-card-head">
        <span className="quiz-num">{index + 1}</span>
        <textarea
          className="quiz-question"
          rows={2}
          maxLength={160}
          value={draft.question}
          placeholder="Question"
          onChange={(e) => change({ ...draft, question: e.target.value })}
          aria-label={`Question ${index + 1}`}
        />
      </div>
      <div className="quiz-options">
        {Array.from({ length: QUIZ_OPTIONS }, (_, i) => (
          <label key={i} className={`quiz-option ${draft.answer === i ? 'right' : ''}`}>
            <input
              type="radio"
              name={`answer-${index}`}
              checked={draft.answer === i}
              onChange={() => change({ ...draft, answer: i })}
              aria-label={`Option ${LETTERS[i]} is right`}
            />
            <span className="quiz-letter">{LETTERS[i]}</span>
            <input
              className="quiz-option-text"
              maxLength={60}
              value={draft.options[i] ?? ''}
              placeholder={`Option ${LETTERS[i]}`}
              onChange={(e) => change({ ...draft, options: draft.options.map((o, n) => (n === i ? e.target.value : o)) })}
            />
          </label>
        ))}
      </div>
      <div className="quiz-card-actions">
        {onAir ? (
          <span className="chip live">
            <Icon name="sensors" /> On stream
          </span>
        ) : (
          <Button variant="tonal" icon="cast" disabled={!ready} onClick={onShow} data-testid="quiz-show">
            Put on stream
          </Button>
        )}
        <span className="grow" />
        <button type="button" className="ink-tool" onClick={onDelete} aria-label={`Delete question ${index + 1}`} title="Delete question">
          <Icon name="delete" />
        </button>
      </div>
    </article>
  );
}

/** The quiz in its own window: a transcript of the class, AI-written questions, and running the quiz on air. */
export function QuizWindow() {
  const broadcastId = useParams().id!;
  const { state, lost, send } = useClassChannel(broadcastId);
  const [transcript, setTranscript] = useStoredText(`class-transcript:${broadcastId}`);
  const [lang, setLang] = useState(() => CAPTION_LANGUAGES.find((l) => l.id === navigator.language)?.id ?? 'en-US');
  const [count, setCount] = useState(5);
  const [level, setLevel] = useState<(typeof QUIZ_LEVELS)[number]>('mixed');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const transcriptBox = useRef<HTMLTextAreaElement>(null);
  const captions = useLiveCaptions(lang, (phrase) => setTranscript((prev) => (prev ? `${prev} ${phrase}` : phrase)));

  useEffect(() => {
    document.title = 'Quiz';
  }, []);

  // Follow the newest words while captions run, unless the teacher is editing.
  useEffect(() => {
    const box = transcriptBox.current;
    if (box && captions.listening && document.activeElement !== box) box.scrollTop = box.scrollHeight;
  }, [transcript, captions.interim, captions.listening]);

  if (!state) return <WaitingForStudio lost={lost} what="quiz" />;

  const c = state.scene.classroom;
  const bank = c.quizBank;
  const onAir = state.scene.template === 'classroom' && c.view === 'quiz';
  const words = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;
  const nav = (patch: ClassNav) => send({ type: 'nav', patch } satisfies ClassRequest);

  const setBank = (next: Quiz[], extra: ClassNav = {}) => nav({ quizBank: next.slice(0, MAX_QUIZ_BANK), ...extra });
  const show = (i: number) => nav({ quiz: { ...bank[i]!, revealed: false }, quizPick: i, view: 'quiz' });
  const edit = (i: number, quiz: Quiz) => {
    const next = bank.map((q, n) => (n === i ? quiz : q));
    // Editing the question on air changes it on air too, with the answer hidden again.
    setBank(next, c.quizPick === i ? { quiz: { ...quiz, revealed: false } } : {});
  };
  const remove = (i: number) => {
    const next = bank.filter((_, n) => n !== i);
    setBank(next, { quizPick: c.quizPick === i ? -1 : c.quizPick > i ? c.quizPick - 1 : c.quizPick });
  };

  const generate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const room = MAX_QUIZ_BANK - bank.length;
      const result = await api.generateQuiz(broadcastId, { transcript, count: Math.min(count, room), level });
      setBank([...bank, ...result.questions]);
      setMessage({ kind: 'info', text: `${result.questions.length} question${result.questions.length === 1 ? '' : 's'} written by ${result.model}. Check them before they go on stream.` });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not write questions' });
    } finally {
      setBusy(false);
    }
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    const raw = await file.text();
    const text = /\.(vtt|srt)$/i.test(file.name) ? captionFileText(raw) : raw.replace(/\s+/g, ' ').trim();
    setTranscript((prev) => (prev ? `${prev} ${text}` : text).slice(-60_000));
    if (fileInput.current) fileInput.current.value = '';
  };

  const live = c.quiz;
  const canReveal = live.answer !== null && !!live.options[live.answer]?.trim() && !!live.question.trim();
  const room = MAX_QUIZ_BANK - bank.length;

  return (
    <div className="class-window" data-testid="quiz-window">
      <header className="class-window-bar">
        <Icon name="quiz" />
        <span className="title-medium">Quiz</span>
        <span className="grow" />
        {state.scene.template !== 'classroom' && <span className="body-small muted">Switch the studio to the Classroom template to show the quiz.</span>}
      </header>

      <main className="quiz-main">
        <section className="quiz-panel">
          <div className="quiz-panel-head">
            <h2 className="title-small">Transcript</h2>
            <span className="body-small muted" data-testid="quiz-words">
              {words} words
            </span>
          </div>
          {captionsSupported() ? (
            <div className="row wrap" style={{ gap: 8 }}>
              {captions.listening ? (
                <Button danger icon="stop_circle" onClick={captions.stop} data-testid="captions-stop">
                  Stop captions
                </Button>
              ) : (
                <Button icon="mic" onClick={captions.start} data-testid="captions-start">
                  Start live captions
                </Button>
              )}
              <select className="quiz-select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language spoken">
                {CAPTION_LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
              {captions.listening && (
                <span className="quiz-listening">
                  <span className="quiz-pulse" /> Listening
                </span>
              )}
            </div>
          ) : (
            <p className="body-small muted">Live captions need Chrome or Edge. You can still paste or upload a transcript.</p>
          )}
          {captions.error && <p className="class-window-error body-small">{captions.error}</p>}
          <div className="quiz-transcript">
            <textarea
              ref={transcriptBox}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value.slice(-60_000))}
              placeholder="Your words appear here as you teach. You can also paste lesson notes or a transcript."
              aria-label="Transcript"
              data-testid="quiz-transcript"
            />
            {captions.interim && <p className="quiz-interim">{captions.interim}…</p>}
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <input ref={fileInput} type="file" accept=".txt,.vtt,.srt,text/plain,text/vtt" hidden onChange={(e) => void loadFile(e.target.files?.[0])} />
            <Button variant="text" icon="upload_file" onClick={() => fileInput.current?.click()}>
              Add a .txt, .vtt or .srt
            </Button>
            <Button variant="text" icon="delete_sweep" disabled={!transcript} onClick={() => setTranscript('')}>
              Clear
            </Button>
          </div>
          <p className="body-small muted">
            Captions hear this computer’s microphone only, and the browser sends the audio to its speech service. Keep this window open while
            they run.
          </p>

          <div className="quiz-generate">
            <h2 className="title-small">Write questions with AI</h2>
            <div className="row wrap" style={{ gap: 8 }}>
              <div className="segmented" role="group" aria-label="How many">
                {COUNTS.map((n) => (
                  <button key={n} type="button" aria-pressed={count === n} onClick={() => setCount(n)}>
                    {n}
                  </button>
                ))}
              </div>
              <div className="segmented" role="group" aria-label="Level">
                {QUIZ_LEVELS.map((l) => (
                  <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}>
                    {LEVEL_LABELS[l]}
                  </button>
                ))}
              </div>
            </div>
            <Button icon="auto_awesome" disabled={busy || words < 15 || room === 0} onClick={() => void generate()} data-testid="quiz-generate">
              {busy ? 'Writing questions…' : `Write ${Math.min(count, Math.max(room, 1))} questions`}
            </Button>
            {busy && (
              <span className="row body-small muted" style={{ gap: 8 }}>
                <Spinner /> This can take up to a minute.
              </span>
            )}
            {words < 15 && <span className="body-small muted">Teach for a minute or paste some text first.</span>}
            {room === 0 && <span className="body-small muted">The bank is full ({MAX_QUIZ_BANK}). Delete some questions first.</span>}
            {message && (
              <p className={message.kind === 'error' ? 'class-window-error body-small' : 'body-small muted'} data-testid="quiz-message">
                {message.text}
              </p>
            )}
          </div>
        </section>

        <section className="quiz-panel quiz-bank">
          <div className="quiz-panel-head">
            <h2 className="title-small">Questions</h2>
            <span className="body-small muted">
              {bank.length} of {MAX_QUIZ_BANK}
            </span>
            <span className="grow" />
            <Button variant="text" icon="add" disabled={room === 0} onClick={() => setBank([...bank, DEFAULT_QUIZ])} data-testid="quiz-add">
              Add your own
            </Button>
          </div>
          {bank.length === 0 ? (
            <div className="quiz-empty">
              <Icon name="auto_awesome" />
              <p className="body-medium muted">Write questions with AI from the transcript, or add your own. Pick the right answer, then put one on stream.</p>
            </div>
          ) : (
            <div className="quiz-list">
              {bank.map((quiz, i) => (
                <QuestionCard
                  key={i}
                  quiz={quiz}
                  index={i}
                  onAir={onAir && c.quizPick === i}
                  onChange={(q) => edit(i, q)}
                  onShow={() => show(i)}
                  onDelete={() => remove(i)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="class-window-bar">
        <span className="label-large muted">On stream</span>
        <span className="body-medium truncate grow" data-testid="quiz-live">
          {onAir ? live.question || 'No question yet' : 'The quiz is not on stream'}
        </span>
        {onAir && (
          <>
            {live.revealed ? (
              <Button variant="tonal" icon="visibility_off" onClick={() => nav({ quiz: { ...live, revealed: false } })}>
                Hide answer
              </Button>
            ) : (
              <Button
                icon="visibility"
                disabled={!canReveal}
                onClick={() => {
                  nav({ quiz: { ...live, revealed: true } });
                  send({ type: 'celebrate' });
                }}
                data-testid="quiz-reveal-window"
              >
                Reveal answer
              </Button>
            )}
            <Button variant="tonal" icon="skip_next" disabled={c.quizPick < 0 || c.quizPick >= bank.length - 1} onClick={() => show(c.quizPick + 1)} data-testid="quiz-next">
              Next question
            </Button>
          </>
        )}
        {!onAir && state.scene.template === 'classroom' && (
          <Button variant="tonal" icon="cast" onClick={() => nav({ view: 'quiz' })}>
            Show quiz on stream
          </Button>
        )}
      </footer>
    </div>
  );
}
