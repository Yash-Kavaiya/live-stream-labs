// A local RTMP server that stands in for YouTube/Twitch/etc. during development and e2e tests.
// Stream to rtmp://localhost:1935/live/<any-key>; watch with: ffplay rtmp://localhost:1935/live/<key>
import NodeMediaServer from 'node-media-server';

const port = Number(process.env.MOCK_RTMP_PORT ?? 1935);
const server = new NodeMediaServer({
  logType: 1,
  rtmp: { port, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 },
});

server.on('postPublish', (_id, streamPath) => console.log(`[mock-rtmp] receiving ${streamPath}`));
server.on('donePublish', (_id, streamPath) => console.log(`[mock-rtmp] ended ${streamPath}`));
server.run();
console.log(`[mock-rtmp] listening on rtmp://localhost:${port}/live/<key>`);
