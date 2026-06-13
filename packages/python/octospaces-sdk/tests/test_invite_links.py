"""Cross-language conformance tests for spaces/members.py + spaces/nodes.py link encode/decode.

Consumes tests/test-vectors/invite-links.json.
"""
from __future__ import annotations

from octospaces_sdk.spaces.members import decode_space_invite_link, encode_space_invite_link
from octospaces_sdk.spaces.nodes import decode_node_invite_link, encode_node_invite_link

from .conftest import load_vector

V = load_vector("invite-links.json")


def test_space_invite_link_encode():
    token = V["spaceToken"]["token"]
    expected_link = V["spaceToken"]["full_link"]
    result = encode_space_invite_link(V["origin"], token)
    assert result == expected_link


def test_space_invite_link_decode():
    fragment = V["spaceToken"]["encoded_fragment"]
    expected = V["spaceToken"]["decoded"]
    result = decode_space_invite_link(fragment)
    assert result == expected


def test_space_invite_link_roundtrip():
    token = V["spaceToken"]["token"]
    link = encode_space_invite_link(V["origin"], token)
    fragment = link.split("#", 1)[1]
    decoded = decode_space_invite_link(fragment)
    assert decoded == token


def test_node_invite_link_encode():
    token = V["nodeToken"]["token"]
    expected_link = V["nodeToken"]["full_link"]
    result = encode_node_invite_link(V["origin"], token)
    assert result == expected_link


def test_node_invite_link_decode():
    fragment = V["nodeToken"]["encoded_fragment"]
    expected = V["nodeToken"]["decoded"]
    result = decode_node_invite_link(fragment)
    assert result == expected


def test_node_invite_link_roundtrip():
    token = V["nodeToken"]["token"]
    link = encode_node_invite_link(V["origin"], token)
    fragment = link.split("#", 1)[1]
    decoded = decode_node_invite_link(fragment)
    assert decoded == token
