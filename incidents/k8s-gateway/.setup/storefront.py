"""Витрина магазина: HTML-страницы по любому пути."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = f"<html><body data-app=\"storefront\"><h1>Маркет</h1><p>страница {self.path}</p></body></html>".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("", 8080), Handler).serve_forever()
