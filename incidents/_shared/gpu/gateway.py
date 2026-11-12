"""Учебный proxy с фиксированным backend. Редактируется только model name в config."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/v1/chat/completions':
            self.send_error(404)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 1 or size > 65536:
                self.send_error(413)
                return
            request = json.loads(self.rfile.read(size))
            if not isinstance(request, dict):
                self.send_error(400)
                return
            config = json.loads(Path('/scenario/config/gateway.json').read_text())
            request['model'] = config['model']
            response = urlopen(Request('http://model:8000/v1/chat/completions', data=json.dumps(request).encode(), headers={'Content-Type': 'application/json'}), timeout=60)
            with response:
                body = response.read(1024 * 1024)
                self.send_response(response.status)
        except HTTPError as error:
            body = error.read(65536)
            self.send_response(error.code)
        except (URLError, OSError, ValueError, KeyError) as error:
            body = json.dumps({'error': str(error)}).encode()
            self.send_response(503)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
