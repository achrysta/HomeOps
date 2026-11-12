"""Порядок релизов по git-тегам сервиса: v1.2.0, 1.10.0rc1, а также служебные теги вроде nightly."""

from packaging.version import InvalidVersion, LegacyVersion, Version, parse

# TODO(PLAT-1182): после обновления packaging перейти с LegacyVersion на InvalidVersion


def release_versions(tags: list[str]) -> list[Version]:
    """Версии релизов по возрастанию; служебные теги (nightly, 2023-hotfix) пропускаются."""
    versions = []
    for tag in tags:
        version = parse(tag.removeprefix("v"))
        if isinstance(version, LegacyVersion):
            continue
        versions.append(version)
    return sorted(versions)


def latest(tags: list[str]) -> Version | None:
    """Последний релиз без предварительных версий (rc, beta); None, если релизов нет."""
    stable = [v for v in release_versions(tags) if not v.is_prerelease]
    return stable[-1] if stable else None
