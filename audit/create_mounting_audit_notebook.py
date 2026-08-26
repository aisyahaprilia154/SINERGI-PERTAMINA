"""Create a reviewable notebook companion from the verified mounting audit output."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RESULTS_PATH = ROOT / "mounting_audit_results.json"
NOTEBOOK_PATH = ROOT / "mounting_audit.ipynb"


def markdown(source: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": source.splitlines(keepends=True)}


def code(source: str, output: str = "") -> dict:
    outputs = []
    if output:
        outputs.append({"name": "stdout", "output_type": "stream", "text": output.splitlines(keepends=True)})
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": outputs,
        "source": source.splitlines(keepends=True),
    }


def table_text(rows: list[dict], fields: list[str]) -> str:
    widths = {field: max(len(field), *(len(str(row.get(field, ""))) for row in rows)) for field in fields}
    header = " | ".join(field.ljust(widths[field]) for field in fields)
    divider = "-+-".join("-" * widths[field] for field in fields)
    body = [" | ".join(str(row.get(field, "")).ljust(widths[field]) for field in fields) for row in rows]
    return "\n".join([header, divider, *body]) + "\n"


def main() -> None:
    results = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
    overall = results["overall"]
    summary_text = json.dumps(overall, ensure_ascii=False, indent=2) + "\n"
    area_fields = [
        "area", "poles", "occupied_poles", "empty_poles", "mountable_assets",
        "mounted_assets", "unmounted_assets", "explicit_indoor_unmounted", "mount_rate",
        "adjusted_mount_rate_excluding_explicit_indoor",
        "unmounted_with_option_25m", "unmounted_without_option_25m",
    ]
    reason_fields = ["reason", "assets", "share_of_unmounted"]
    integrity_counts = {
        key: value["count"] for key, value in results["integrity"].items()
    }
    cells = [
        markdown("# Audit Total Mounting Tiang SINERGI\n"),
        markdown(
            "## tl;dr\n\n"
            f"- Snapshot aktif memiliki **{overall['poles']} tiang** dan **{overall['mountable_assets']} perangkat yang dapat dimount**.\n"
            f"- Baru **{overall['mounted_assets']} perangkat ({overall['mount_rate']:.1%})** mempunyai relasi mounting; "
            f"**{overall['unmounted_assets']} perangkat** belum dimount.\n"
            f"- Dari perangkat yang belum dimount, **{overall['explicit_indoor_unmounted']}** eksplisit berlabel indoor/non-tiang. "
            f"Setelah dikeluarkan, coverage mounting menjadi **{overall['adjusted_mount_rate_excluding_explicit_indoor']:.1%}**.\n"
            f"- Hanya **{overall['empty_poles']} tiang** yang benar-benar kosong. Masalah utama adalah perangkat yang belum terikat, bukan inventaris tiang yang hilang.\n"
            f"- **{overall['unmounted_with_option_25m']} perangkat** belum dimount walaupun memiliki opsi tiang dalam 25 m; "
            f"**{overall['unmounted_without_option_25m']}** tidak mempunyai opsi dalam radius tersebut.\n"
        ),
        markdown(
            "## Context & Methods\n\n"
            "Audit menggunakan proyeksi topology dataset aktif cabang Semarang dan merekonsiliasi inventaris aset, graph node, "
            "mountingRelations, mountingOptions, mountingCandidates, serta mountingOverrides. Grain utama adalah satu perangkat yang "
            "dapat dimount; grain tiang dihitung terpisah.\n\n"
            "### Key Assumptions\n\n"
            "- Tiang ditentukan dari klasifikasi pole/tiang/physical mount pada point graph node.\n"
            "- Perangkat mountable mengikuti klasifikasi backend: kamera, junction box, dan JB rack yang cocok.\n"
            "- Opsi 25 m bukan relasi terkonfirmasi; opsi hanya menunjukkan kandidat penetapan manual.\n"
        ),
        markdown("## Data\n"),
        code(
            "from pathlib import Path\n"
            "import json\n\n"
            "results = json.loads(Path('mounting_audit_results.json').read_text(encoding='utf-8'))\n"
            "results['reconciliation']\n",
            json.dumps(results["reconciliation"], ensure_ascii=False, indent=2) + "\n",
        ),
        markdown("## Results\n\n### Overall mounting profile\n"),
        code("results['overall']\n", summary_text),
        markdown("### Coverage by area\n"),
        code(
            "area_fields = " + repr(area_fields) + "\n"
            "[{field: row[field] for field in area_fields} for row in results['per_area']]\n",
            table_text(results["per_area"], area_fields),
        ),
        markdown("### Why devices remain unmounted\n"),
        code("results['unmounted_reason_buckets']\n", table_text(results["unmounted_reason_buckets"], reason_fields)),
        markdown("### Referential-integrity checks\n"),
        code(
            "{key: value['count'] for key, value in results['integrity'].items()}\n",
            json.dumps(integrity_counts, ensure_ascii=False, indent=2) + "\n",
        ),
        markdown(
            "## Takeaways\n\n"
            "1. Kesenjangan terbesar berasal dari radius otomasi 5 m yang konservatif dan belum adanya keputusan manual.\n"
            "2. Opsi mounting tersedia untuk sebagian besar kasus yang dekat, tetapi kandidat di luar 5 m tidak otomatis menjadi antrean keputusan.\n"
            "3. Integritas referensial relasi yang sudah terbentuk bersih; risiko utama adalah kelengkapan dan kebenaran pasangan, bukan orphan atau duplikasi.\n"
            "4. Ketidakcocokan nomor JB–tiang harus ditinjau sebagai flag audit, karena nomor yang berbeda belum tentu salah secara fisik tetapi bertentangan dengan konvensi yang diharapkan pengguna.\n"
        ),
    ]
    notebook = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    NOTEBOOK_PATH.write_text(json.dumps(notebook, ensure_ascii=False, indent=1), encoding="utf-8")
    parsed = json.loads(NOTEBOOK_PATH.read_text(encoding="utf-8"))
    assert parsed["nbformat"] == 4 and parsed["cells"], "Notebook structure invalid"
    print(f"Notebook created: {NOTEBOOK_PATH}")


if __name__ == "__main__":
    main()
