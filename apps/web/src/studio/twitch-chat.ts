import type { CommentDto } from '@studio/shared';

const PRIVMSG = /^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\w+ :(.*)$/;

export function parseTwitchLine(line: string): Pick<CommentDto, 'author' | 'text'> | null {
  const match = PRIVMSG.exec(line);
  if (!match) return null;
  const displayName = /(?:^|;)display-name=([^;]*)/.exec(match[1] ?? '')?.[1];
  return { author: displayName || match[2]!, text: match[3]!.trim() };
}

/**
 * Reads a public Twitch channel's chat straight from the browser. Twitch allows anonymous
 * read-only IRC connections, so this needs no token and puts no load on our servers.
 * Returns a function that disconnects.
 */
export function watchTwitchChat(channel: string, onComment: (comment: CommentDto) => void): () => void {
  let closed = false;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let counter = 0;

  const connect = () => {
    socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    socket.onopen = () => {
      socket!.send('CAP REQ :twitch.tv/tags');
      socket!.send(`NICK justinfan${Math.floor(10_000 + Math.random() * 80_000)}`);
      socket!.send(`JOIN #${channel.toLowerCase().replace(/^#/, '')}`);
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      for (const line of event.data.split('\r\n')) {
        if (line.startsWith('PING')) socket!.send(line.replace('PING', 'PONG'));
        const parsed = parseTwitchLine(line);
        if (!parsed) continue;
        onComment({
          ...parsed,
          id: `twitch-${Date.now()}-${counter++}`,
          platform: 'twitch',
          at: new Date().toISOString(),
        });
      }
    };
    socket.onclose = () => {
      if (!closed) retry = setTimeout(connect, 5000);
    };
  };
  connect();

  return () => {
    closed = true;
    clearTimeout(retry);
    socket?.close();
  };
}
