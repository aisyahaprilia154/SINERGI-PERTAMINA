"""Build the interactive audit-report artifact from verified audit results."""

from __future__ import annotations

import json
from pathlib import Path


AUDIT_DIR = Path(__file__).resolve().parent
RESULTS_PATH = AUDIT_DIR / "mounting_audit_results.json"
OUTPUT_PATH = AUDIT_DIR / "mounting_audit_artifact.json"


def metric(label: str, field: str, fmt: str = "number") -> dict:
    return {"label": label, "field": field, "format": fmt}


def main() -> None:
    results = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
    overall = results["overall"]
    generated_at = results["audit_metadata"]["audit_generated_at"]
    dataset_version = overall["dataset_version_id"]

    summary = [{
        "poles": overall["poles"],
        "occupied_poles": overall["occupied_poles"],
        "empty_poles": overall["empty_poles"],
        "raw_mount_rate": overall["mount_rate"],
        "adjusted_mount_rate": overall["adjusted_mount_rate_excluding_explicit_indoor"],
        "actionable_unmounted": overall["expected_pole_unmounted_excluding_explicit_indoor"],
        "with_option": overall["expected_pole_unmounted_with_option_25m"],
        "without_option": overall["expected_pole_unmounted_without_option_25m"],
        "manual_relations": overall["manual_relations"],
        "jb_mismatches": overall["jb_pole_number_mismatches"],
    }]

    per_area = sorted(results["per_area"], key=lambda row: row["unmounted_assets"], reverse=True)
    actionable_reasons = results["actionable_unmounted_reason_buckets"]
    mismatches = sorted(
        results["jb_pole_number_mismatches"],
        key=lambda row: (row["area"], row["asset"]),
    )
    empty_poles = results["empty_poles"]

    source = {
        "id": "sinergi-active-topology",
        "label": "Verified SINERGI mounting audit — dataset-semarang active topology projection",
        "path": "audit/mounting_audit_results.json",
        "query": {
            "engine": "DuckDB over verified JSON audit output",
            "language": "SQL",
            "sql": "WITH audit AS (SELECT * FROM read_json_auto('audit/mounting_audit_results.json')) SELECT overall, per_area, actionable_unmounted_reason_buckets, empty_poles, jb_pole_number_mismatches FROM audit;",
            "description": "Reads the verified audit snapshot used by every report metric, chart, and table. The JSON was produced from the active SINERGI topology API by audit/mounting_audit.py.",
            "executed_at": generated_at,
            "tables_used": ["audit/mounting_audit_results.json"],
            "filters": [
                "branchId=semarang",
                "view=topology",
                f"datasetVersionId={dataset_version}",
                "actionable excludes assets explicitly classified as indoor/non-pole",
            ],
            "metric_definitions": [
                "Raw mount rate = confirmed mounting relations / all mountable CCTV and junction-box assets.",
                "Adjusted mount rate = confirmed relations / mountable assets excluding explicit indoor/non-pole assets.",
                "Occupied pole = pole targeted by at least one confirmed mounting relation.",
                "Mount option = backend-generated pole option within the configured 25 m review radius.",
            ],
        },
    }

    cards = [
        {
            "id": "pole-card",
            "description": "Inventory and actual utilization of poles across all nine areas.",
            "dataset": "summary",
            "sourceId": source["id"],
            "metrics": [
                metric("Tiang", "poles"),
                metric("Terisi", "occupied_poles"),
                metric("Kosong", "empty_poles"),
            ],
        },
        {
            "id": "mount-card",
            "description": "Raw and adjusted mounting completion.",
            "dataset": "summary",
            "sourceId": source["id"],
            "metrics": [
                metric("Mount rate mentah", "raw_mount_rate", "percent"),
                metric("Tanpa indoor", "adjusted_mount_rate", "percent"),
            ],
        },
        {
            "id": "gap-card",
            "description": "Devices that still need a mounting decision after indoor assets are excluded.",
            "dataset": "summary",
            "sourceId": source["id"],
            "metrics": [
                metric("Perlu review", "actionable_unmounted"),
                metric("Ada opsi ≤25 m", "with_option"),
                metric("Tanpa opsi", "without_option"),
            ],
        },
        {
            "id": "quality-card",
            "description": "Manual decisions and JB-to-pole numbering conflicts.",
            "dataset": "summary",
            "sourceId": source["id"],
            "metrics": [
                metric("Mount manual", "manual_relations"),
                metric("Flag nomor JB", "jb_mismatches"),
            ],
        },
    ]

    charts = [
        {
            "id": "area-rate-chart",
            "title": "Mount rate setelah aset indoor dikeluarkan",
            "subtitle": "Persentase per area; makin tinggi makin lengkap",
            "type": "bar",
            "dataset": "per_area",
            "sourceId": source["id"],
            "intent": "comparison",
            "question": "Area mana yang memiliki gap mounting terbesar secara proporsional?",
            "rationale": "Adjusted rate avoids penalizing areas for devices explicitly marked indoor/non-pole.",
            "encodings": {
                "x": {"field": "area", "type": "nominal", "title": "Area"},
                "y": {"field": "adjusted_mount_rate_excluding_explicit_indoor", "type": "quantitative", "title": "Mount rate"},
            },
            "valueFormat": "percent",
            "layout": {"width": "full", "height": 390},
            "labels": {"show": True},
            "settings": {"orientation": "horizontal", "sort": "ascending"},
        },
        {
            "id": "reason-chart",
            "title": "Penyebab 272 perangkat lapangan belum dimount",
            "subtitle": "Aset indoor/non-pole eksplisit sudah dikeluarkan",
            "type": "bar",
            "dataset": "actionable_reasons",
            "sourceId": source["id"],
            "intent": "composition",
            "question": "Berapa gap yang bisa masuk antrean review radius dan berapa yang membutuhkan perbaikan data?",
            "rationale": "Separates policy-radius backlog from assets with no nearby pole option.",
            "encodings": {
                "x": {"field": "reason", "type": "nominal", "title": "Status opsi"},
                "y": {"field": "assets", "type": "quantitative", "title": "Perangkat"},
            },
            "valueFormat": "number",
            "layout": {"width": "full", "height": 280},
            "labels": {"show": True},
            "settings": {"orientation": "horizontal", "sort": "descending"},
        },
    ]

    tables = [
        {
            "id": "area-table",
            "title": "Audit lengkap per area",
            "subtitle": "Urut dari jumlah perangkat belum dimount terbanyak",
            "dataset": "per_area",
            "sourceId": source["id"],
            "density": "compact",
            "layout": {"width": "full"},
            "defaultSort": {"field": "unmounted_assets", "direction": "desc"},
            "columns": [
                {"field": "area", "label": "Area", "type": "string"},
                {"field": "poles", "label": "Tiang", "type": "number"},
                {"field": "occupied_poles", "label": "Terisi", "type": "number"},
                {"field": "empty_poles", "label": "Kosong", "type": "number"},
                {"field": "mountable_assets", "label": "Perangkat", "type": "number"},
                {"field": "mounted_assets", "label": "Mounted", "type": "number"},
                {"field": "unmounted_assets", "label": "Unmounted", "type": "number"},
                {"field": "explicit_indoor_assets", "label": "Indoor", "type": "number"},
                {"field": "adjusted_mount_rate_excluding_explicit_indoor", "label": "Rate adjusted", "type": "number", "format": "percent"},
                {"field": "unmounted_with_option_25m", "label": "Ada opsi", "type": "number"},
                {"field": "unmounted_without_option_25m", "label": "Tanpa opsi", "type": "number"},
            ],
        },
        {
            "id": "empty-poles-table",
            "title": "Tiga tiang yang benar-benar belum memiliki perangkat",
            "dataset": "empty_poles",
            "sourceId": source["id"],
            "density": "compact",
            "layout": {"width": "half"},
            "defaultSort": {"field": "area", "direction": "asc"},
            "columns": [
                {"field": "area", "label": "Area", "type": "string"},
                {"field": "pole", "label": "Tiang", "type": "string"},
            ],
        },
        {
            "id": "mismatch-table",
            "title": "86 JB terpasang pada nomor tiang yang berbeda",
            "subtitle": "Flag audit—belum otomatis berarti salah karena mesin saat ini mengutamakan jarak terdekat",
            "dataset": "jb_mismatches",
            "sourceId": source["id"],
            "density": "compact",
            "layout": {"width": "full"},
            "defaultSort": {"field": "area", "direction": "asc"},
            "columns": [
                {"field": "area", "label": "Area", "type": "string"},
                {"field": "asset", "label": "Junction box", "type": "string"},
                {"field": "mounted_on", "label": "Tiang saat ini", "type": "string"},
                {"field": "source_number", "label": "No. JB", "type": "number"},
                {"field": "pole_number", "label": "No. tiang", "type": "number"},
                {"field": "distance_m", "label": "Jarak (m)", "type": "number", "format": "decimal"},
                {"field": "rule", "label": "Rule", "type": "string"},
            ],
        },
    ]

    blocks = [
        {"id": "title", "type": "markdown", "body": "# Audit Total Mounting Tiang SINERGI\nDataset aktif Semarang · versi `" + dataset_version + "`"},
        {
            "id": "executive-summary",
            "type": "markdown",
            "body": "## Executive Summary\n- **Tiangnya sebenarnya sudah masuk:** 161 tiang terdeteksi dan 158 (98,1%) sudah memiliki sedikitnya satu perangkat. Hanya tiga tiang benar-benar kosong.\n- **Gap utama ada pada perangkat:** dari 660 CCTV/JB, baru 297 dimount. Setelah 91 aset indoor/non-pole dikeluarkan, masih ada **272 perangkat lapangan** yang perlu keputusan mounting.\n- **Backlog manual tidak pernah diselesaikan:** 160 perangkat punya opsi tiang dalam 25 m, tetapi seluruh 297 relasi yang ada bersifat otomatis dan keputusan manual masih nol.\n- **Nomor dan geometri bertentangan:** 86 JB terpasang ke nomor tiang berbeda; ini perlu review bisnis sebelum koreksi massal.",
        },
        {"id": "metrics", "type": "metric-strip", "cardIds": ["pole-card", "mount-card", "gap-card", "quality-card"]},
        {
            "id": "pole-finding",
            "type": "markdown",
            "body": "## Masalah utamanya perangkat, bukan tiang\nDiagram per area memang hanya menampilkan tiang pada area yang sedang dipilih—misalnya Pengapon berisi 22 dari total 161 tiang cabang. Secara data, 98,1% tiang sudah terpakai. Karena itu audit berikut memusatkan perhatian pada perangkat yang belum memiliki relasi mounting.",
        },
        {"id": "area-rate", "type": "chart", "chartId": "area-rate-chart"},
        {
            "id": "area-commentary",
            "type": "markdown",
            "body": "FT Lomanis memiliki volume gap terbesar (70 aset belum dimount), sedangkan ITC LPG Cilacap memiliki mount rate adjusted terendah (40,9%). Pengapon relatif lebih lengkap pada 64,2%, tetapi tetap memiliki 33 aset mentah belum dimount—sembilan di antaranya indoor.",
        },
        {"id": "area-detail", "type": "table", "tableId": "area-table"},
        {
            "id": "policy-heading",
            "type": "markdown",
            "body": "## Radius otomatis dan antrean manual menciptakan gap\nMesin hanya auto-mount pada radius normal 5 m; kecocokan nomor dapat menjangkau 10 m; opsi review disediakan sampai 25 m. Namun kandidat formal hanya muncul untuk ambiguitas di dalam 5 m. Akibatnya aset pada jarak 5–25 m tersedia sebagai opsi tetapi tidak otomatis masuk keputusan mounting—dan dataset ini mencatat nol relasi manual maupun override.",
        },
        {"id": "reason-chart-block", "type": "chart", "chartId": "reason-chart"},
        {
            "id": "reason-commentary",
            "type": "markdown",
            "body": "Dari 272 perangkat lapangan yang belum dimount, **160 masih punya opsi tiang ≤25 m** dan cocok dijadikan antrean review manual. Sisanya **112 tidak memiliki opsi dalam 25 m**: kasus ini perlu pemeriksaan koordinat, klasifikasi indoor, atau asosiasi area/tiang—bukan sekadar memperlebar radius otomatis.",
        },
        {"id": "empty-heading", "type": "markdown", "body": "## Tiang yang benar-benar kosong"},
        {"id": "empty-poles", "type": "table", "tableId": "empty-poles-table"},
        {
            "id": "mismatch-heading",
            "type": "markdown",
            "body": "## Konflik nomor JB dan posisi perlu review\nSebanyak 86 dari 150 JB yang sudah mounted memiliki nomor berbeda dari tiang target. Rule `unique-nearest-pole` menjelaskan mayoritas kasus: geometri terdekat menang, bahkan ketika konvensi pengguna mengharapkan JB-11.x berada di bawah T-011. Flag ini harus ditelaah dengan peta/as-built sebelum mengubah relasi.",
        },
        {"id": "mismatches", "type": "table", "tableId": "mismatch-table"},
        {
            "id": "recommendations",
            "type": "markdown",
            "body": "## Rekomendasi tindakan\n1. Tambahkan status eksplisit `expectedMounting = pole | indoor | standalone`; jangan menyimpulkan semuanya dari nama aset.\n2. Buat antrean review untuk 160 perangkat yang sudah punya opsi ≤25 m, lengkap dengan jarak, nomor, dan preview peta.\n3. Audit koordinat serta klasifikasi 112 perangkat tanpa opsi ≤25 m; prioritaskan area FT Maos dan FT Tegal Baru yang paling banyak tanpa opsi.\n4. Review 86 konflik nomor JB–tiang dengan pemilik data sebelum koreksi; tetapkan apakah nomor atau koordinat yang menjadi sumber kebenaran.\n5. Tambahkan pemeriksaan publikasi: semua tiang terhitung, indoor tidak dimount, relasi tidak orphan/cross-area, dan setiap perangkat lapangan punya relasi atau alasan pengecualian.",
        },
        {
            "id": "further-questions",
            "type": "markdown",
            "body": "## Further Questions\n- Apakah nomor JB selalu wajib mengikuti nomor tiang, termasuk suffix seperti `.1`, `.2`, dan `-EXP`?\n- Siapa yang berwenang mengonfirmasi 160 opsi manual: admin cabang atau tim pusat?\n- Apakah 112 aset tanpa opsi memang indoor/standalone, atau koordinatnya belum akurat?",
        },
        {
            "id": "caveats",
            "type": "markdown",
            "body": "## Caveats and Assumptions\nAudit memakai snapshot dataset aktif pada 20 Agustus 2026 dan aturan mounting backend saat ini. Label indoor/non-pole berasal dari klasifikasi eksplisit pada data; aset yang belum diberi label bisa masih tercampur dalam 272 kasus actionable. Ketidaksamaan nomor JB–tiang adalah flag kualitas, bukan bukti final bahwa relasi salah. Seluruh hitungan resmi cocok dengan rekonsiliasi independen dan tidak ditemukan relasi orphan, cross-area, duplikat sumber, atau target non-tiang.",
            "sourceId": source["id"],
        },
    ]

    artifact = {
        "surface": "report",
        "sources": [source],
        "manifest": {
            "version": 1,
            "surface": "report",
            "title": "Audit Total Mounting Tiang SINERGI",
            "description": "Audit menyeluruh inventori tiang, tingkat mounting, aturan radius, dan konflik JB–tiang pada dataset aktif Semarang.",
            "generatedAt": generated_at,
            "cards": cards,
            "charts": charts,
            "tables": tables,
            "sources": [source],
            "blocks": blocks,
        },
        "snapshot": {
            "version": 1,
            "generatedAt": generated_at,
            "status": "ready",
            "datasets": {
                "summary": summary,
                "per_area": per_area,
                "actionable_reasons": actionable_reasons,
                "empty_poles": empty_poles,
                "jb_mismatches": mismatches,
            },
        },
    }

    OUTPUT_PATH.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
