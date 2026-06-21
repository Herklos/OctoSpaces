"""octospaces-sdk — Python port of the OctoSpaces headless spaces core."""

# ── Configuration ──────────────────────────────────────────────────────────────
from octospaces_sdk.core.config import (
    OctoSpacesConfig, configure_octo_spaces,
    get_sync_base, get_sync_namespace, get_sync_prefix,
    get_shared_spaces_namespace, get_events_url,
)
# ── KV adapter ─────────────────────────────────────────────────────────────────
from octospaces_sdk.core.adapters import (
    KvAdapter, MemoryKvAdapter, FileKvAdapter,
    configure_kv, kv_get, kv_set, kv_remove,
)
# ── Domain types ───────────────────────────────────────────────────────────────
from octospaces_sdk.core.types import (
    ID, NodeAccess, ObjectContentKind, ObjectNode, ObjectsIndex,
    ObjectType, PresenceStatus, PublicProfile, SealedBlob, Space,
    VerificationLevel, DeviceKeys,
)
from octospaces_sdk.core.storage_types import DerivedIdentity, PersistedSession, Vault
from octospaces_sdk.core.space_access_error import SpaceAccessError
# ── IDs ────────────────────────────────────────────────────────────────────────
from octospaces_sdk.core.ids import random_id, slugify
# ── Paths ─────────────────────────────────────────────────────────────────────
from octospaces_sdk.sync.paths import (
    OBJECT_COLLECTIONS, owner_scope, space_member_scope, node_member_scope,
    account_scope, linked_device_scope,
    keyring_name, keyring_pull, keyring_push,
    obj_index_name, obj_index_pull, obj_index_push,
    obj_log_name, obj_log_pull, obj_log_push,
    obj_doc_name, obj_doc_pull, obj_doc_push,
    obj_pub_name, obj_pub_pull, obj_pub_push,
    obj_inv_name, obj_inv_pull, obj_inv_push,
    object_blob_name, object_blob_pull, object_blob_push,
    types_index_name, types_index_pull, types_index_push,
    attachment_name, attachment_pull, attachment_push,
    object_dir_name, object_dir_pull,
    profile_pull, profile_push, spaces_pull, spaces_push,
    space_access_pull, space_access_push,
    space_id_from_node_id, space_id_from_cap,
    bytes_to_hex, user_id_from_ed_pub,
)
# ── Base64 ─────────────────────────────────────────────────────────────────────
from octospaces_sdk.sync.base64 import encode as base64_encode, decode as base64_decode
from octospaces_sdk.sync.base64url import to_base64_url, from_base64_url, from_base64_url_json
# ── Identity ────────────────────────────────────────────────────────────────────
from octospaces_sdk.sync.identity import (
    Session, derive_session, build_session,
    generate_seed_words, is_valid_seed,
    fingerprint_from_user_id, owner_trusted_adders,
)
# ── Client ─────────────────────────────────────────────────────────────────────
from octospaces_sdk.sync.client import (
    make_client, build_auth_headers,
    open_encryptor, build_encryptor, owner_ensure_keyring,
    read_profile, write_profile,
)
# ── Account seal ───────────────────────────────────────────────────────────────
from octospaces_sdk.sync.account_seal import (
    seal_to_self, unseal_from_self, seal_to_recipient, unseal_from_recipient,
)
# ── Space access ───────────────────────────────────────────────────────────────
from octospaces_sdk.sync.space_access import (
    NodeAccessHandle, get_node_access, build_node_access,
    get_space_client, clear_node_access_cache,
)
from octospaces_sdk.sync.space_access_store import (
    hydrate_space_access_store, get_space_access_entry, save_space_access_entry,
    remove_space_access_entry, get_node_access_entry, save_node_access_entry,
    remove_node_access_entry, local_space_access_entries,
    member_caps_from_store, link_access_from_store, clear_space_access_store,
)
# ── Pairing ────────────────────────────────────────────────────────────────────
from octospaces_sdk.sync.pairing import PAIR_PREFIX, PairResult, start_device_pairing, complete_device_pairing
# ── Registry ───────────────────────────────────────────────────────────────────
from octospaces_sdk.spaces.registry import (
    SpaceMeta, SpaceMetaUpdate,
    create_space, read_spaces, read_space_access, write_space_access,
    add_space_member, remove_space_member,
    add_joined_space, add_joined_space_with_cap, add_joined_space_with_link_access,
    update_spaces_doc, write_spaces, reorder_spaces,
    on_space_meta, broadcast_space_meta,
)
# ── Members ────────────────────────────────────────────────────────────────────
from octospaces_sdk.spaces.members import (
    JoinRequest, SpaceInviteLinkToken,
    make_join_request, accept_space_invite,
    encode_space_invite_link, decode_space_invite_link,
    create_space_invite_link, join_space_by_link,
    recover_space_access, add_device_to_space_keyring,
)
# ── Nodes ──────────────────────────────────────────────────────────────────────
from octospaces_sdk.spaces.nodes import (
    CreateNodeInput, NodeInviteBundle, NodeInviteLinkToken,
    create_node, set_node_access, invite_to_node, accept_node_invite,
    encode_node_invite_link, decode_node_invite_link,
    create_node_invite_link, join_node_by_link,
)
# ── Object index ────────────────────────────────────────────────────────────────
from octospaces_sdk.spaces.object_index import (
    push_index_seed, seed_space_object_index,
    update_object_index, read_object_tree,
)
# ── Object tree ─────────────────────────────────────────────────────────────────
from octospaces_sdk.objects.objects import (
    ObjectTreeNode, build_tree, add_object, patch_object, reparent_object,
    reorder_objects, archive_object, breadcrumbs, ancestors, subtree_ids, next_order,
)
# ── Search ─────────────────────────────────────────────────────────────────────
from octospaces_sdk.utils.search_match import (
    MatchRange, TitleMatch, RankedResult,
    fold, is_word_start, match_title, rank_results,
)
# ── Invite preview ─────────────────────────────────────────────────────────────
from octospaces_sdk.utils.invite_preview import (
    InvitePreview, SpaceLinkPreview, NodeLinkPreview, MemberBundlePreview, preview_invite,
)
# ── Live sync bus ──────────────────────────────────────────────────────────────
from octospaces_sdk.utils.live_sync_bus import (
    register_pull, dispatch_doc_change, emit_sse_status, on_sse_status, clear_live_sync_bus,
)
# ── Caches ────────────────────────────────────────────────────────────────────
from octospaces_sdk.sync.pull_cache import PULL_CACHE_MAX_AGE_MS, cache_pull, load_cached_pull
from octospaces_sdk.sync.profile_cache import cache_profile, load_cached_profile
from octospaces_sdk.sync.fetch_timeout import CONNECT_TIMEOUT_MS, make_http_client
