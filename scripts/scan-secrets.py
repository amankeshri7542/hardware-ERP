#!/usr/bin/env python3
"""Local-only Gitleaks scan; never print matches, tokens or source snippets."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--history', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    binary = os.environ.get('GITLEAKS_BIN', 'gitleaks')
    with tempfile.TemporaryDirectory(prefix='hardware-secret-scan-') as directory:
        temp = Path(directory)
        report = temp / 'redacted.json'
        if args.history:
            command = [binary, 'git', str(root), '--log-opts=--all']
        else:
            snapshot = temp / 'tracked'
            snapshot.mkdir()
            tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
            for name in filter(None, tracked):
                source = root / name
                if source.is_symlink():
                    raise RuntimeError('Tracked symlink requires manual secret review')
                if source.is_file():
                    destination = snapshot / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, destination)
            command = [binary, 'dir', str(snapshot)]
        try:
            result = subprocess.run(command + ['--redact=100', '--no-banner', '--report-format=json',
                                               '--report-path=' + str(report)], capture_output=True)
        except OSError:
            print('Secret scanner unavailable; install the pinned Gitleaks version.')
            return 2
        if result.returncode not in (0, 1) or not report.exists():
            print('Secret scanner failed; no source output is displayed.')
            return 2
        findings = json.loads(report.read_text()) or []
        print(f'{"History" if args.history else "Tracked candidate"} scan: {len(findings)} findings')
        for finding in findings:
            name = finding['File']
            if not args.history:
                try:
                    name = str(Path(name).relative_to(snapshot))
                except ValueError:
                    pass
            print(json.dumps({'rule': finding['RuleID'], 'file': name,
                              'line': finding['StartLine'], 'commit': finding.get('Commit', '')}))
        return result.returncode


if __name__ == '__main__':
    raise SystemExit(main())
