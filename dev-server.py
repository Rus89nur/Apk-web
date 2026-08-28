#!/usr/bin/env python3
"""Локальный сервер без кэша — для Simple Browser в Cursor и обычного браузера."""
import http.server
import socketserver

PORT = 3000


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class ReusableTCPServer(socketserver.TCPServer):
    # Позволяет быстро перезапускать сервер без ожидания освобождения порта.
    allow_reuse_address = True


if __name__ == "__main__":
    with ReusableTCPServer(("127.0.0.1", PORT), DevHandler) as httpd:
        print(f"Dev-сервер: http://localhost:{PORT}/")
        print("Остановка: Ctrl+C")
        httpd.serve_forever()
