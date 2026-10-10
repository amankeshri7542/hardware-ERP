"""Publish an allowlisted action timeline, never raw trace bodies/headers/resources."""
import json
import sys
import zipfile
from pathlib import Path


def timeline(source):
    result = []
    with zipfile.ZipFile(source) as archive:
        if sum(item.file_size for item in archive.infolist()) > 32 * 1024 * 1024:
            raise ValueError('Trace exceeds diagnostic size limit')
        for item in archive.infolist():
            if not item.filename.endswith('.trace'):
                continue
            for line in archive.read(item).splitlines():
                event = json.loads(line)
                if event.get('type') not in ('before', 'after'):
                    continue
                result.append({key: event[key] for key in
                               ('type', 'callId', 'class', 'method', 'startTime', 'endTime') if key in event})
                if event.get('error'):
                    result[-1]['failed'] = True
    return result


if __name__ == '__main__':
    Path(sys.argv[2]).write_text(json.dumps(timeline(sys.argv[1]), indent=2) + '\n')
