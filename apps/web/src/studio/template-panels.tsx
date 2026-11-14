import {
  agendaItems,
  CLASS_VIEWS,
  DEFAULT_QUIZ,
  NEWS_VIEWS,
  QUIZ_OPTIONS,
  type Classroom,
  type ClassView,
  type News,
  type NewsView,
  type Quiz,
  type Scene,
  type TemplateId,
} from '@studio/shared';
import { Button, Icon, IconButton, TextField } from '@studio/ui';
import { openClassWindow } from './class-ink';
import { CleanControls } from './clean-controls';
import { PartyPanel } from './party/party-panel';
import type { PartyControls } from './party/use-party';
import { RundownPanel } from './rundown/rundown-panel';
import type { RundownState } from './rundown/use-rundown';

type SceneUpdater = (change: (scene: Scene) => Scene) => void;
interface Props {
  scene: Scene;
  update: SceneUpdater;
}

// ---------- News room ----------

const NEWS_VIEW_INFO: Record<NewsView, { label: string; icon: string; hint: string }> = {
  anchor: { label: 'Anchor', icon: 'person', hint: 'One presenter with the story points beside them. Guests on stage take the side column.' },
  interview: { label: 'Interview', icon: 'group', hint: 'Everyone side by side in equal boxes.' },
  panel: { label: 'Panel', icon: 'grid_view', hint: 'A grid of everyone on stage, for a discussion.' },
  headline: { label: 'Headline', icon: 'campaign', hint: 'The headline fills the frame; the presenter sits in the corner.' },
};

function NewsControls({ scene, update }: Props) {
  const { news } = scene;
  const set = (patch: Partial<News>) => update((s) => ({ ...s, news: { ...s.news, ...patch } }));

  return (
    <section className="col">
      <h3 className="title-small">News scenes</h3>
      <div className="screen-grid" role="group" aria-label="News scene">
        {NEWS_VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            className="screen-button"
            aria-pressed={news.view === view}
            data-testid={`news-${view}`}
            onClick={() => set({ view })}
          >
            <Icon name={NEWS_VIEW_INFO[view].icon} />
            <span className="label-medium">{NEWS_VIEW_INFO[view].label}</span>
          </button>
        ))}
      </div>
      <p className="body-small muted">{NEWS_VIEW_INFO[news.view].hint}</p>

      <div className="field-pair">
        <TextField label="Channel name" value={news.channel} onValue={(channel) => set({ channel })} maxLength={24} />
        <TextField label="Tag" value={news.tag} onValue={(tag) => set({ tag })} maxLength={16} placeholder="BREAKING" />
      </div>
      <TextField label="Headline" value={news.headline} onValue={(headline) => set({ headline })} maxLength={90} data-testid="news-headline-text" />
      <TextField label="Second line" value={news.subhead} onValue={(subhead) => set({ subhead })} maxLength={120} />
      <TextField
        label="Story points (one per line)"
        type="textarea"
        rows={3}
        value={news.points}
        onValue={(points) => set({ points })}
        maxLength={300}
        supportingText="Shown beside the presenter in the Anchor scene."
      />
      <p className="body-small muted">
        A lower third from the Banners tab replaces the headline while it is showing. Name tags,
        social handles and calls to action sit above the headline, and a ticker runs along the
        bottom strip.
      </p>
    </section>
  );
}

// ---------- Classroom ----------

const CLASS_VIEW_INFO: Record<ClassView, { label: string; icon: string; hint: string }> = {
  lecture: { label: 'Lecture', icon: 'co_present', hint: 'You on camera with the lesson plan beside you. Guests on stage take the side column.' },
  slides: { label: 'Slides', icon: 'slideshow', hint: 'Your slide deck (or a shared screen, clip or image) fills the frame; cameras sit in a column at the side.' },
  board: { label: 'Board', icon: 'edit_note', hint: 'The whiteboard you draw on in the whiteboard window, with cameras in a column at the side.' },
  quiz: { label: 'Quiz', icon: 'quiz', hint: 'A multiple-choice question. Reveal the answer once the class has had a go.' },
};

const LETTERS = ['A', 'B', 'C', 'D'];

