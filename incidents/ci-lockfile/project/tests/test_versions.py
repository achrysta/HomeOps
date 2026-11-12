from release_notes.versions import latest, release_versions


def names(tags: list[str]) -> list[str]:
    return [str(v) for v in release_versions(tags)]


def test_versions_sorted_numerically():
    assert names(["v1.10.0", "v1.2.0", "v1.9.3"]) == ["1.2.0", "1.9.3", "1.10.0"]


def test_prerelease_goes_before_release():
    assert names(["2.0.0", "2.0.0rc1", "v1.9.0"]) == ["1.9.0", "2.0.0rc1", "2.0.0"]


def test_service_tags_are_skipped():
    assert names(["v1.0.0", "2023-hotfix", "nightly", "v1.1.0"]) == ["1.0.0", "1.1.0"]


def test_latest_ignores_prereleases_and_service_tags():
    assert str(latest(["v0.9.0", "v1.0.0", "v1.1.0rc2", "release-candidate"])) == "1.0.0"


def test_latest_without_releases():
    assert latest(["nightly", "staging"]) is None
