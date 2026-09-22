"""Private local baseline and isolated restore verification. Never prints file contents."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile


def digest(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def verify(root, manifest):
    for name, expected in manifest['files'].items():
        p = root / name
        if not p.is_file() or digest(p) != expected:
            raise ValueError('Backup integrity mismatch: ' + name)
        if p.suffix == '.db':
            with sqlite3.connect(f'file:{p}?mode=ro', uri=True) as db:
                if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise ValueError('Database integrity failed')
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--destination', required=True)
    ap.add_argument('--data-root', required=True)
    ap.add_argument('--installed-asar', required=True)
    ap.add_argument('--attachments', required=True)
    args = ap.parse_args()
    os.umask(0o077)
    target = Path(args.destination).resolve()
    target.mkdir(parents=True, exist_ok=False)
    source = Path(args.data_root).resolve()
    repo = Path(__file__).resolve().parents[1]
    for folder in ['config', 'storage']:
        original = source / folder
        if original.exists():
            shutil.copytree(original, target / 'data' / folder, symlinks=False)
    for p in (target / 'data').rglob('*'):
        if p.is_file() and p.suffix == '.db':
            relative = p.relative_to(target / 'data')
            p.unlink()
            with sqlite3.connect(f'file:{source / relative}?mode=ro', uri=True) as origin:
                with sqlite3.connect(p) as backup:
                    origin.backup(backup)
            for suffix in ['-wal', '-shm']:
                Path(str(p) + suffix).unlink(missing_ok=True)
    (target / 'attachments').mkdir()
    for p in Path(args.attachments).iterdir():
        if p.suffix in ['.docx', '.pdf', '.txt']:
            shutil.copy2(p, target / 'attachments' / p.name)
    shutil.copy2(args.installed_asar, target / 'app.asar')
    files = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=repo).split(b'\0')
    with tarfile.open(target / 'source.tar.gz', 'w:gz') as archive:
        for raw in sorted(set(files)):
            if raw:
                p = repo / os.fsdecode(raw)
                if p.is_file():
                    archive.add(p, arcname=os.fsdecode(raw), recursive=False)
    manifest = {
        'version': 1,
        'baseline': '0.17.4+atlas.5',
        'gitHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
        'files': {str(p.relative_to(target)): digest(p) for p in target.rglob('*') if p.is_file()},
    }
    (target / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    verify(target, manifest)
    with tempfile.TemporaryDirectory(prefix='atlas-restore-', dir=target.parent) as tmp:
        restored = Path(tmp) / 'restored'
        shutil.copytree(target, restored)
        verify(restored, manifest)
        probe = restored / next(iter(manifest['files']))
        probe.write_bytes(b'corrupt')
        try:
            verify(restored, manifest)
        except ValueError:
            rejected = True
        else:
            raise AssertionError('Corruption was not rejected')
    report = {'baseline': manifest['baseline'], 'fileCount': len(manifest['files']), 'isolatedRestore': 'passed', 'corruptionRejected': rejected, 'originalBackupUnchanged': verify(target, manifest)}
    (target / 'verification.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == '__main__':
    main()
