#!/bin/bash
# Scrape STM32CubeCLT versions from ST website
# Returns JSON array of version objects

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required for scraping STM32CubeCLT versions" >&2
    exit 1
fi

echo "Scraping STM32CubeCLT versions from ST website..." >&2
if ! SCRAPED=$(node "${SCRIPT_DIR}/scrape-cubeclt-versions.js" 2>/dev/null) || [ -z "$SCRAPED" ]; then
    echo "Error: Failed to scrape STM32CubeCLT versions from ST website" >&2
    exit 1
fi

# Output the scraped versions
echo "$SCRAPED"
