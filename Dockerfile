# ============================================
# Stage 1: Download STM32CubeCLT
# ============================================
FROM ubuntu:22.04 AS downloader

# STM32CubeCLT Version (can be overridden at build time)
ARG CUBECLT_VERSION=1.16.0

# ST Account Credentials (passed from GitHub Actions secrets)
ARG ST_USERNAME
ARG ST_PASSWORD

# Validate credentials
RUN if [ -z "$ST_USERNAME" ] || [ -z "$ST_PASSWORD" ]; then \
        echo "ERROR: ST_USERNAME and ST_PASSWORD build arguments are required"; \
        echo "Build with: docker build --build-arg ST_USERNAME=<email> --build-arg ST_PASSWORD=<password> ."; \
        exit 1; \
    fi

# Install download tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    unzip && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy download script
COPY .github/scripts/download-cubeclt.sh /tmp/download-cubeclt.sh
RUN chmod +x /tmp/download-cubeclt.sh

# Download STM32CubeCLT
RUN echo ">>> Downloading STM32CubeCLT ${CUBECLT_VERSION}..." && \
    mkdir -p /cubeclt_download /cubeclt_installer && \
    cd /cubeclt_download && \
    ST_USERNAME="${ST_USERNAME}" \
    ST_PASSWORD="${ST_PASSWORD}" \
    CUBECLT_VERSION="${CUBECLT_VERSION}" \
    /tmp/download-cubeclt.sh && \
    echo ">>> Download complete" && \
    ls -lh /cubeclt_download/

# Extract STM32CubeCLT
# Note: Adjust extraction based on actual archive format
RUN echo ">>> Extracting STM32CubeCLT..." && \
    cd /cubeclt_download && \
    ARCHIVE=$(ls -1 *.zip 2>/dev/null | head -1) && \
    if [ -n "$ARCHIVE" ]; then \
        unzip -q "$ARCHIVE" -d /cubeclt_installer && \
        echo ">>> Extraction complete" && \
        rm -f "$ARCHIVE"; \
    else \
        echo "ERROR: No archive found in /cubeclt_download"; \
        exit 1; \
    fi

# ============================================
# Stage 2: Runtime Image
# ============================================
FROM ubuntu:22.04

# Metadata
LABEL maintainer="uoohyo <https://github.com/uoohyo>"
LABEL description="STM32CubeCLT (Command Line Tools) for Docker with automated download"

# STM32CubeCLT Version
ARG CUBECLT_VERSION=1.16.0
ENV CUBECLT_VERSION=${CUBECLT_VERSION}

# System Dependencies for STM32 development
RUN echo ">>> Installing system dependencies..." && \
    dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get install --no-install-recommends -y \
    # Core build tools
    build-essential \
    cmake \
    ninja-build \
    git \
    # USB and device support
    libusb-1.0-0 \
    libusb-1.0-0-dev \
    udev \
    # ARM GCC dependencies
    libc6:i386 \
    libncurses5:i386 \
    libstdc++6:i386 \
    # STM32CubeCLT dependencies
    default-jre-headless \
    libxml2 \
    # Utilities
    ca-certificates \
    curl \
    unzip \
    file && \
    apt-get clean && rm -rf /var/lib/apt/lists/* && \
    echo ">>> Done."

# Copy extracted STM32CubeCLT from downloader stage
COPY --from=downloader /cubeclt_installer /opt/cubeclt-installer

# Working Directory
WORKDIR /workspace

# STM32CubeCLT installation will be done in entrypoint.sh
# Set up PATH for common STM32CubeCLT tools (paths will be verified in entrypoint)
ENV PATH="/opt/st/stm32cubeclt/STM32CubeProgrammer/bin:${PATH}"
ENV PATH="/opt/st/stm32cubeclt/STM32CubeMX:${PATH}"
ENV PATH="/opt/st/stm32cubeclt/GNU-tools-for-STM32/bin:${PATH}"

# Entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r//' /entrypoint.sh && chmod 755 /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bash"]
