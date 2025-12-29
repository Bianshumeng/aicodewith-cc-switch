FROM rust:1.88-bookworm AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release --locked

FROM node:20-alpine AS ui-builder

WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm install --no-audit --no-fund
COPY ui .
RUN npm run build

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/aicodewith-management-server /app/server
COPY migrations /app/migrations
COPY --from=ui-builder /ui/dist /app/ui

ENV RUST_LOG=info
EXPOSE 8080

CMD ["/app/server"]
