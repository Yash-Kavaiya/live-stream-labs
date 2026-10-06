import { useEffect, useRef, useState } from 'react';
import { fetchAllBalls, fetchCards, fetchCommentaryPage, fetchScoreboard, mergeBalls, type Ball, type InningsCard, type Scoreboard } from './cricket-feed';

const REFRESH_MS = 5000;
/** The full scorecard is a large download, so it refreshes this often unless a card layout is showing. */
const CARDS_EVERY = 4;

export interface LiveData {
  scoreboard: Scoreboard | null;
  balls: Ball[];
  cards: InningsCard[];
  /** When the feed last answered. */
  updatedAt: number | null;
  /** Why the latest refresh failed; the last good data stays on screen. */
  error: string | null;
}

const EMPTY: LiveData = { scoreboard: null, balls: [], cards: [], updatedAt: null, error: null };

/** Follows one match, asking the feed again every five seconds. */
export function useLiveMatch(league: string, event: string, cardsOnScreen: boolean): LiveData {
  const [data, setData] = useState<LiveData>(EMPTY);
  const wantCards = useRef(cardsOnScreen);
  wantCards.current = cardsOnScreen;

  useEffect(() => {
    if (!league || !event) return;
    setData(EMPTY);
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let balls: Ball[] = [];
    let pageCount = 0;
    let tick = 0;

    const refresh = async () => {
      try {
        const scoreboard = await fetchScoreboard(league, event, abort.signal);
        if (pageCount === 0) {
          const all = await fetchAllBalls(league, event, abort.signal);
          balls = all.balls;
          pageCount = all.pageCount;
        } else {
          // New balls land on the last page; when it fills up a new page starts.
          let page = await fetchCommentaryPage(league, event, pageCount, abort.signal);
          balls = mergeBalls(balls, page.balls);
          while (page.pageCount > pageCount) {
            pageCount += 1;
            page = await fetchCommentaryPage(league, event, pageCount, abort.signal);
            balls = mergeBalls(balls, page.balls);
          }
        }
        const cards = wantCards.current || tick % CARDS_EVERY === 0 ? await fetchCards(league, event, balls, abort.signal) : null;
        setData((current) => ({ scoreboard: scoreboard ?? current.scoreboard, balls, cards: cards ?? current.cards, updatedAt: Date.now(), error: null }));
      } catch (err) {
        if (abort.signal.aborted) return;
        setData((current) => ({ ...current, error: err instanceof Error ? err.message : 'The score feed could not be reached' }));
      }
      tick += 1;
      if (!abort.signal.aborted) timer = setTimeout(() => void refresh(), REFRESH_MS);
    };
    void refresh();

    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [league, event]);

  return data;
}
