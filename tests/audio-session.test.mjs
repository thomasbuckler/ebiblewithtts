import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VerseAudioSession, describeAudioFailure } from '../site/bible-audio/audio-session.mjs';
import { createVersePlayer } from '../site/bible-audio/player.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
// A stand-in for the browser's built-in <audio> element. Like a real one, it
// reports pauses as a queued event.
class FakeElement extends EventTarget {
  constructor(playElement) {
    super();
    Object.assign(this, { playElement, paused: true, ended: false, muted: false, currentTime: 0, duration: NaN, error: null, plays: 0, loads: 0, _src: '' });
  }
  get src() { return this._src; }
  set src(value) { this._src = value; this.ended = false; this.currentTime = 0; this.duration = NaN; }
  removeAttribute(name) { if (name === 'src') this._src = ''; }
  load() { this.loads++; this.paused = true; }
  play() {
    this.plays++;
    const result = this.playElement?.(this);
    if (result) return result;
    this.paused = false; this.duration = 10;
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    queueMicrotask(() => this.dispatchEvent(new Event('pause')));
  }
  finish() { this.currentTime = this.duration; this.ended = true; this.paused = true; this.dispatchEvent(new Event('pause')); this.dispatchEvent(new Event('ended')); }
  interrupt() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  resume() { this.paused = false; this.dispatchEvent(new Event('playing')); }
  fail(message) { this.error = { code: 3, message }; this.dispatchEvent(new Event('error')); }
}

function fixture({ fetchAudio, decodeAudioData, startSource, resumeContext, playElement, builtInPlayer = false } = {}) {
  let gesture = false;
  const contexts = [], sources = [], phases = [], advances = [];
  class Context extends EventTarget {
    constructor() { super(); this.state = 'suspended'; this.currentTime = 0; this.resumes = 0; contexts.push(this); }
    resume() {
      assert.equal(gesture, true, 'resume must run directly in the initial user gesture');
      if (resumeContext) resumeContext();
      this.resumes++; this.state = 'running'; return Promise.resolve();
    }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    decodeAudioData(bytes) { return decodeAudioData ? decodeAudioData(bytes) : Promise.resolve({ duration: 10 }); }
    createBufferSource() {
      const context = this;
      const source = {
        buffer: null, onended: null, started: false, connect() {}, disconnect() {},
        start(time, offset) { assert.equal(context.state, 'running'); startSource?.(); this.started = true; this.offset = offset; sources.push(this); },
        stop() { assert.equal(this.started, true, 'do not stop an unstarted source'); queueMicrotask(() => this.onended?.()); },
        finish() { this.onended?.(); },
      };
      return source;
    }
  }
  const fetches = [], elements = [];
  const audio = new VerseAudioSession({
    Context,
    fetchAudio: (url, options) => { fetches.push(url); return (fetchAudio || (async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))(url, options); },
    createElement: builtInPlayer ? () => { const element = new FakeElement(playElement); elements.push(element); return element; } : null,
  });
  let clock = 0, id = 0;
  const timers = new Map();
  const order = ['job:1:1', 'job:1:2', 'job:1:3', 'job:1:4'];
  const tracks = Object.fromEntries(order.map((key, i) => [key, `audio/job/1/${i + 1}.m4a`]));
  const player = createVersePlayer({ audio, tracks, baseURL: 'https://example.org/',
    now: () => clock,
    onState: state => phases.push(state.phase),
    onAdvance: key => { advances.push(key); player.setActive(false); player.setVerse(order[order.indexOf(key) + 1]); player.setActive(true); },
    setTimer: (fn, delay) => { timers.set(++id, { fn, at: clock + delay }); return id; },
    clearTimer: id => timers.delete(id),
  });
  return { audio, player, contexts, sources, phases, advances, fetches, elements,
    async tap() { gesture = true; const result = audio.unlock(); gesture = false; await result; player.retry(); },
    tick(ms) { clock += ms; for (const [id, task] of timers) if (task.at <= clock) { timers.delete(id); task.fn(); } },
  };
}

