"""Cross-language conformance tests for sync/paths.py and core/ids.py.

Consumes tests/test-vectors/paths-scopes.json, user-id.json, room-slug.json,
base64url.json.
"""
from __future__ import annotations

import pytest

from octospaces_sdk.core.ids import slugify
from octospaces_sdk.sync.base64url import from_base64_url_json, to_base64_url
from octospaces_sdk.sync.paths import (
    OBJECT_COLLECTIONS,
    account_scope,
    keyring_pull,
    keyring_push,
    linked_device_scope,
    node_member_scope,
    obj_index_pull,
    obj_index_push,
    owner_scope,
    profile_pull,
    profile_push,
    space_access_pull,
    space_access_push,
    space_member_scope,
    spaces_pull,
    spaces_push,
    user_id_from_ed_pub,
)

from .conftest import load_vector

V_PATHS = load_vector("paths-scopes.json")
V_USER_ID = load_vector("user-id.json")
V_SLUG = load_vector("room-slug.json")
V_B64 = load_vector("base64url.json")


# ── userId ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("case", V_USER_ID["vectors"])
def test_user_id_from_ed_pub(case):
    result = user_id_from_ed_pub(case["edPub"])
    assert result == case["userId"]
    assert len(result) == 32  # 16 bytes → 32 hex chars


# ── slugify ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("case", V_SLUG["vectors"])
def test_slugify(case):
    result = slugify(case["input"])
    assert result == case["expected"], f"slugify({case['input']!r}): got {result!r}"


# ── path builders ─────────────────────────────────────────────────────────────


def test_path_builders():
    p = V_PATHS["paths"]
    si = V_PATHS["path_inputs"]["spaceId"]
    ui = V_PATHS["path_inputs"]["userId"]
    assert keyring_pull(si) == p["keyringPull"]
    assert keyring_push(si) == p["keyringPush"]
    assert obj_index_pull(si) == p["objIndexPull"]
    assert obj_index_push(si) == p["objIndexPush"]
    assert profile_pull(ui) == p["profilePull"]
    assert profile_push(ui) == p["profilePush"]
    assert spaces_pull(ui) == p["spacesPull"]
    assert spaces_push(ui) == p["spacesPush"]
    assert space_access_pull(si) == p["spaceAccessPull"]
    assert space_access_push(si) == p["spaceAccessPush"]


def test_scopes():
    s = V_PATHS["scopes"]
    si = V_PATHS["path_inputs"]["spaceId"]
    ni = V_PATHS["path_inputs"]["nodeId"]
    ui = V_PATHS["path_inputs"]["userId"]
    assert owner_scope() == s["owner"]
    assert space_member_scope(si, True) == s["spaceMember_write"]
    assert space_member_scope(si, False) == s["spaceMember_read"]
    assert node_member_scope(si, ni, True) == s["nodeMember_write"]
    assert node_member_scope(si, ni, False) == s["nodeMember_read"]
    assert account_scope(ui) == s["account"]
    assert linked_device_scope(ui) == s["linkedDevice"]


def test_object_collections():
    assert OBJECT_COLLECTIONS == V_PATHS["OBJECT_COLLECTIONS"]


# ── base64url ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("case", V_B64["vectors"])
def test_base64url_roundtrip(case):
    encoded = to_base64_url(case["object"])
    assert encoded == case["encoded"], (
        f"to_base64_url({case['object']!r}): got {encoded!r}, want {case['encoded']!r}"
    )
    decoded = from_base64_url_json(encoded)
    assert decoded == case["roundtrip"]
