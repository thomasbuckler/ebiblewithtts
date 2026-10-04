#!/usr/bin/env python3
"""Copy the .m4a verse recordings into site/audio/.

Usage: python3 tools/import_audio.py SOURCE

SOURCE is a ZIP archive or a folder. Every recording listed in
site/bible-audio/verses.json is looked up by its <book>/<chapter>/<verse>.m4a
path, wherever that path sits inside SOURCE (for example audio/job/1/1.m4a or
some-folder/job/1/1.m4a). Files are copied unchanged; nothing is re-encoded.
Exits with status 1 if any recording is missing or ambiguous.
"""
import json
import os
import shutil
import sys
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'site'
AUDIO = SITE / 'audio'


def tail(name):
    """The last three path parts, e.g. ('job', '1', '1.m4a')."""
    parts = PurePosixPath(name.replace('\\', '/')).parts[-3:]
    return parts[:-1] + (parts[-1].lower(),) if parts else parts


def index(entries):
    """Map each tail to its entry, preferring an exact audio/... path."""
    candidates = {}
    for name, item in entries:
        key = tail(name)
        exact = name.replace('\\', '/').lower() == 'audio/' + '/'.join(key)
        candidates.setdefault(key, []).append((exact, item))
    found = {}
    clashes = set()
    for key, items in candidates.items():
        best = [item for exact, item in items if exact] or [item for _, item in items]
        if len(best) > 1:
            clashes.add(key)
        found[key] = best[0]
    return found, clashes


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    source = Path(sys.argv[1])
    catalog = json.loads((SITE / 'bible-audio/verses.json').read_text())
    wanted = {tail(path): path for path in catalog.values()}

    if zipfile.is_zipfile(source):
        archive = zipfile.ZipFile(source)
        found, clashes = index((info.filename, info) for info in archive.infolist()
                               if not info.is_dir() and info.filename.lower().endswith('.m4a'))
        open_file = archive.open
    elif source.is_dir():
        # Never read from the destination: copying a file onto itself empties it.
        found, clashes = index((str(path.relative_to(source)), path) for path in source.rglob('*')
                               if path.suffix.lower() == '.m4a' and path.is_file()
                               and AUDIO.resolve() not in path.resolve().parents)
        open_file = lambda path: path.open('rb')
    else:
        sys.exit(f'{source} is not a ZIP archive or a folder.')

    copied = 0
    missing = []
    ambiguous = []
    for key, path in sorted(wanted.items()):
        if key in clashes:
            ambiguous.append(path)
            continue
        item = found.get(key)
        if item is None:
            missing.append(path)
            continue
        destination = SITE / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        partial = destination.with_name(destination.name + '.partial')
        with open_file(item) as src, partial.open('wb') as dst:
            shutil.copyfileobj(src, dst)
        os.replace(partial, destination)
        copied += 1

    print(f'Copied {copied} of {len(wanted)} verse recordings into site/audio/.')
    for label, paths in (('were not found', missing), ('matched more than one file in the source', ambiguous)):
        if paths:
            print(f'{len(paths)} recordings {label}, for example:')
            for path in paths[:10]:
                print('  ', path)
    if missing or ambiguous:
        sys.exit(1)


if __name__ == '__main__':
    main()
