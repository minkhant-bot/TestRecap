# Use an official lightweight Node.js 20 Debian image
FROM node:20-bookworm-slim

# Set production environment variables
ENV NODE_ENV=production
ENV PATH="/opt/venv/bin:$PATH"

# Install system dependencies: Python 3, venv, development tools, and ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    gcc \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

# Set up the working directory inside the container
WORKDIR /app

# Copy python package requirements first for efficient layer caching
COPY requirements.txt ./

# Create a virtual environment and install faster-whisper and python dependencies
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

# Copy package configurations
COPY package*.json ./

# Install npm dependencies (including devDependencies required to build the Vite client)
RUN npm install

# Copy the rest of the application files
COPY . .

# Pre-download and cache the faster-whisper model during the build stage
# This ensures zero runtime downloads and complete offline execution
RUN /opt/venv/bin/python3 src/ai/download_model.py

# Build the client-side React code with Vite
RUN npm run build


# Start the full-stack server
CMD ["node", "server.js"]