test('one tap enables three consecutive timer advances without new permission', async () => {
  const f = fixture();
  await f.tap(); f.player.setAuto(true); f.player.setVerse('job:1:1'); await flush();
  for (let verse = 0; verse < 3; verse++) {
    f.sources.at(-1).finish();
    assert.equal(f.player.snapshot().advanceAt, (verse + 1) * 2000);
    f.tick(1999); assert.equal(f.advances.length, verse);
    f.tick(1); await flush();
    assert.equal(f.advances.length, verse + 1);
    assert.equal(f.player.snapshot().phase, 'playing');
  }
  assert.equal(f.sources.length, 4);
  assert.equal(f.contexts.length, 1);
  assert.equal(f.contexts[0].resumes, 1);
  assert.equal(f.phases.includes('blocked'), false);
});

test('diagnostics identify download, response, body-read, and decode failures', async () => {
  const ok = { ok: true, status: 200, headers: new Headers({ 'content-type': 'audio/mp4' }), arrayBuffer: async () => new ArrayBuffer(24) };
  const cases = [
    { stage: 'download', name: 'TypeError', fetchAudio: async () => { throw new TypeError('Failed to fetch'); } },
    { stage: 'download', name: 'Error', status: 403, fetchAudio: async () => ({ ...ok, ok: false, status: 403 }) },
    { stage: 'read', name: 'TypeError', status: 200, fetchAudio: async () => ({ ...ok, arrayBuffer: async () => { throw new TypeError('Body read failed'); } }) },
    { stage: 'decode', name: 'EncodingError', status: 200, fetchAudio: async () => ok, decodeAudioData: async () => { throw new DOMException('Unable to decode audio data', 'EncodingError'); } },
  ];
  for (const item of cases) {
    const f = fixture(item);
    await f.tap(); f.player.setVerse('job:1:1'); await flush();
    assert.equal(f.player.snapshot().phase, 'error');
    assert.equal(f.audio.failure.stage, item.stage);
    assert.equal(f.audio.failure.name, item.name);
    assert.equal(f.audio.failure.status, item.status);
    assert.equal(f.audio.failure.contextState, 'running');
    if (item.stage === 'decode') {
      assert.equal(f.audio.failure.bytes, 24);
      assert.match(describeAudioFailure(f.audio.failure), /Audio decoding failed.*EncodingError.*HTTP 200.*audio\/mp4.*24 bytes/);
    }
    f.player.destroy();
  }
});

test('late rejected decode cannot overwrite the new verse diagnostics', async () => {
  let rejectOld, decodes = 0;
  const f = fixture({ decodeAudioData: () => ++decodes === 1 ? new Promise((_, reject) => { rejectOld = reject; }) : Promise.resolve({ duration: 10 }) });
  await f.tap(); f.player.setVerse('job:1:1'); await flush();
  f.player.setVerse('job:1:2'); await flush();
  rejectOld(new DOMException('Old decode failed', 'EncodingError')); await flush();
  assert.equal(f.player.snapshot().phase, 'playing');
  assert.equal(f.audio.failure, null);
  assert.equal(f.audio.error, null);
});

test('start failure releases the source and a speaker retry really plays', async () => {
  let attempts = 0;
  const f = fixture({ startSource: () => { if (++attempts === 1) throw new DOMException('Could not start', 'InvalidStateError'); } });
  await f.tap(); f.player.setVerse('job:1:1'); await flush();
  assert.equal(f.player.snapshot().phase, 'error');
  assert.equal(f.audio.failure.stage, 'start');
  assert.equal(f.audio.source, null);
  assert.equal(f.audio.paused, true);
  await f.tap(); await flush();
  assert.equal(f.player.snapshot().phase, 'playing');
  assert.equal(f.sources.length, 1);
  assert.equal(f.contexts.length, 1);
  assert.equal(f.audio.failure, null);
});

