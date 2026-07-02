# sethos proxy (scramjet + node-libcurl)

This folder contains a simple reverse proxy implementation that uses scramjet to read incoming request bodies and node-libcurl (libcurl bindings) to perform outbound requests. The implementation streams response bodies back to the client as they arrive.

Important notes
- This example buffers the entire incoming request body in memory before sending it to libcurl. For very large uploads you should extend the implementation to write the upload to a temporary file and use libcurl read callbacks.
- The project requires libcurl to be installed on the host system. node-libcurl is a native binding and links against system libcurl.

Installation

1) Install system libcurl

- Debian/Ubuntu:

sudo apt-get update
sudo apt-get install -y libcurl4-openssl-dev

- Fedora/CentOS:

sudo dnf install libcurl-devel

- macOS (Homebrew):

brew install curl

2) Install node dependencies

cd proxy
npm install

Usage

Set the TARGET_URL env var to the backend you want to proxy to. The proxy will append the incoming request path and query to TARGET_URL.

Example:

TARGET_URL=http://localhost:8000 PORT=3000 npm start

Requests to http://localhost:3000/foo will be proxied to http://localhost:8000/foo

Limitations & next steps
- Currently the request body is buffered in memory. For production use, implement a streaming upload using libcurl's read callback or write to a temp file.
- Add TLS certificate handling for inbound HTTPS if you need the proxy to terminate TLS.
- Add authentication, logging, timeouts, and rate-limiting as needed.

