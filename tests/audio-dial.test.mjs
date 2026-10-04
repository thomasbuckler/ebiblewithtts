import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudioDial } from '../site/bible-audio/audio-dial.mjs';

function fixture() {
  const audio = { currentTime: 0, duration: 10, paused: false, ended: false };
  let state = { key: 'job:1:1', auto: true, active: true, phase: 'playing', advanceAt: null };
  let angle, next = 0, time = 0;
  const frames = new Map();
  const dial = createAudioDial({ audio, draw: value => { angle = value; }, now: () => time,
    requestFrame: fn => { frames.set(++next, fn); return next; },
    cancelFrame: id => frames.delete(id),
  });
  return { audio, frames,
    get angle() { return angle; },
    update(patch = {}) { state = { ...state, ...patch }; dial.update(state); },
    frame(position, milliseconds) {
      audio.currentTime = position; time = milliseconds;
      const pending = [...frames.values()]; frames.clear();
      for (const fn of pending) fn();
    },
  };
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('rotation spans audio plus its exact two-second deadline, continuing through the next load', () => {
  const f = fixture(); f.update(); close(f.angle, 0);
  f.frame(5, 5000); close(f.angle, 150);
  f.frame(10, 10000); close(f.angle, 300);
  Object.assign(f.audio, { ended: true, paused: true });
  f.update({ phase: 'waiting', advanceAt: 12000 });
  f.frame(10, 11000); close(f.angle, 330); assert.equal(f.frames.size, 1);
  f.frame(10, 12000); close(f.angle, 360);
  f.update({ phase: 'ended', advanceAt: null });
  f.update({ active: false, phase: 'paused' });
  Object.assign(f.audio, { currentTime: 0, duration: NaN, ended: false });
  f.update({ key: 'job:1:2' }); close(f.angle, 360);
  f.update({ active: true, phase: 'loading' });
  f.frame(0, 12200); close(f.angle, 366);
  Object.assign(f.audio, { duration: 8, paused: false });
  f.update({ phase: 'playing' }); close(f.angle, 366);
  f.frame(8, 20200); close(f.angle, 649.2);
  Object.assign(f.audio, { ended: true, paused: true });
  f.update({ phase: 'waiting', advanceAt: 22200 });
  f.frame(8, 22200); close(f.angle, 720);
});

test('mid-verse enable includes the remaining audio and pause in one complete turn', () => {
  const f = fixture(); f.audio.currentTime = 6; f.update();
  f.frame(8, 2000); close(f.angle, 120);
  f.update({ muted: true });
  f.frame(10, 4000); close(f.angle, 240);
  Object.assign(f.audio, { ended: true, paused: true });
  f.update({ phase: 'waiting', advanceAt: 6000 });
  f.frame(10, 6000); close(f.angle, 360);
});

test('pausing freezes the hand; off resets it; resuming retains audio progress', () => {
  const f = fixture(); f.update(); f.frame(3, 3000); close(f.angle, 90);
  f.audio.paused = true; f.update({ active: false, phase: 'paused' });
  f.frame(3, 63000); close(f.angle, 90); assert.equal(f.frames.size, 0);
  f.audio.paused = false; f.update({ active: true, phase: 'playing' });
  f.frame(6, 66000); close(f.angle, 180);
  f.update({ auto: false }); close(f.angle, 0); assert.equal(f.frames.size, 0);
});

test('enabling after audio ended rotates through the newly scheduled pause', () => {
  const f = fixture();
  Object.assign(f.audio, { currentTime: 10, paused: true, ended: true });
  f.update({ phase: 'waiting', advanceAt: 2000 }); close(f.angle, 0);
  f.frame(10, 1000); close(f.angle, 180);
  f.frame(10, 2000); close(f.angle, 360);
});

test('a paused gap resumes using its new deadline without jumping ahead', () => {
  const f = fixture(); f.update(); f.frame(10, 10000);
  Object.assign(f.audio, { paused: true, ended: true });
  f.update({ phase: 'waiting', advanceAt: 12000 }); f.frame(10, 11000);
  close(f.angle, 330);
  f.update({ active: false, phase: 'paused', advanceAt: null });
  f.frame(10, 71000); close(f.angle, 330);
  f.update({ active: true, phase: 'waiting', advanceAt: 73000 }); close(f.angle, 330);
  f.frame(10, 72000); close(f.angle, 345);
  f.frame(10, 73000); close(f.angle, 360);
});