test('context resume failure is reported instead of becoming a generic permission prompt', async () => {
  let attempts = 0;
  const f = fixture({ resumeContext: () => { if (++attempts === 1) throw new DOMException('Audio device unavailable', 'NotSupportedError'); } });
  f.player.setVerse('job:1:1'); await flush();
  await assert.rejects(f.tap(), { name: 'NotSupportedError' });
  f.player.retry(); await flush();
  assert.equal(f.player.snapshot().phase, 'error');
  assert.equal(f.audio.failure.stage, 'enable');
  assert.equal(f.audio.failure.name, 'NotSupportedError');
  await f.tap(); await flush();
  assert.equal(f.player.snapshot().phase, 'playing');
  assert.equal(f.audio.failure, null);
});

test('diagnostic display does not include response bodies or URLs from exceptions', () => {
  const message = describeAudioFailure({ stage: 'download', name: 'TypeError', message: 'Failed at https://example.org/audio?token=private\nagain' });
  assert.equal(message.includes('token'), false);
  assert.equal(message.includes('\n'), false);
  assert.match(message, /\[URL\]/);
});

test('first blocked attempt recovers with one real enable tap', async () => {
  const f = fixture();
  f.player.setVerse('job:1:1'); await flush();
  assert.equal(f.player.snapshot().phase, 'blocked');
  await f.tap(); await flush();
  assert.equal(f.player.snapshot().phase, 'playing');
  f.player.setVerse('job:1:2'); await flush();
  assert.equal(f.player.snapshot().phase, 'playing');
  assert.equal(f.contexts[0].resumes, 1);
});

test('intentional stop and stale ended callbacks never advance a new verse', async () => {
  const f = fixture(); await f.tap(); f.player.setAuto(true); f.player.setVerse('job:1:1'); await flush();
  const oldEnd = f.sources[0].onended;
  f.player.setVerse('job:1:2'); oldEnd(); await flush(); f.tick(3000);
  assert.deepEqual(f.advances, []);
  assert.equal(f.player.snapshot().phase, 'playing');
});

test('late decoded audio is discarded after a quick verse change', async () => {
  let finishOld, decodes = 0;
  const f = fixture({ decodeAudioData: () => ++decodes === 1 ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve({ duration: 10 }) });
  await f.tap(); f.player.setVerse('job:1:1'); await flush();
  f.player.setVerse('job:1:2'); await flush();
  finishOld({ duration: 20 }); await flush();
  assert.equal(f.sources.length, 1);
  assert.equal(f.audio.currentSrc, 'https://example.org/audio/job/1/2.m4a');
  assert.equal(f.audio.buffer.duration, 10);
});

test('mute leaves the completion clock running across auto-advance', async () => {
  const f = fixture(); await f.tap(); f.player.setAuto(true); f.player.setVerse('job:1:1'); await flush();
  f.player.setMuted(true);
  assert.equal(f.audio.gain.gain.value, 0);
  f.sources[0].finish(); f.tick(2000); await flush();
  assert.equal(f.player.snapshot().phase, 'playing');
  assert.equal(f.audio.gain.gain.value, 0);
  f.player.setMuted(false); assert.equal(f.audio.gain.gain.value, 1);
});

test('pause/resume keeps the offset and the same unlocked context', async () => {
  const f = fixture(); await f.tap(); f.player.setVerse('job:1:1'); await flush();
  f.contexts[0].currentTime = 3;
  f.player.setActive(false); await flush();
  f.player.setActive(true); await flush();
  assert.equal(f.sources[1].offset, 3);
  assert.equal(f.contexts.length, 1);
  assert.equal(f.contexts[0].resumes, 1);
});

const cannotDecode = () => Promise.reject(new DOMException('Unable to decode audio data', 'EncodingError'));

