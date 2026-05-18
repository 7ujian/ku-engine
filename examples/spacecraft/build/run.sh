#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
node "$DIR/runtime/dist/player/main.js" "$DIR/game" "$@"
