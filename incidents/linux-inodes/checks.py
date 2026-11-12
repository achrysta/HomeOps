"""Проверки инцидента linux-inodes. Выполняются внутри учебного сервера."""

import hashlib
import os
import subprocess
import time

from incident_kit import RequestError, check, fail, http

MEDIA = "/srv/media"
CACHE = "/srv/media/cache"
MANIFEST = "/var/lib/homeops/originals.sha256"


def systemctl(*args: str) -> str:
    return subprocess.run(["systemctl", *args], capture_output=True, text=True).stdout.strip()


@check("upload", "Загрузка фотографий снова работает", live=True)
def upload():
    try:
        r = http("POST", "http://127.0.0.1:8081/upload", body=b"probe", timeout=5)
    except RequestError as e:
        fail(f"media-api не отвечает на :8081 ({e}).")
    if r.status != 201:
        fail(f"POST /upload отвечает HTTP {r.status}: {r.text.strip()[:120]}")
    name = r.json().get("saved", "")
    # проверочный файл не оставляем среди фотографий пользователей
    if name:
        try:
            os.remove(os.path.join(MEDIA, "originals", name))
        except OSError:
            pass
    return "POST /upload → 201, файл сохраняется."


@check("inodes", "На разделе /srv/media занято меньше половины inode", live=True)
def inodes():
    st = os.statvfs(MEDIA)
    used = st.f_files - st.f_ffree
    share = used / st.f_files
    if share >= 0.5:
        fail(f"inode на /srv/media заняты на {share:.0%} ({used} из {st.f_files}) — место в байтах тут ни при чём.")
    return f"inode заняты на {share:.0%} ({used} из {st.f_files})."


@check("originals", "Фотографии пользователей на месте и не изменены", live=True)
def originals():
    missing, changed = 0, 0
    for line in open(MANIFEST, encoding="utf-8"):
        digest, path = line.split()
        try:
            data = open(path, "rb").read()
        except OSError:
            missing += 1
            continue
        if hashlib.sha256(data).hexdigest() != digest:
            changed += 1
    if missing or changed:
        fail(f"Из 200 фотографий пропало {missing}, изменено {changed}. Чистить можно только кэш миниатюр.")
    return "Все 200 фотографий на месте."


@check("generator", "Генератор миниатюр работает и сохраняет новые файлы", live=True)
def generator():
    if systemctl("is-active", "thumbnailer") != "active":
        fail("thumbnailer не работает. Миниатюры нужны сайту: останавливать генератор — не решение.")
    newest = max((e.stat().st_mtime for e in os.scandir(CACHE) if e.is_file()), default=0)
    if time.time() - newest > 30:
        fail("thumbnailer запущен, но новых миниатюр в /srv/media/cache нет больше 30 секунд.")
    return "thumbnailer активен, новые миниатюры появляются."


@check("cleanup", "Очистка кэша по таймеру действительно удаляет старые миниатюры", needs=["inodes", "generator"])
def cleanup():
    if systemctl("is-enabled", "thumbs-clean.timer") != "enabled" or systemctl("is-active", "thumbs-clean.timer") != "active":
        fail("Таймер thumbs-clean.timer выключен — кэш снова заполнится.")
    # пробные миниатюры того же вида, что пишет генератор, «возрастом» 30 минут
    old = time.time() - 1800
    probes = [os.path.join(CACHE, f"thumb-{int(old * 1e9) + i}.webp") for i in range(50)]
    try:
        for p in probes:
            open(p, "wb").close()
            os.utime(p, (old, old))
    except OSError as e:
        for p in probes:
            if os.path.exists(p):
                os.remove(p)
        fail(f"Не удалось создать пробные миниатюры для проверки очистки: {e.strerror}.")
    run = subprocess.run(["systemctl", "start", "thumbs-clean.service"], capture_output=True, text=True, timeout=120)
    left = [p for p in probes if os.path.exists(p)]
    for p in left:
        os.remove(p)
    if run.returncode != 0:
        fail(f"thumbs-clean.service завершился с ошибкой: {run.stderr.strip()[-200:]}")
    if left:
        fail(f"Очистка отработала, но из 50 миниатюр старше 30 минут осталось {len(left)}: проверьте, какие файлы она ищет.")
    return "Очистка удаляет миниатюры старше порога, таймер включён."