test('a recording Web Audio cannot decode plays through the built-in player', async () => {
  const f = fixture({ decodeAudioData: cannotDecode, builtInPlayer: true });
  await f.tap(); f.player.setVerse('job:1:1'); await flush();
  assert.equal(f.player.snapshot().phase, 'playing');
  assert.equal(f.audio.useElement, true);
  assert.equal(f.elements.length, 1);
  assert.equal(f.elements[0].src, 'https://example.org/audio/job/1/1.m4a');
  assert.equal(f.audio.failure, null);
  // Later verses go straight to the built-in player without a decode attempt.
  f.player.setActive(false); f.player.setVerse('job:1:2'); f.player.setActive(true); await flush();
  assert.equal(f.player.snapshot().phase, 'playing');
  assert.equal(f.elements[0].src, 'https://example.org/audio/job/1/2.m4a');
  assert.equal(f.fetches.length, 1);
  assert.equal(f.elements.length, 1);
  assert.equal(f.phases.includes('blocked'), false);
});

test('built-in player completion still auto-advances after two seconds', async () => {
  const f = fixture({ decodeAudioData: cannotDecode, builtInPlayer: true });
  await f.tap(); f.player.setAuto(true); f.player.setVerse('job:1:1'); await flush();
  for (let verse = 0; verse < 2; verse++) {
    f.elements[0].finish(); await flush();
    assert.equal(f.player.snapshot().phase, 'waiting');
    f.tick(1999); assert.equal(f.advances.length, verse);
    f.tick(1); await flush();
    assert.equal(f.advances.length, verse + 1);
    assert.equal(f.player.snapshot().phase, 'playing');
    assert.equal(f.elements[0].src, `https://example.org/audio/job/1/${verse + 2}.m4a`);
  }
  assert.equal(f.phases.includes('blocked'), false);
});

test('mute, pause and resume work on the built-in player', async () => {
  const f = fixture({ decodeAudioData: cannotDecode, builtInPlayer: true });
  await f.tap(); f.player.setVerse('job:1:1'); await flush();
  const element = f.elements[0];
  f.player.setMuted(true); assert.equal(element.muted, true);
  f.player.setMuted(false); assert.equal(element.muted, false);
  element.currentTime = 4;
  f.player.setActive(false); await flush();
  assert.equal(element.paused, true);
  assert.equal(f.player.snapshot().phase, 'paused');
  f.player.setActive(true); await flush();
  // Resuming keeps the position instead of reloading the verse.
  assert.equal(element.currentTime, 4);
  assert.equal(element.src, 'https://example.org/audio/job/1/1.m4a');
  assert.equal(f.player.snapshot().phase, 'playing');
  assert.equal(f.phases.includes('blocked'), false);
});

test('an outside pause of the built-in player asks for a tap, and the tap resumes', async () => {
  const f = fixture({ decodeAudioData: cannotDecode, builtInPlayer: true });
  await f.tap(); f.player.setVerse('job:1:1'); await flush();
  f.elements[0].interrupt(); await flush();
  assert.equal(f.player.snapshot().phase, 'blocked');
  await f.tap(); await flush();
  assert.equal(f.player.snapshot().phase, 'playing');
  assert.equal(f.elements[0].plays, 2);
});

test('a built-in player failure is reported with its own label', async () => {
  const f = fixture({ decodeAudioData: cannotDecode, builtInPlayer: true,
    playElement: () => Promise.reject(new DOMException('The element has no supported sources.', 'NotSupportedError')) });
  await f.tap(); f.player.setVerse('job:1:1'); await flush();
  assert.equal(f.player.snapshot().phase, 'error');
  assert.equal(f.audio.failure.stage, 'start');
  assert.equal(f.audio.failure.element, true);
  assert.match(describeAudioFailure(f.audio.failure), /Audio playback failed \(NotSupportedError.*built-in player after Web Audio EncodingError on decode\)/);
  assert.doesNotMatch(describeAudioFailure(f.audio.failure), /HTTP|bytes/);
});

test('a blocked built-in player recovers with one tap', async () => {
  let blocked = true;
  const f = fixture({ decodeAudioData: cannotDecode, builtInPlayer: true,
    playElement: () => blocked ? Promise.reject(new DOMException('play() needs a user gesture', 'NotAllowedError')) : null });
  await f.tap(); f.player.setVerse('job:1:1'); await flush();
  assert.equal(f.player.snapshot().phase, 'blocked');
  blocked = false;
  await f.tap(); await flush();
  assert.equal(f.player.snapshot().phase, 'playing');
});

