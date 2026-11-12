set -eu
rm -f /tmp/homeops-ready
python -c 'import urllib.request; urllib.request.urlopen("http://provider-a:8000/v1/models", timeout=2)'