/** The lesson plan, and stepping through it while teaching. */
function LessonControls({ classroom, set }: { classroom: Classroom; set(patch: Partial<Classroom>): void }) {
  const items = agendaItems(classroom);
  const step = Math.max(0, Math.min(classroom.step, items.length - 1));

  return (
    <>
      <div className="field-pair">
        <TextField label="Course" value={classroom.course} onValue={(course) => set({ course })} maxLength={32} placeholder="Physics 101" />
        <TextField label="Lesson" value={classroom.lesson} onValue={(lesson) => set({ lesson })} maxLength={80} placeholder="Newton’s laws" data-testid="class-lesson" />
      </div>
      <TextField
        label="Lesson plan (one part per line)"
        type="textarea"
        rows={4}
        value={classroom.agenda}
        onValue={(agenda) => set({ agenda })}
        maxLength={400}
        supportingText="Shown along the bottom of every scene, with the part you are on lit up."
        data-testid="class-agenda"
      />
      {items.length > 0 && (
        <div className="row" style={{ alignItems: 'center' }}>
          <Button variant="tonal" icon="chevron_left" disabled={step === 0} onClick={() => set({ step: step - 1 })} data-testid="class-prev">
            Back
          </Button>
          <span className="body-medium grow truncate" style={{ textAlign: 'center' }} data-testid="class-step">
            {step + 1} of {items.length}: {items[step]}
          </span>
          <Button variant="tonal" icon="chevron_right" disabled={step >= items.length - 1} onClick={() => set({ step: step + 1 })} data-testid="class-next">
            Next
          </Button>
        </div>
      )}
    </>
  );
}

/** The question, its options, which one is right, and showing that on screen. */
function QuizControls({ quiz, setQuiz, celebrate }: { quiz: Quiz; setQuiz(patch: Partial<Quiz>): void; celebrate(): void }) {
  const canReveal = quiz.answer !== null && !!quiz.options[quiz.answer]?.trim();
  const setOption = (index: number, text: string) => setQuiz({ options: quiz.options.map((o, i) => (i === index ? text : o)), revealed: false });

  return (
    <>
      <h3 className="title-small">Quiz</h3>
      <TextField
        label="Question"
        type="textarea"
        rows={2}
        value={quiz.question}
        onValue={(question) => setQuiz({ question, revealed: false })}
        maxLength={160}
        data-testid="quiz-question"
      />
      <div className="field-pair">
        {Array.from({ length: QUIZ_OPTIONS }, (_, i) => (
          <TextField key={i} label={`Option ${LETTERS[i]}`} value={quiz.options[i] ?? ''} onValue={(text) => setOption(i, text)} maxLength={60} data-testid={`quiz-option-${LETTERS[i]}`} />
        ))}
      </div>
      <span className="body-medium">Right answer</span>
      <div className="segmented" role="group" aria-label="Right answer" style={{ display: 'flex' }}>
        {LETTERS.map((letter, i) => (
          <button
            key={letter}
            type="button"
            className="grow"
            style={{ justifyContent: 'center' }}
            aria-pressed={quiz.answer === i}
            data-testid={`quiz-answer-${letter}`}
            onClick={() => setQuiz({ answer: quiz.answer === i ? null : i, revealed: false })}
          >
            {letter}
          </button>
        ))}
      </div>
      <div className="row wrap">
        {quiz.revealed ? (
          <Button variant="tonal" icon="visibility_off" onClick={() => setQuiz({ revealed: false })} data-testid="quiz-reveal">
            Hide answer
          </Button>
        ) : (
          <Button
            variant="tonal"
            icon="visibility"
            disabled={!canReveal}
            onClick={() => {
              setQuiz({ revealed: true });
              celebrate();
            }}
            data-testid="quiz-reveal"
          >
            Reveal answer
          </Button>
        )}
        <Button variant="text" danger icon="restart_alt" onClick={() => setQuiz(DEFAULT_QUIZ)} data-testid="quiz-clear">
          New question
        </Button>
      </div>
      <p className="body-small muted">Empty options are left off the screen. Pick the right answer before revealing it.</p>
    </>
  );
}

