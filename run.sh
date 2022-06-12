#!/bin/bash
if [ ! -x "$(command -v docker)" ]; then
    echo "Please make sure docker is installed."
    exit 0
fi

if [ ! -x "$(command -v docker-compose)" ]; then
    echo "Please make sure docker-compose is installed."
    exit 0
fi

echo 'Starting up TrustSECO'

docker login ghcr.io -u TrustSECO-Machine-User -p REDACTED_HISTORICAL_TOKEN
docker-compose up