test('a blocked or failed download plays through the built-in player', async () => {
  for (const fetchAudio of [
    async () => { throw new TypeError('Failed to fetch'); },
    async () => ({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => { throw new TypeError('network error'); } }),
  ]) {
    const f = fixture({ fetchAudio, builtInPlayer: true });
    await f.tap(); f.player.setVerse('job:1:1'); await flush();
    assert.equal(f.player.snapshot().phase, 'playing');
    assert.equal(f.audio.useElement, true);
    assert.equal(f.elements[0].src, 'https://example.org/audio/job/1/1.m4a');
    f.player.destroy();
  }
});

test('an HTTP error is reported instead of switching players', async () => {
  const f = fixture({ builtInPlayer: true, fetchAudio: async () => ({ ok: false, status: 429, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }) });
  await f.tap(); f.player.setVerse('job:1:1'); await flush();
  assert.equal(f.player.snapshot().phase, 'error');
  assert.equal(f.audio.useElement, false);
  assert.equal(f.audio.failure.status, 429);
  assert.equal(f.elements.length, 0);
});

test('a media error before the built-in player starts is reported, and retry reloads', async () => {
  let failNext = true;
  const f = fixture({ decodeAudioData: cannotDecode, builtInPlayer: true,
    playElement: element => failNext ? (queueMicrotask(() => element.fail('PIPELINE_ERROR_DECODE')), new Promise(() => {})) : null });
  await f.tap(); f.player.setVerse('job:1:1'); await flush(); await flush();
  assert.equal(f.player.snapshot().phase, 'error');
  assert.match(describeAudioFailure(f.audio.failure), /Audio playback failed \(MediaError; PIPELINE_ERROR_DECODE.*built-in player/);
  failNext = false;
  f.elements[0].error = null;
  await f.tap(); await flush();
  assert.equal(f.player.snapshot().phase, 'playing');
});

test('an outside pause before the built-in player starts asks for a tap', async () => {
  let abort = true;
  const f = fixture({ decodeAudioData: cannotDecode, builtInPlayer: true,
    playElement: () => abort ? Promise.reject(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError')) : null });
  await f.tap(); f.player.setVerse('job:1:1'); await flush();
  assert.equal(f.player.snapshot().phase, 'blocked');
  abort = false;
  await f.tap(); await flush();
  assert.equal(f.player.snapshot().phase, 'playing');
});

test('a resume from outside the page clears the tap prompt and keeps auto-advance', async () => {
  const f = fixture({ decodeAudioData: cannotDecode, builtInPlayer: true });
  await f.tap(); f.player.setAuto(true); f.player.setVerse('job:1:1'); await flush();
  f.elements[0].interrupt(); await flush();
  assert.equal(f.player.snapshot().phase, 'blocked');
  f.elements[0].resume(); await flush();
  assert.equal(f.player.snapshot().phase, 'playing');
  f.elements[0].finish(); await flush();
  f.tick(2000); await flush();
  assert.deepEqual(f.advances, ['job:1:1']);
  assert.equal(f.player.snapshot().phase, 'playing');
});

test('after Web Audio has played, a bad recording is reported instead of switching players', async () => {
  let decodes = 0;
  const f = fixture({ builtInPlayer: true, decodeAudioData: () => ++decodes === 2 ? cannotDecode() : Promise.resolve({ duration: 10 }) });
  await f.tap(); f.player.setVerse('job:1:1'); await flush();
  assert.equal(f.player.snapshot().phase, 'playing');
  f.player.setActive(false); f.player.setVerse('job:1:2'); f.player.setActive(true); await flush();
  assert.equal(f.player.snapshot().phase, 'error');
  assert.equal(f.audio.failure.stage, 'decode');
  assert.equal(f.audio.useElement, false);
  assert.equal(f.elements.length, 0);
  f.player.setActive(false); f.player.setVerse('job:1:3'); f.player.setActive(true); await flush();
  assert.equal(f.player.snapshot().phase, 'playing');
  assert.equal(f.sources.length, 2);
});
