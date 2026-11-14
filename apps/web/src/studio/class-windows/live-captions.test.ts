import { describe, expect, it } from 'vitest';
import { captionFileText } from './live-captions';

describe('caption files', () => {
  it('keeps only the words of a .vtt file', () => {
    const vtt = 'WEBVTT\n\nNOTE made by a tool\n\n1\n00:00:01.000 --> 00:00:03.000\n<v Teacher>Plants make <b>glucose</b>\n\n2\n00:00:03.500 --> 00:00:05.000\nfrom sunlight.\n';
    expect(captionFileText(vtt)).toBe('Plants make glucose from sunlight.');
  });
  it('keeps only the words of a .srt file', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:02,000\r\nHello class\r\n\r\n2\r\n00:00:02,500 --> 00:00:04,000\r\ntoday: forces\r\n';
    expect(captionFileText(srt)).toBe('Hello class today: forces');
  });
});
