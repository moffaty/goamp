#!/usr/bin/env bash
set -e
cd goamp-node
go build -o /tmp/goamp-node-test ./cmd/goamp-node
/tmp/goamp-node-test --mode=client --api-port=17472 &
NODE_PID=$!
trap "kill $NODE_PID 2>/dev/null" EXIT
sleep 1
STATUS=$(curl -sf localhost:17472/health | jq -r .status)
[ "$STATUS" = "ok" ] || { echo "FAIL: /health returned $STATUS"; exit 1; }
echo "PASS: /health ok"
kill $NODE_PID
