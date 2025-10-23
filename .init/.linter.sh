#!/bin/bash
cd /home/kavia/workspace/code-generation/silent-auction-platform-39777-39786/react_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

