#!/bin/bash
while true; do
  curl -s http://localhost:3000/api/status/010b6a83-68e6-4903-b9d3-ab4fd1a7fd3f > status.json
  cat status.json | grep -o '"status":"[^"]*"'
  cat status.json | grep -o '"error":"[^"]*"'
  cat status.json | grep -o '"currentStep":"[^"]*"'
  if grep -q '"status":"complete"' status.json || grep -q '"status":"error"' status.json; then
    break
  fi
  sleep 5
done
