#!/bin/sh
set -eu
printf '%s\n' 'Deployment is blocked. Complete docs/RELEASE-BLOCKERS.md and obtain explicit operator approval.' >&2
exit 1
