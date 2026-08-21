"""Benchmark lightweight scalar surrogate models on the 100-case DOE."""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
import csv
import json
import traceback

import numpy as np

from fusion_blanket_twin.surrogate.features import (
    ScalarSurrogateDataset,
    extract_dataset_from_registry,
    validate_scalar_dataset,
)
from fusion_blanket_twin.surrogate.metrics import calculate_regression_metrics
from fusion_blanket_twin.surrogate.models import default_model_factories
from fusion_blanket_twin.surrogate.splits import all_validation_splits, assert_no_leakage


COMPARISON_CSV = "model_comparison.csv"
PREDICTIONS_CSV = "heldout_predictions.csv"
SUMMARY_JSON = "benchmark_summary.json"


def run_benchmark(
    dataset: ScalarSurrogateDataset,
    output_dir: Path,
) -> dict[str, object]:
    sanity = validate_scalar_dataset(dataset)
    if not sanity.is_valid:
        raise ValueError("scalar dataset failed sanity checks: " + "; ".join(sanity.issues))

    comparison_rows: list[dict[str, object]] = []
    prediction_rows: list[dict[str, object]] = []
    model_metadata: dict[str, dict[str, object]] = {}
    splits = all_validation_splits(dataset)

    for output_name in dataset.output_names:
        y = dataset.output(output_name)
        for model_name, factory in default_model_factories():
            for split in splits:
                assert_no_leakage(split)
                model = factory()
                try:
                    model.fit(dataset.X[split.train_indices], y[split.train_indices])
                    y_pred = model.predict(dataset.X[split.test_indices])
                    model_metadata[model.name] = dict(model.metadata)
                    metrics = calculate_regression_metrics(
                        y[split.test_indices],
                        y_pred,
                        [dataset.case_ids[index] for index in split.test_indices],
                    )
                    in_domain = model.in_domain_mask(dataset.X[split.test_indices])
                    comparison_rows.append(
                        {
                            "status": "ok",
                            "output": output_name,
                            "model": model.name,
                            "validation_split": split.name,
                            "validation_family": split.family,
                            "region": split.region,
                            "heldout_axis": split.heldout_axis or "",
                            "heldout_level": split.heldout_level or "",
                            "n_train": len(split.train_indices),
                            "n_test": len(split.test_indices),
                            "mae": metrics.mae,
                            "rmse": metrics.rmse,
                            "max_abs_error": metrics.max_abs_error,
                            "r2": metrics.r2,
                            "mape_percent": metrics.mape_percent,
                            "worst_case_id": metrics.worst_case_id,
                            "out_of_domain_test_count": int((~in_domain).sum()),
                            "skip_reason": "",
                        }
                    )
                    for local_index, case_index in enumerate(split.test_indices):
                        true_value = float(y[case_index])
                        pred_value = float(y_pred[local_index])
                        prediction_rows.append(
                            {
                                "output": output_name,
                                "model": model.name,
                                "validation_split": split.name,
                                "validation_family": split.family,
                                "region": split.region,
                                "case_id": dataset.case_ids[case_index],
                                "pz_206": float(dataset.X[case_index, 0]),
                                "cz_301_radius": float(dataset.X[case_index, 1]),
                                "true": true_value,
                                "predicted": pred_value,
                                "error": pred_value - true_value,
                                "abs_error": abs(pred_value - true_value),
                                "in_domain": bool(in_domain[local_index]),
                            }
                        )
                except Exception as exc:  # noqa: BLE001 - benchmark records model failures.
                    comparison_rows.append(
                        {
                            "status": "skipped",
                            "output": output_name,
                            "model": model_name,
                            "validation_split": split.name,
                            "validation_family": split.family,
                            "region": split.region,
                            "heldout_axis": split.heldout_axis or "",
                            "heldout_level": split.heldout_level or "",
                            "n_train": len(split.train_indices),
                            "n_test": len(split.test_indices),
                            "mae": "",
                            "rmse": "",
                            "max_abs_error": "",
                            "r2": "",
                            "mape_percent": "",
                            "worst_case_id": "",
                            "out_of_domain_test_count": "",
                            "skip_reason": f"{type(exc).__name__}: {exc}",
                        }
                    )
                    model_metadata.setdefault(
                        model_name,
                        {"fit_error_traceback": traceback.format_exc(limit=2)},
                    )

    summary = {
        "dataset": _json_ready(asdict(sanity)),
        "model_metadata": _json_ready(model_metadata),
        "best_models": _json_ready(_rank_best_models(prediction_rows)),
        "artifact_files": {
            "comparison_csv": COMPARISON_CSV,
            "heldout_predictions_csv": PREDICTIONS_CSV,
            "summary_json": SUMMARY_JSON,
        },
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    _write_csv(output_dir / COMPARISON_CSV, comparison_rows)
    _write_csv(output_dir / PREDICTIONS_CSV, prediction_rows)
    with (output_dir / SUMMARY_JSON).open("w", encoding="utf-8") as stream:
        json.dump(summary, stream, indent=2)
    return {
        "comparison_rows": comparison_rows,
        "prediction_rows": prediction_rows,
        "summary": summary,
    }


def run_benchmark_from_registry(registry, output_dir: Path) -> dict[str, object]:
    return run_benchmark(extract_dataset_from_registry(registry), output_dir)


def _rank_best_models(prediction_rows: list[dict[str, object]]) -> dict[str, dict[str, object]]:
    grouped: dict[tuple[str, str], list[dict[str, object]]] = {}
    for row in prediction_rows:
        if row["region"] != "interpolation":
            continue
        grouped.setdefault((str(row["output"]), str(row["model"])), []).append(row)

    best_by_output: dict[str, dict[str, object]] = {}
    for (output_name, model_name), rows in grouped.items():
        y_true = np.asarray([row["true"] for row in rows], dtype=float)
        y_pred = np.asarray([row["predicted"] for row in rows], dtype=float)
        case_ids = [str(row["case_id"]) for row in rows]
        metrics = calculate_regression_metrics(y_true, y_pred, case_ids)
        current = best_by_output.get(output_name)
        candidate = {
            "model": model_name,
            "n_validation_predictions": len(rows),
            "mae": metrics.mae,
            "rmse": metrics.rmse,
            "max_abs_error": metrics.max_abs_error,
            "r2": metrics.r2,
            "mape_percent": metrics.mape_percent,
            "worst_case_id": metrics.worst_case_id,
        }
        if current is None or candidate["rmse"] < current["rmse"]:
            best_by_output[output_name] = candidate
    return best_by_output


def _write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        raise ValueError(f"no rows to write: {path}")
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def _json_ready(value):
    if isinstance(value, dict):
        return {str(key): _json_ready(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_json_ready(item) for item in value]
    if isinstance(value, list):
        return [_json_ready(item) for item in value]
    if isinstance(value, np.generic):
        return value.item()
    return value

