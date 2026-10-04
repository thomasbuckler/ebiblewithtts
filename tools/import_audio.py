#!/usr/bin/env python3
"""Copy the .m4a verse recordings into site/audio/.

Usage: python3 tools/import_audio.py SOURCE

SOURCE is a ZIP archive or a folder. Every recording listed in
site/bible-audio/verses.json is looked up by its <book>/<chapter>/<verse>.m4a
path, wherever that path sits inside SOURCE (for example audio/job/1/1.m4a or
some-folder/job/1/1.m4a). Files are copied unchanged; nothing is re-encoded.
"""
import json
import shutil
import sys
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'site'


def tail(name):
    """The last three path parts, e.g. ('job', '1', '1.m4a')."""
    return tuple(PurePosixPath(name.replace('\\', '/')).parts[-3:])


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    source = Path(sys.argv[1])
    catalog = json.loads((SITE / 'bible-audio/verses.json').read_text())
    wanted = {tail(path): path for path in catalog.values()}

    if zipfile.is_zipfile(source):
        archive = zipfile.ZipFile(source)
        found = {tail(info.filename): info for info in archive.infolist() if not info.is_dir()}
        open_file = archive.open
    elif source.is_dir():
        found = {tail(str(path.relative_to(source))): path for path in source.rglob('*.m4a')}
        open_file = lambda path: path.open('rb')
    else:
        sys.exit(f'{source} is not a ZIP archive or a folder.')

    copied = 0
    missing = []
    for key, path in sorted(wanted.items()):
        item = found.get(key)
        if item is None:
            missing.append(path)
            continue
        destination = SITE / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        with open_file(item) as src, destination.open('wb') as dst:
            shutil.copyfileobj(src, dst)
        copied += 1

    print(f'Copied {copied} of {len(wanted)} verse recordings into site/audio/.')
    if missing:
        print(f'{len(missing)} recordings were not found, for example:')
        for path in missing[:10]:
            print('  ', path)


if __name__ == '__main__':
    main()
