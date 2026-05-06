#!/bin/bash
#
# Download STM32 Cube CLT (Command Line Tools) from ST website with authentication
#
# Usage:
#   ./download-cubeclt.sh <username> <password> <version> <output_file>
#
# Example:
#   ./download-cubeclt.sh user@email.com mypassword 1.16.0 STM32CubeCLT_1.16.0.zip
#
# Environment variables (alternative to arguments):
#   ST_USERNAME - ST account email
#   ST_PASSWORD - ST account password
#   CUBECLT_VERSION - Version to download (default: latest)
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Parse arguments or use environment variables
USERNAME="${1:-${ST_USERNAME:-}}"
PASSWORD="${2:-${ST_PASSWORD:-}}"
VERSION="${3:-${CUBECLT_VERSION:-}}"
OUTPUT_FILE="${4:-}"

if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
    log_error "ST account credentials are required"
    echo "Usage: $0 <username> <password> [version] [output_file]" >&2
    echo "   or: ST_USERNAME=<user> ST_PASSWORD=<pass> $0" >&2
    exit 1
fi

# Temporary files
COOKIE_FILE=$(mktemp)
RESPONSE_FILE=$(mktemp)
trap "rm -f $COOKIE_FILE $RESPONSE_FILE" EXIT

# ST URLs
ST_LOGIN_URL="https://my.st.com/cas/login"
ST_DOWNLOAD_BASE="https://www.st.com/content/st_com/en/products/development-tools/software-development-tools/stm32-software-development-tools/stm32-configurators-and-code-generators/stm32cubeclt.html"

log_info "Authenticating with ST account..."

# Step 1: Get login page to extract CSRF token and other form data
log_info "Fetching login page..."
LOGIN_PAGE=$(curl -sS -c "$COOKIE_FILE" "$ST_LOGIN_URL" 2>&1 || true)

# Extract execution token (CAS uses 'execution' parameter)
EXECUTION=$(echo "$LOGIN_PAGE" | grep -oP 'name="execution"\s+value="\K[^"]+' || echo "")
if [ -z "$EXECUTION" ]; then
    log_warn "Could not extract execution token, proceeding without it..."
fi

# Step 2: Perform login
log_info "Logging in as $USERNAME..."
LOGIN_RESPONSE=$(curl -sS \
    -b "$COOKIE_FILE" \
    -c "$COOKIE_FILE" \
    -L \
    -X POST "$ST_LOGIN_URL" \
    -d "username=$USERNAME" \
    -d "password=$PASSWORD" \
    ${EXECUTION:+-d "execution=$EXECUTION"} \
    -d "_eventId=submit" \
    -d "submit=LOGIN" \
    2>&1 || true)

# Check if login was successful (look for common error patterns)
if echo "$LOGIN_RESPONSE" | grep -qi "invalid\|incorrect\|error\|failed"; then
    log_error "Login failed - check credentials"
    exit 1
fi

log_info "Login successful"

# Step 3: Get download page to find the actual download link
log_info "Fetching download page..."
DOWNLOAD_PAGE=$(curl -sS -b "$COOKIE_FILE" -L "$ST_DOWNLOAD_BASE" 2>&1 || true)

# Step 4: Parse download URL for Linux version
# ST typically uses URLs like:
# https://www.st.com/content/ccc/resource/technical/software/sw_development_suite/group0/...
# or direct download links through their CDN

# Common patterns for STM32CubeCLT download links
if [ -n "$VERSION" ]; then
    log_info "Looking for version $VERSION..."
    DOWNLOAD_URL=$(echo "$DOWNLOAD_PAGE" | grep -oP 'href="[^"]*STM32CubeCLT[^"]*'"$VERSION"'[^"]*Linux[^"]*\.zip[^"]*"' | head -1 | sed 's/^href="//;s/"$//' || echo "")
else
    log_info "Looking for latest version..."
    DOWNLOAD_URL=$(echo "$DOWNLOAD_PAGE" | grep -oP 'href="[^"]*STM32CubeCLT[^"]*Linux[^"]*\.zip[^"]*"' | head -1 | sed 's/^href="//;s/"$//' || echo "")
fi

# Alternative: Try to find download through API or direct URL pattern
if [ -z "$DOWNLOAD_URL" ]; then
    log_warn "Could not find download URL from page content"

    # Try common direct download URL pattern
    if [ -n "$VERSION" ]; then
        # ST often uses a pattern like this (adjust based on actual ST URLs)
        DOWNLOAD_URL="https://www.st.com/content/ccc/resource/technical/software/sw_development_suite/group0/08/22/99/55/ce/bd/4b/3d/stm32cubeclt_${VERSION}/files/stm32cubeclt-${VERSION}_linux.zip/jcr:content/translations/en.stm32cubeclt-${VERSION}_linux.zip"
        log_info "Trying direct URL pattern: $DOWNLOAD_URL"
    else
        log_error "Cannot determine download URL without version"
        log_error "Please specify a version or check the download page manually:"
        log_error "$ST_DOWNLOAD_BASE"
        exit 1
    fi
fi

# Ensure URL is absolute
if [[ "$DOWNLOAD_URL" == /* ]]; then
    DOWNLOAD_URL="https://www.st.com${DOWNLOAD_URL}"
fi

# Determine output filename
if [ -z "$OUTPUT_FILE" ]; then
    OUTPUT_FILE=$(basename "$DOWNLOAD_URL" | sed 's/?.*//')
    if [ -z "$OUTPUT_FILE" ] || [ "$OUTPUT_FILE" = "/" ]; then
        OUTPUT_FILE="stm32cubeclt_${VERSION:-latest}_linux.zip"
    fi
fi

log_info "Download URL: $DOWNLOAD_URL"
log_info "Output file: $OUTPUT_FILE"

# Step 5: Download the file
log_info "Downloading STM32CubeCLT..."
if curl -L -b "$COOKIE_FILE" -o "$OUTPUT_FILE" -w "HTTP Status: %{http_code}\n" "$DOWNLOAD_URL" 2>&1 | tee "$RESPONSE_FILE"; then
    HTTP_CODE=$(grep "HTTP Status:" "$RESPONSE_FILE" | cut -d: -f2 | tr -d ' ')

    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
        FILE_SIZE=$(stat -f%z "$OUTPUT_FILE" 2>/dev/null || stat -c%s "$OUTPUT_FILE" 2>/dev/null || echo "0")

        if [ "$FILE_SIZE" -gt 1000000 ]; then
            log_info "Download complete! File size: $(numfmt --to=iec $FILE_SIZE 2>/dev/null || echo "${FILE_SIZE} bytes")"
            echo "$OUTPUT_FILE"
            exit 0
        else
            log_error "Downloaded file is too small ($FILE_SIZE bytes) - likely an error page"
            log_error "Check if the version '$VERSION' exists or if login failed"
            exit 1
        fi
    else
        log_error "Download failed with HTTP status: $HTTP_CODE"
        exit 1
    fi
else
    log_error "Download failed"
    exit 1
fi
