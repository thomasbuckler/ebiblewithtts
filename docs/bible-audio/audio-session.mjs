// A user gesture unlocks this context once. New verses replace buffer sources,
// never the context, so timer-driven playback keeps the same audio permission.
const safeDetail = value => String(value || '').replace(/https?:\/\/[^\s]+/gi, '[URL]').replace(/[\r\n\t]+/g, ' ').slice(0, 160);

export function describeAudioFailure(failure) {
  if (!failure) return 'Audio could not play. Tap the speaker to retry.';
  const labels = { enable: 'Audio could not start', download: 'Audio download failed', read: 'Audio download could not be read', decode: 'Audio decoding failed', start: 'Audio playback failed' };
  const details = [safeDetail(failure.name)];
  if (failure.message && failure.message !== failure.name) details.push(safeDetail(failure.message));
  if (failure.status !== undefined) details.push(`HTTP ${failure.status}`);
  if (failure.type) details.push(safeDetail(failure.type));
  if (failure.bytes !== undefined) details.push(`${failure.bytes} bytes`);
  if (failure.contextState) details.push(`context ${failure.contextState}`);
  return `${labels[failure.stage] || 'Audio could not play'} (${details.filter(Boolean).join('; ')}). Tap the speaker to retry.`;
}

export class VerseAudioSession extends EventTarget {
  constructor({ Context = globalThis.AudioContext || globalThis.webkitAudioContext, fetchAudio = globalThis.fetch.bind(globalThis) } = {}) {
    super();
    this.Context = Context;
    this.fetchAudio = fetchAudio;
    this.context = null;
    this.gain = null;
    this.source = null;
    this.buffer = null;
    this.request = null;
    this.pending = null;
    this.unlocking = null;
    this.unlockError = null;
    this.unlockAttempt = 0;
    this.version = 0;
    this.offset = 0;
    this.startedAt = 0;
    this.paused = true;
    this.ended = false;
    this.error = null;
    this.failure = null;
    this._src = '';
    this._muted = false;
  }
  get src() { return this._src; }
  set src(value) {
    this.load();
    this._src = String(value);
  }
  get currentSrc() { return this._src; }
  get duration() { return this.buffer?.duration ?? NaN; }
  get currentTime() {
    return this.source && !this.paused
      ? Math.min(this.buffer.duration, this.offset + this.context.currentTime - this.startedAt)
      : this.offset;
  }
  get muted() { return this._muted; }
  set muted(value) {
    this._muted = Boolean(value);
    if (this.gain) this.gain.gain.value = this._muted ? 0 : 1;
  }
  // Call directly within a real click handler, before awaiting any audio fetch.
  unlock() {
    const attempt = ++this.unlockAttempt;
    this.unlockError = null;
    try {
      // Keep context creation and resume synchronous inside the trusted gesture.
      return this.unlockContext().catch(error => {
        if (attempt === this.unlockAttempt) this.unlockError = error;
        throw error;
      });
    } catch (error) {
      this.unlockError = error;
      return Promise.reject(error);
    }
  }
  unlockContext() {
    if (!this.context) {
      if (!this.Context) return Promise.reject(new Error('Web Audio is unavailable'));
      this.context = new this.Context();
      this.gain = this.context.createGain();
      this.gain.gain.value = this._muted ? 0 : 1;
      this.gain.connect(this.context.destination);
      this.context.addEventListener('statechange', () => {
        if (this.context.state !== 'running' && this.source) {
          this.pause();
          this.dispatchEvent(new Event('interrupted'));
        }
      });
    }
    if (this.context.state === 'running') return Promise.resolve();
    // resume() must run now, in the gesture, even if an earlier resume is pending.
    const resumed = this.context.resume();
    let timeout;
    const attempt = Promise.race([
      resumed,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new DOMException('Tap the speaker to resume audio', 'NotAllowedError')), 2000); }),
    ]).then(() => {
      if (this.context.state !== 'running') throw new DOMException('Audio is suspended', 'NotAllowedError');
    }).finally(() => {
      clearTimeout(timeout);
      if (this.unlocking === attempt) this.unlocking = null;
    });
    this.unlocking = attempt;
    return attempt;
  }
  pause() {
    this.offset = this.currentTime;
    this.version++;
    this.request?.abort();
    this.request = null;
    this.pending = null;
    if (this.source) {
      // stop() can emit ended; it is never natural verse completion.
      const previous = this.source;
      this.source = null;
      previous.onended = null;
      previous.stop();
      previous.disconnect();
    }
    this.paused = true;
  }
  load() {
    this.pause();
    this.buffer = null;
    this.offset = 0;
    this.ended = false;
    this.error = null;
    this.failure = null;
  }
  removeAttribute(name) {
    if (name === 'src') { this.load(); this._src = ''; }
  }
  play() {
    if (this.source && !this.paused) return Promise.resolve();
    if (this.pending) return this.pending;
    const version = this.version;
    const url = this._src;
    const current = () => version === this.version && url === this._src;
    const aborted = () => new DOMException('Verse changed', 'AbortError');
    // Keep metadata local so a late failure from an old verse cannot replace it.
    const failure = { stage: 'enable' };
    this.failure = null;
    const task = (async () => {
      if (this.unlocking) await this.unlocking;
      if (!current()) throw aborted();
      if (this.unlockError) throw this.unlockError;
      if (!this.context || this.context.state !== 'running') {
        throw new DOMException('Tap the speaker to enable audio', 'NotAllowedError');
      }
      if (!url) throw new Error('No verse recording selected');
      if (!this.buffer) {
        failure.stage = 'download';
        const request = new AbortController();
        this.request = request;
        const response = await this.fetchAudio(url, { signal: request.signal });
        failure.status = response.status;
        failure.type = safeDetail(response.headers?.get('content-type'));
        if (!response.ok) throw new Error('The server did not return the verse recording');
        failure.stage = 'read';
        const bytes = await response.arrayBuffer();
        failure.bytes = bytes.byteLength;
        if (!current()) throw aborted();
        failure.stage = 'decode';
        const decoded = await this.context.decodeAudioData(bytes);
        if (!current()) throw aborted();
        this.buffer = decoded; // Only the current verse is retained in memory.
        this.request = null;
      }
      if (!current()) throw aborted();
      failure.stage = 'start';
      if (this.context.state !== 'running') throw new DOMException('Audio is suspended', 'NotAllowedError');
      if (this.offset >= this.buffer.duration) this.offset = 0;
      const source = this.context.createBufferSource();
      source.buffer = this.buffer;
      source.onended = () => {
        if (!current() || this.source !== source || this.paused) return;
        source.onended = null;
        source.disconnect();
        this.source = null;
        this.offset = this.buffer.duration;
        this.paused = true;
        this.ended = true;
        this.dispatchEvent(new Event('ended'));
      };
      try {
        source.connect(this.gain);
        source.start(0, this.offset);
      } catch (error) {
        // An unstarted source cannot be stopped on retry; release it now.
        source.onended = null;
        try { source.disconnect(); } catch {}
        throw error;
      }
      this.source = source;
      this.startedAt = this.context.currentTime;
      this.paused = false;
      this.ended = false;
      this.error = null;
      this.failure = null;
    })().catch(error => {
      if (current() && error.name !== 'AbortError') {
        this.failure = { ...failure, name: safeDetail(error.name), message: safeDetail(error.message), contextState: this.context?.state || 'unavailable' };
        if (error.name !== 'NotAllowedError') this.error = error;
      }
      throw error;
    }).finally(() => {
      if (this.pending === task) this.pending = null;
    });
    this.pending = task;
    return task;
  }
}
