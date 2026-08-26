"""Reproducible audit of physical pole mounting in the active SINERGI dataset."""

from __future__ import annotations

import csv
import json
import math
import os
import re
import statistics
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


API_URL = os.environ.get(
    "SINERGI_AUDIT_URL",
    "http://127.0.0.1:5000/api/datasets/dataset-semarang/active"
    "?branchId=semarang&view=topology",
)
API_TOKEN = os.environ.get("SINERGI_AUDIT_TOKEN", "local-admin")
OUTPUT_DIR = Path(__file__).resolve().parent


def fetch_payload() -> dict:
    request = urllib.request.Request(
        API_URL,
        headers={"Authorization": f"Bearer {API_TOKEN}"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def normalized(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def is_pole(asset: dict) -> bool:
    text = normalized(" ".join(str(asset.get(key) or "") for key in (
        "canonicalAssetType", "assetType", "type", "diagramClass", "name",
    )))
    return bool(re.search(r"\b(tiang|pole|pylon|physical mount)\b", text))


def is_mountable(asset: dict, graph_node_ids: set[str]) -> bool:
    if asset.get("id") not in graph_node_ids or is_pole(asset):
        return False
    diagram_class = normalized(asset.get("diagramClass"))
    source = normalized(" ".join(str(asset.get(key) or "") for key in (
        "name", "canonicalAssetType", "assetType", "type", "category",
    )))
    return diagram_class in {"junction peer", "junction extended", "endpoint"} \
        or bool(re.search(r"junction|\bjb\b|cctv|camera|kamera", source))


def asset_kind(asset: dict) -> str:
    text = normalized(" ".join(str(asset.get(key) or "") for key in (
        "name", "diagramClass", "sourceFolderPath", "assetType", "type",
    )))
    if re.search(r"junction|\bjb\b", text):
        return "Junction box"
    if re.search(r"cctv|camera|kamera|\bcam\b", text):
        return "Kamera CCTV"
    return "Perangkat lain"


def is_explicit_indoor(asset: dict) -> bool:
    text = normalized(" ".join(str(asset.get(key) or "") for key in (
        "name", "type", "assetType", "sourceFolderPath", "locationText",
    )))
    return bool(re.search(r"\bindoor\b|dalam ruang|ruangan", text))


def numeric_identity(name: object, role: str) -> int | None:
    value = normalized(name)
    pattern = (
        r"^(?:t|tiang|pole)\s*0*(\d+)\b"
        if role == "pole"
        else r"^(?:c|cam|cctv|camera|kamera|jb|junction box)\s*0*(\d+)\b"
    )
    match = re.match(pattern, value)
    return int(match.group(1)) if match else None


def area_key(asset: dict) -> str:
    return str(asset.get("locationGroupKey") or "tanpa-area")


def area_name(asset: dict) -> str:
    return str(asset.get("locationGroupName") or asset.get("locationGroupKey") or "Tanpa area")


def safe_rate(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = (len(ordered) - 1) * fraction
    lower = math.floor(index)
    upper = math.ceil(index)
    if lower == upper:
        return round(ordered[lower], 3)
    value = ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower)
    return round(value, 3)


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def audit(payload: dict) -> dict:
    assets = payload.get("assets") or []
    asset_by_id = {asset.get("id"): asset for asset in assets if asset.get("id")}
    graph_nodes = payload.get("topologyGraph", {}).get("nodes") or []
    graph_node_ids = {node.get("id") for node in graph_nodes if node.get("id")}
    relations = payload.get("mountingRelations") or []
    options = payload.get("mountingOptions") or []
    candidates = payload.get("mountingCandidates") or []
    overrides = payload.get("mountingOverrides") or []

    poles = [asset for asset in assets if asset.get("id") in graph_node_ids and is_pole(asset)]
    mountables = [asset for asset in assets if is_mountable(asset, graph_node_ids)]
    pole_ids = {asset["id"] for asset in poles}
    mountable_ids = {asset["id"] for asset in mountables}

    relations_by_source: dict[str, list[dict]] = defaultdict(list)
    relations_by_target: dict[str, list[dict]] = defaultdict(list)
    for relation in relations:
        relations_by_source[str(relation.get("sourceAssetId"))].append(relation)
        relations_by_target[str(relation.get("targetAssetId"))].append(relation)

    options_by_asset: dict[str, list[dict]] = defaultdict(list)
    for option in options:
        options_by_asset[str(option.get("assetId"))].append(option)
    for values in options_by_asset.values():
        values.sort(key=lambda item: (float(item.get("distanceMeters") or math.inf), str(item.get("targetAssetId"))))

    mounted_ids = mountable_ids.intersection(relations_by_source)
    unmounted_ids = mountable_ids - mounted_ids
    explicit_indoor_ids = {
        asset["id"] for asset in mountables if is_explicit_indoor(asset)
    }
    expected_pole_mount_ids = mountable_ids - explicit_indoor_ids
    expected_pole_mounted_ids = mounted_ids.intersection(expected_pole_mount_ids)
    expected_pole_unmounted_ids = unmounted_ids.intersection(expected_pole_mount_ids)
    occupied_pole_ids = pole_ids.intersection(relations_by_target)
    empty_pole_ids = pole_ids - occupied_pole_ids

    official_summary = payload.get("mountingSummary") or {}
    integrity = {
        "duplicate_source_assets": sorted(source for source, rows in relations_by_source.items() if len(rows) > 1),
        "orphan_sources": sorted(source for source in relations_by_source if source not in asset_by_id),
        "orphan_targets": sorted(target for target in relations_by_target if target not in asset_by_id),
        "non_mountable_sources": sorted(source for source in relations_by_source if source not in mountable_ids),
        "non_pole_targets": sorted(target for target in relations_by_target if target not in pole_ids),
        "unconfirmed_relations": sorted(
            str(row.get("relationId") or row.get("id"))
            for row in relations
            if normalized(row.get("verificationStatus")) != "confirmed"
        ),
        "cross_area_relations": [],
    }
    for relation in relations:
        source = asset_by_id.get(relation.get("sourceAssetId"))
        target = asset_by_id.get(relation.get("targetAssetId"))
        if source and target and area_key(source) != area_key(target):
            integrity["cross_area_relations"].append(str(relation.get("relationId") or relation.get("id")))

    per_area = []
    all_area_keys = sorted({area_key(asset) for asset in poles + mountables})
    for key in all_area_keys:
        area_poles = [asset for asset in poles if area_key(asset) == key]
        area_mountables = [asset for asset in mountables if area_key(asset) == key]
        area_mountable_ids = {asset["id"] for asset in area_mountables}
        area_pole_ids = {asset["id"] for asset in area_poles}
        area_mounted = area_mountable_ids.intersection(mounted_ids)
        area_unmounted = area_mountable_ids - area_mounted
        area_explicit_indoor = area_mountable_ids.intersection(explicit_indoor_ids)
        area_expected_mount_ids = area_mountable_ids - area_explicit_indoor
        area_expected_mounted = area_mounted.intersection(area_expected_mount_ids)
        unmounted_with_option = {asset_id for asset_id in area_unmounted if options_by_asset.get(asset_id)}
        nearest_option_distances = [
            float(options_by_asset[asset_id][0].get("distanceMeters"))
            for asset_id in unmounted_with_option
        ]
        per_area.append({
            "area_key": key,
            "area": area_name((area_poles or area_mountables)[0]),
            "poles": len(area_poles),
            "occupied_poles": len(area_pole_ids.intersection(occupied_pole_ids)),
            "empty_poles": len(area_pole_ids - occupied_pole_ids),
            "mountable_assets": len(area_mountables),
            "mounted_assets": len(area_mounted),
            "unmounted_assets": len(area_unmounted),
            "explicit_indoor_assets": len(area_explicit_indoor),
            "explicit_indoor_mounted": len(area_explicit_indoor.intersection(mounted_ids)),
            "explicit_indoor_unmounted": sum(
                1 for asset_id in area_unmounted if is_explicit_indoor(asset_by_id[asset_id])
            ),
            "mount_rate": safe_rate(len(area_mounted), len(area_mountables)),
            "adjusted_mount_rate_excluding_explicit_indoor": safe_rate(
                len(area_expected_mounted), len(area_expected_mount_ids)
            ),
            "unmounted_with_option_25m": len(unmounted_with_option),
            "unmounted_without_option_25m": len(area_unmounted - unmounted_with_option),
            "nearest_option_median_m": round(statistics.median(nearest_option_distances), 3)
                if nearest_option_distances else None,
        })
    per_area.sort(key=lambda row: (-row["unmounted_assets"], row["area"]))

    per_kind = []
    for kind in sorted({asset_kind(asset) for asset in mountables}):
        kind_assets = [asset for asset in mountables if asset_kind(asset) == kind]
        kind_ids = {asset["id"] for asset in kind_assets}
        kind_mounted = kind_ids.intersection(mounted_ids)
        per_kind.append({
            "asset_kind": kind,
            "mountable_assets": len(kind_assets),
            "mounted_assets": len(kind_mounted),
            "unmounted_assets": len(kind_ids - kind_mounted),
            "mount_rate": safe_rate(len(kind_mounted), len(kind_assets)),
        })
    per_kind.sort(key=lambda row: (-row["unmounted_assets"], row["asset_kind"]))

    option_buckets = Counter()
    actionable_option_buckets = Counter()
    unmounted_detail = []
    poles_by_area_number: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for pole in poles:
        number = numeric_identity(pole.get("name"), "pole")
        if number is not None:
            poles_by_area_number[(area_key(pole), number)].append(pole)

    family_expected_unmounted = []
    for asset_id in sorted(unmounted_ids):
        asset = asset_by_id[asset_id]
        nearest = options_by_asset.get(asset_id, [None])[0]
        if nearest is None:
            bucket = "Tidak ada opsi ≤25 m"
        else:
            distance = float(nearest.get("distanceMeters") or math.inf)
            if distance <= 5:
                bucket = "Opsi ≤5 m tetapi tidak dimount"
            elif distance <= 10:
                bucket = "Opsi >5–10 m"
            else:
                bucket = "Opsi >10–25 m"
        option_buckets[bucket] += 1
        if asset_id in expected_pole_mount_ids:
            actionable_option_buckets[bucket] += 1
        number = numeric_identity(asset.get("name"), "asset")
        matching_poles = poles_by_area_number.get((area_key(asset), number), []) if number is not None else []
        matching_ids = {pole["id"] for pole in matching_poles}
        matching_option = next(
            (option for option in options_by_asset.get(asset_id, []) if option.get("targetAssetId") in matching_ids),
            None,
        )
        row = {
            "asset_id": asset_id,
            "asset": asset.get("name") or asset_id,
            "asset_kind": asset_kind(asset),
            "explicit_indoor": is_explicit_indoor(asset),
            "area": area_name(asset),
            "nearest_option": asset_by_id.get((nearest or {}).get("targetAssetId"), {}).get("name") if nearest else None,
            "nearest_option_distance_m": (nearest or {}).get("distanceMeters"),
            "reason_bucket": bucket,
            "same_number_pole_exists": bool(matching_poles),
            "same_number_pole": ", ".join(str(pole.get("name")) for pole in matching_poles) or None,
            "same_number_option_distance_m": (matching_option or {}).get("distanceMeters"),
        }
        unmounted_detail.append(row)
        if matching_poles:
            family_expected_unmounted.append(row)

    name_mismatches = []
    for relation in relations:
        source = asset_by_id.get(relation.get("sourceAssetId"))
        target = asset_by_id.get(relation.get("targetAssetId"))
        if not source or not target or asset_kind(source) != "Junction box":
            continue
        source_number = numeric_identity(source.get("name"), "asset")
        target_number = numeric_identity(target.get("name"), "pole")
        if source_number is None or target_number is None or source_number == target_number:
            continue
        name_mismatches.append({
            "area": area_name(source),
            "asset": source.get("name"),
            "mounted_on": target.get("name"),
            "distance_m": relation.get("distanceMeters"),
            "source_number": source_number,
            "pole_number": target_number,
            "rule": ((relation.get("evidence") or [{}])[0]).get("ruleId"),
        })
    name_mismatches.sort(key=lambda row: (row["area"], str(row["asset"])))

    relation_distances = [float(row.get("distanceMeters")) for row in relations if row.get("distanceMeters") is not None]
    rule_counts = Counter(
        ((row.get("evidence") or [{}])[0]).get("ruleId") or "tanpa-rule"
        for row in relations
    )
    relation_distance_buckets = Counter()
    for distance in relation_distances:
        relation_distance_buckets[
            "≤5 m" if distance <= 5 else ">5–10 m" if distance <= 10 else ">10 m"
        ] += 1

    generated_at = max(
        [str(row.get("generatedAt")) for row in relations + options if row.get("generatedAt")]
        or [str(payload.get("datasetVersion", {}).get("activatedAt") or "")]
    )
    overall = {
        "dataset_version_id": payload.get("datasetVersion", {}).get("id"),
        "dataset_status": payload.get("datasetVersion", {}).get("status"),
        "activated_at": payload.get("datasetVersion", {}).get("activatedAt"),
        "mounting_generated_at": generated_at,
        "asset_rows": len(assets),
        "point_graph_nodes": len(graph_node_ids),
        "poles": len(poles),
        "mountable_assets": len(mountables),
        "mounted_assets": len(mounted_ids),
        "unmounted_assets": len(unmounted_ids),
        "explicit_indoor_assets": len(explicit_indoor_ids),
        "explicit_indoor_mounted": len(explicit_indoor_ids.intersection(mounted_ids)),
        "explicit_indoor_unmounted": sum(
            1 for asset_id in unmounted_ids if is_explicit_indoor(asset_by_id[asset_id])
        ),
        "expected_pole_mount_assets_excluding_explicit_indoor": len(expected_pole_mount_ids),
        "expected_pole_mounted_excluding_explicit_indoor": len(expected_pole_mounted_ids),
        "expected_pole_unmounted_excluding_explicit_indoor": len(expected_pole_unmounted_ids),
        "expected_pole_unmounted_with_option_25m": sum(
            1 for asset_id in expected_pole_unmounted_ids if options_by_asset.get(asset_id)
        ),
        "expected_pole_unmounted_without_option_25m": sum(
            1 for asset_id in expected_pole_unmounted_ids if not options_by_asset.get(asset_id)
        ),
        "adjusted_mount_rate_excluding_explicit_indoor": safe_rate(
            len(expected_pole_mounted_ids), len(expected_pole_mount_ids)
        ),
        "mount_rate": safe_rate(len(mounted_ids), len(mountables)),
        "occupied_poles": len(occupied_pole_ids),
        "empty_poles": len(empty_pole_ids),
        "pole_occupancy_rate": safe_rate(len(occupied_pole_ids), len(poles)),
        "mounting_relations": len(relations),
        "automatic_relations": sum(1 for row in relations if row.get("provenance") == "spatial_inference"),
        "manual_relations": sum(1 for row in relations if row.get("provenance") == "manual_admin"),
        "mounting_candidates": len(candidates),
        "mounting_options": len(options),
        "manual_overrides": len(overrides),
        "unmounted_with_option_25m": sum(1 for asset_id in unmounted_ids if options_by_asset.get(asset_id)),
        "unmounted_without_option_25m": sum(1 for asset_id in unmounted_ids if not options_by_asset.get(asset_id)),
        "jb_pole_number_mismatches": len(name_mismatches),
        "unmounted_with_same_number_pole": len(family_expected_unmounted),
    }

    reconciliation = {
        "official_pole_count": official_summary.get("poleCount"),
        "audited_pole_count": len(poles),
        "official_mountable_count": official_summary.get("mountableAssetCount"),
        "audited_mountable_count": len(mountables),
        "official_relation_count": official_summary.get("relationCount"),
        "audited_relation_count": len(relations),
        "counts_match": (
            official_summary.get("poleCount") == len(poles)
            and official_summary.get("mountableAssetCount") == len(mountables)
            and official_summary.get("relationCount") == len(relations)
        ),
    }

    return {
        "audit_metadata": {
            "audit_generated_at": datetime.now(timezone.utc).isoformat(),
            "source": "SINERGI active dataset topology projection",
            "api_path": "/api/datasets/dataset-semarang/active?branchId=semarang&view=topology",
            "mounting_policy": {
                "automatic_radius_m": official_summary.get("searchRadiusMeters"),
                "matching_identity_radius_m": official_summary.get("identityRadiusMeters"),
                "manual_option_radius_m": official_summary.get("optionRadiusMeters"),
                "ambiguity_delta_m": official_summary.get("ambiguityDeltaMeters"),
                "ambiguity_ratio": official_summary.get("ambiguityRatio"),
            },
        },
        "overall": overall,
        "reconciliation": reconciliation,
        "per_area": per_area,
        "per_asset_kind": per_kind,
        "unmounted_reason_buckets": [
            {"reason": key, "assets": value, "share_of_unmounted": safe_rate(value, len(unmounted_ids))}
            for key, value in sorted(option_buckets.items(), key=lambda item: (-item[1], item[0]))
        ],
        "actionable_unmounted_reason_buckets": [
            {"reason": key, "assets": value, "share_of_actionable_unmounted": safe_rate(value, len(expected_pole_unmounted_ids))}
            for key, value in sorted(actionable_option_buckets.items(), key=lambda item: (-item[1], item[0]))
        ],
        "relation_rule_counts": [
            {"rule": key, "relations": value, "share_of_relations": safe_rate(value, len(relations))}
            for key, value in sorted(rule_counts.items(), key=lambda item: (-item[1], item[0]))
        ],
        "relation_distance_buckets": [
            {"distance_bucket": key, "relations": relation_distance_buckets.get(key, 0)}
            for key in ("≤5 m", ">5–10 m", ">10 m")
        ],
        "relation_distance_summary_m": {
            "min": round(min(relation_distances), 3) if relation_distances else None,
            "median": round(statistics.median(relation_distances), 3) if relation_distances else None,
            "p90": percentile(relation_distances, 0.9),
            "max": round(max(relation_distances), 3) if relation_distances else None,
        },
        "integrity": {key: {"count": len(value), "ids": value} for key, value in integrity.items()},
        "empty_poles": [
            {"pole_id": asset["id"], "pole": asset.get("name"), "area": area_name(asset)}
            for asset in sorted((asset_by_id[asset_id] for asset_id in empty_pole_ids), key=lambda row: (area_name(row), str(row.get("name"))))
        ],
        "unmounted_assets": unmounted_detail,
        "unmounted_with_same_number_pole": family_expected_unmounted,
        "jb_pole_number_mismatches": name_mismatches,
    }


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    payload = fetch_payload()
    result = audit(payload)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with (OUTPUT_DIR / "mounting_audit_results.json").open("w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
    write_csv(OUTPUT_DIR / "mounting_audit_by_area.csv", result["per_area"])
    write_csv(OUTPUT_DIR / "mounting_audit_unmounted_assets.csv", result["unmounted_assets"])
    write_csv(OUTPUT_DIR / "mounting_audit_empty_poles.csv", result["empty_poles"])
    write_csv(OUTPUT_DIR / "mounting_audit_jb_pole_mismatches.csv", result["jb_pole_number_mismatches"])
    print(json.dumps({
        "overall": result["overall"],
        "reconciliation": result["reconciliation"],
        "per_area": result["per_area"],
        "unmounted_reason_buckets": result["unmounted_reason_buckets"],
        "relation_rule_counts": result["relation_rule_counts"],
        "relation_distance_summary_m": result["relation_distance_summary_m"],
        "integrity_counts": {key: value["count"] for key, value in result["integrity"].items()},
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