function ClassroomControls({ scene, update, broadcastId }: Props & { broadcastId: string }) {
  const c = scene.classroom;
  const set = (patch: Partial<Classroom>) => update((s) => ({ ...s, classroom: { ...s.classroom, ...patch } }));
  const setQuiz = (patch: Partial<Quiz>) => update((s) => ({ ...s, classroom: { ...s.classroom, quiz: { ...s.classroom.quiz, ...patch } } }));
  const celebrate = () =>
    update((s) => ({
      ...s,
      celebration: { id: Math.random().toString(36).slice(2, 12), kind: 'reaction', emoji: '🎉', text: '', at: Date.now() },
    }));

  return (
    <section className="col">
      <h3 className="title-small">Class scenes</h3>
      <div className="screen-grid" role="group" aria-label="Class scene">
        {CLASS_VIEWS.map((view) => (
          <button key={view} type="button" className="screen-button" aria-pressed={c.view === view} data-testid={`class-${view}`} onClick={() => set({ view })}>
            <Icon name={CLASS_VIEW_INFO[view].icon} />
            <span className="label-medium">{CLASS_VIEW_INFO[view].label}</span>
          </button>
        ))}
      </div>
      <p className="body-small muted">{CLASS_VIEW_INFO[c.view].hint}</p>

      <h3 className="title-small">Lesson</h3>
      <LessonControls classroom={c} set={set} />

      <h3 className="title-small">Slides</h3>
      <div className="class-launch">
        <Button icon="slideshow" onClick={() => openClassWindow(broadcastId, 'slides')} data-testid="open-slides">
          Open slides window
        </Button>
        {c.slides.length > 0 && (
          <div className="row" style={{ alignItems: 'center', gap: 4 }}>
            <IconButton icon="chevron_left" label="Previous slide" disabled={c.slide === 0} onClick={() => set({ slide: c.slide - 1 })} />
            <span className="body-medium" data-testid="class-slide">
              Slide {Math.min(c.slide, c.slides.length - 1) + 1} of {c.slides.length}
            </span>
            <IconButton icon="chevron_right" label="Next slide" disabled={c.slide >= c.slides.length - 1} onClick={() => set({ slide: c.slide + 1 })} />
          </div>
        )}
      </div>
      <p className="body-small muted">
        {c.slides.length > 0
          ? 'The Slides scene shows the deck, with cameras in a column at the side. Write on a slide in the slides window.'
          : 'Upload a PDF or images in the slides window. Without a deck, the Slides scene shows whatever you share on stage.'}
      </p>

      <h3 className="title-small">Whiteboard</h3>
      <div className="class-launch">
        <Button icon="draw" onClick={() => openClassWindow(broadcastId, 'board')} data-testid="open-board">
          Open whiteboard
        </Button>
        <span className="body-medium muted">
          Page {c.boardPage + 1} of {c.boardPages}
        </span>
      </div>
      <p className="body-small muted">
        Draw, write and add shapes in the whiteboard window; the Board scene shows it on stream as you draw. Keep the studio
        open while you use it.
      </p>
      <TextField
        label="Typed notes on the first page"
        type="textarea"
        rows={4}
        value={c.board}
        onValue={(board) => set({ board })}
        maxLength={600}
        supportingText={'One note per line. Start a line with "- " for a bullet.'}
        data-testid="class-notes"
      />

      <h3 className="title-small">Quiz with AI</h3>
      <div className="class-launch">
        <Button icon="auto_awesome" onClick={() => openClassWindow(broadcastId, 'quiz')} data-testid="open-quiz">
          Open quiz window
        </Button>
        {c.quizBank.length > 0 && <span className="body-medium muted">{c.quizBank.length} questions ready</span>}
      </div>
      <p className="body-small muted">
        Live captions turn what you say into a transcript, and AI writes questions from it. Edit them, then put one on stream at a time.
      </p>

      <QuizControls quiz={c.quiz} setQuiz={setQuiz} celebrate={celebrate} />
    </section>
  );
}

// ---------- Watch party ----------

/** The studio tab that belongs to each template. */
export const TEMPLATE_PAGES: Record<TemplateId, { label: string; icon: string }> = {
  none: { label: 'Layout', icon: 'view_quilt' },
  newsroom: { label: 'News', icon: 'newspaper' },
  classroom: { label: 'Class', icon: 'school' },
  watchparty: { label: 'Party', icon: 'celebration' },
};

/** The page of controls for whichever template is active. The clean look's page is the layout designer. */
export function TemplatePage(props: Props & { broadcastId: string; rundown?: RundownState; party?: PartyControls; stageNames?: string[] }) {
  switch (props.scene.template) {
    case 'none':
      return <CleanControls {...props} />;
    case 'newsroom':
      return (
        <div className="panel-scroll col" style={{ gap: 20 }}>
          {props.rundown && <RundownPanel scene={props.scene} update={props.update} state={props.rundown} />}
          <NewsControls {...props} />
        </div>
      );
    case 'classroom':
      return (
        <div className="panel-scroll col">
          <ClassroomControls {...props} />
        </div>
      );
    case 'watchparty':
      return (
        <div className="panel-scroll col">
          {props.party && <PartyPanel scene={props.scene} update={props.update} party={props.party} stageNames={props.stageNames ?? []} />}
        </div>
      );
  }
}
