# ============================================
# Stage 1: Extract pre-downloaded STM32CubeCLT
# ============================================
# The installer zip is downloaded in GitHub Actions (download-cubeclt.js)
# before this build runs — no credentials needed inside Docker.
FROM ubuntu:22.04 AS extractor

ARG CUBECLT_VERSION=1.16.0

RUN apt-get update && \
    apt-get install -y --no-install-recommends unzip ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# The workflow places the downloaded .sh.zip in cubeclt_download/
COPY cubeclt_download/ /cubeclt_download/

RUN echo ">>> Extracting STM32CubeCLT ${CUBECLT_VERSION}..." && \
    mkdir -p /cubeclt_installer && \
    ARCHIVE=$(ls -1 /cubeclt_download/*.zip 2>/dev/null | head -1) && \
    if [ -z "$ARCHIVE" ]; then \
        echo "ERROR: No archive found in /cubeclt_download (download step may have failed)"; \
        exit 1; \
    fi && \
    unzip -q "$ARCHIVE" -d /cubeclt_installer && \
    echo ">>> Extraction complete" && \
    ls -lh /cubeclt_installer

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
COPY --from=extractor /cubeclt_installer /opt/cubeclt-installer

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
