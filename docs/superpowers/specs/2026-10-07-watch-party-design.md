# Watch party: video queue, polls, chat reactions and scoreboard

Date: 2026-10-07

## Purpose

The host plays videos and clips one after another and discusses each with guests and viewers. The
Party template today has a shared video, emoji buttons and a winner celebration. This makes it a
whole format: a queue to run the show from, graphics that say what is playing, and three ways for
viewers and guests to take part.

Success: the host lines up files and links before the show, steps through them from the Party tab,
runs a poll that viewers answer in chat, sees chat emoji land on the stream, keeps score for the
people on stage, and ends with the trophy for the leader.

## Decisions made with the user

| Question | Decision |
|---|---|
| What is watched | Videos and clips, from a queue |
| Sources | Video files and web links |
| Extras | Now playing and up next, polls, chat reactions, scoreboard and winner |

## The queue

- Items: `{ id, kind: 'file' | 'link', title, url }`, at most 30. A link's `url` is an http(s)
  address; a file's is empty.
- Files (MP4, WebM) are not uploaded. The browser keeps each picked `File` in memory, keyed by item
  id. After a reload the queue is still there, and a file item shows **Choose file again**.
- A file plays through one `PartyPlayer`: a video element whose picture and sound are published to
  the room as the existing "clip" source, so it goes on stage, guests see it, and it is in the
  program mix. Controls: play, pause, seek, restart, volume (a gain node, so the level on the
  stream changes too), stop, next.
- A link opens in its own window for screen share, like a news source. The studio cannot control or
  see inside it.
- **Auto-advance** (on by default): when a file ends, an "Up next" card shows for five seconds and
  the next file starts. If the next item is a link, or a file that has to be chosen again, playback
  stops there, because a window cannot be opened without a click.

## On screen

All of it is drawn by `graphics/party.ts` from `scene.party`, on every client.

- **Now playing bar**, along the top beside the WATCH PARTY pill: title, time played and total with
  a progress line, and "Next: …". Links show the title only.
  Progress is not saved every second. The scene holds `{ duration, startedAt, pausedAt }` and each
  client works the position out from its own clock.
- **Up next card**, centred, while `upNextUntil` is in the future.
- **Poll card**, right side: the question, a bar per answer with its number, percentage and count.
  A closed poll highlights the leading answer.
- **Leaderboard card**, left side: names by points, the leader marked.
- **Hype meter**, right edge: a bar from 0 to 100.
- **Reactions**: emoji from the latest burst rise from the bottom edge for four seconds.

## Polls

- `{ id, question, options[2..4], hand[], chat[], open, show }`. `hand` are votes the host added;
  `chat` are votes counted from chat. The count for an answer is their sum.
- A chat message that is only a number from 1 to the number of answers (optionally with `!` or `#`
  in front) is a vote. One vote per viewer per poll (platform and author); a later vote replaces the
  earlier one. The voter list is in the host's browser, so a host reload forgets who voted but keeps
  the counts.
- Close stops counting; Hide takes the card off; a new poll replaces the old one.

## Chat reactions

- Emoji are picked out of each new chat message, at most three per message.
- Every two seconds the host's studio sends one burst (at most twelve emoji) and a new hype level.
  Hype rises by eight for each reaction and falls by a fifth every two seconds.
- The host's reaction buttons add to the same burst and meter, so the feature works with no chat.

## Scoreboard

- Up to eight `{ name, points }`. Add everyone on stage in one click, or type a name.
- +1, +5 and −1 per person. Show or hide the leaderboard.
- **Celebrate leader** plays the existing winner celebration with the leader's name. With a tie it
  names the first of the tied.

## Limits the host should know

Poll votes and chat reactions use the comments the studio already reads: only while live, from
Twitch (any Twitch destination) and from YouTube when connected with one click (needs a Google
OAuth app). Hand votes and the host's reaction buttons need none of that.

## Compatibility and errors

- `scene.party` has a default, so older scenes parse unchanged.
- A file the browser cannot play shows "This file could not be played" on its queue row and playback
  stays stopped.
- If the pop-up for a link is blocked, a message says to allow pop-ups for the studio.

## Testing

- Unit: queue transitions; next-item choice; playback position while playing, paused and after a
  seek; vote parsing; one vote per viewer; poll leader; emoji extraction; hype rise and decay;
  scoreboard limits and leader; older scenes parse.
- End to end: add a link and a file, play the file, pause, next; run a poll with hand votes; add
  scores and celebrate the leader; the scene saved by the API holds all of it.

## Out of scope

Uploading video files, controlling YouTube playback from the studio, viewer votes on platforms
other than Twitch and YouTube, and per-viewer scores.
