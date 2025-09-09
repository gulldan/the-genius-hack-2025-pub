# syntax=docker/dockerfile:1

# Build stage: compile Bun app to native binary
FROM oven/bun:1 AS build
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and compile
COPY . .
# Optional: build CSS assets if tailwindcss is present
# RUN bun run build:css
RUN bun build src/server.ts --compile --outfile=server

# Final minimal runtime image
FROM gcr.io/distroless/cc-debian12
WORKDIR /app

# Copy CA certificates for HTTPS requests
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# Copy binary and required assets
COPY --from=build /app/server /app/server
COPY --from=build /app/public ./public
COPY --from=build /app/src/views ./src/views
COPY --from=build /app/src/sql ./src/sql
COPY --from=build /app/volunteer.db ./volunteer.db

EXPOSE 3000
USER nonroot
ENTRYPOINT ["/app/server"]
