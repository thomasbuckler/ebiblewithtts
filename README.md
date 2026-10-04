# Holy Scroller

A scrolling World English Bible reader that plays a recording of each verse as
it comes on screen. It has mute/unmute, and can move on to the next verse
automatically two seconds after a recording ends.

The recordings are the original `.m4a` text-to-speech files, served unchanged
(no conversion to MP3).

## Layout

- `site/index.html`: application shell.
- `site/assets/`: the scroller UI (deployed JavaScript bundles and CSS).
- `site/bible-audio/`: playback, mute, auto-scroll and clock modules, plus
  `verses.json`, which maps each verse to its recording
  (`"job:1:1": "audio/job/1/1.m4a"`).
- `site/audio/<book>/<chapter>/<verse>.m4a`: the recordings.
- `site/data/webu.json`: the Bible text.
- `tools/import_audio.py`: copies recordings into `site/audio/`.
- `tests/`: playback and clock tests.

## Adding the recordings

Put the `.m4a` files at the paths listed in `site/bible-audio/verses.json`, or
let the import script do it from the ZIP (or an unzipped folder):

```sh
python3 tools/import_audio.py /path/to/soooooo-fun-bible-tts-v1.zip
```

It finds each `<book>/<chapter>/<verse>.m4a` wherever it sits in the archive and
reports any that are missing.

## Run locally

```sh
python3 -m http.server 8000 --directory site
```

Then open http://localhost:8000. The site must be served at the web root;
opening `index.html` directly as a file does not work.

`node build.mjs` copies `site/` to `dist/` for hosting and warns about any
missing recordings.

## Tests

```sh
node --test tests/audio-session.test.mjs tests/audio-dial.test.mjs
```

Poetry, Prophecy and Gospels have full recording coverage (14,053 verses).
Other sections are readable and show a "No recording for this verse" notice.
Favorites and mute preferences are stored per device.
