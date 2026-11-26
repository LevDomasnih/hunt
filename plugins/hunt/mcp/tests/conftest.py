"""Offline test setup: isolated config dir, in-memory keyring, fixture region packs.
Nothing here touches the real keychain, ~/.config/hunt or the network."""
import sys
from pathlib import Path

import pytest

MCP_DIR = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(MCP_DIR))


class MemoryKeyring:
    def __init__(self):
        self.store = {}

    def get_password(self, service, user):
        return self.store.get((service, user))

    def set_password(self, service, user, value):
        self.store[(service, user)] = value


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("HUNT_CONFIG_DIR", str(tmp_path / "cfg"))
    monkeypatch.setenv("HUNT_REGIONS", str(FIXTURES / "regions"))
    for k in ("HUNT_API_URL", "HUNT_TOKEN", "CLAUDE_PLUGIN_ROOT"):
        monkeypatch.delenv(k, raising=False)
    kr = MemoryKeyring()
    import keyring

    monkeypatch.setattr(keyring, "get_password", kr.get_password)
    monkeypatch.setattr(keyring, "set_password", kr.set_password)
    return kr


# Checks of the real country packs: they live in a data repository, so without it these are skipped.
REAL_PACKS = {"test_real_country_packs_define_the_default_rings", "test_region_packs_have_useful_lists", "test_bali_has_the_rental_chats_and_apps",
              "test_region_doc_reads_useful", "test_generic_events_yaml_exists", "test_bali_kecak_is_a_verified_daily_source",
              "test_useful_and_sources_events_flags_are_links", "test_bali_party_rules_are_honest", "test_bali_organizer_sources", "test_region_doc_reads_events_yaml"}


def pytest_collection_modifyitems(items):
    from _regions import real_regions
    if (real_regions() / "bali" / "pack.yaml").exists():
        return
    for it in items:
        if it.originalname in REAL_PACKS if hasattr(it, "originalname") else it.name in REAL_PACKS:
            it.add_marker(pytest.mark.skip(reason="no country packs here (data repository)"))
