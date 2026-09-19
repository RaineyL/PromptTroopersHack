#!/usr/bin/env python3
"""Classify every inbox email and evaluate categories against ground truth."""

from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from .engine import (
    CATEGORY_ORDER,
    DeepSeekClient,
)

from app.schemas.classification import ClassifyRequest
from .pipeline import classify_email


def load_emails(dataset: Path, limit: int | None) -> list[dict[str, Any]]:
    inbox = dataset / "inbox"
    if not inbox.is_dir():
        raise ValueError("Dataset must contain an inbox directory")
    paths = sorted(inbox.glob("email_*.json"))
    if limit is not None:
        paths = paths[:limit]
    if not paths:
        raise ValueError("No email JSON records found in inbox")
    return [json.loads(path.read_text(encoding="utf-8")) for path in paths]

PIPELINE_VERSION = "deepseek-only-no-confidence-v2"


def load_dotenv(path: Path) -> None:
    """Load a minimal KEY=VALUE .env file without another dependency."""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"").strip("'")
        if key:
            os.environ.setdefault(key, value)


def atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def load_ground_truth(path: Path) -> dict[str, dict[str, Any]]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("ground_truth.json must contain an object keyed by email_id")
    invalid = [email_id for email_id, row in value.items() if row.get("category") not in CATEGORY_ORDER]
    if invalid:
        raise ValueError(f"ground truth contains invalid categories for: {invalid[:5]}")
    return value


def prediction_category(row: dict[str, Any]) -> str:
    return row["classification"]["category"]


def calculate_metrics(
    truth: dict[str, dict[str, Any]],
    predictions: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    confusion = {actual: {predicted: 0 for predicted in CATEGORY_ORDER} for actual in CATEGORY_ORDER}
    per = {}
    correct = 0
    evaluated = 0
    received = 0
    excluded_review = 0

    for email_id, expected in truth.items():
        row = predictions.get(email_id)
        if row is None:
            continue
        received += 1
        if row.get("classification", {}).get("needs_human_review"):
            excluded_review += 1
            continue
        actual = expected["category"]
        predicted = prediction_category(row)
        confusion[actual][predicted] += 1
        evaluated += 1
        correct += int(actual == predicted)

    for category in CATEGORY_ORDER:
        tp = confusion[category][category]
        fp = sum(confusion[actual][category] for actual in CATEGORY_ORDER if actual != category)
        fn = sum(confusion[category][predicted] for predicted in CATEGORY_ORDER if predicted != category)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per[category] = {
            "support": sum(confusion[category].values()),
            "precision": round(precision, 6),
            "recall": round(recall, 6),
            "f1": round(f1, 6),
        }

    accuracy = correct / evaluated if evaluated else 0.0
    macro_f1 = sum(per[category]["f1"] for category in CATEGORY_ORDER) / len(CATEGORY_ORDER)
    return {
        "ground_truth_emails": len(truth),
        "predictions_received": received,
        "evaluated_emails": evaluated,
        "excluded_human_review": excluded_review,
        "missing_predictions": len(truth) - received,
        "correct_predictions": correct,
        "automatic_decision_coverage": round(evaluated / len(truth), 6) if truth else 0.0,
        "prediction_coverage": round(received / len(truth), 6) if truth else 0.0,
        "accuracy_excluding_human_review": round(accuracy, 6),
        "macro_f1_excluding_human_review": round(macro_f1, 6),
        "per_category": per,
        "confusion_matrix": confusion,
    }


def make_submission(predictions: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Create the organizer schema; only its category field is meaningful here."""
    result = {}
    for email_id, row in sorted(predictions.items()):
        result[email_id] = {
            "category": prediction_category(row),
            "status": "NEEDS_REVIEW" if prediction_category(row) == "BL_COMPARISON" or row.get("classification", {}).get("needs_human_review") else "OK",
            "review_reason": "Document comparison not implemented" if prediction_category(row) == "BL_COMPARISON" else row.get("classification", {}).get("ambiguity_reason"),
            "defect_fields": [],
            "has_defect": False,
            "decided_by": "llm",
        }
    return result


def print_report(metrics: dict[str, Any]) -> None:
    print("\nClassification evaluation")
    print("=" * 72)
    print(
        f"Automatic decisions: {metrics['evaluated_emails']}/{metrics['ground_truth_emails']} "
        f"({metrics['automatic_decision_coverage']:.1%})"
    )
    print(f"Excluded for human review: {metrics['excluded_human_review']}")
    print(f"Accuracy excluding review: {metrics['accuracy_excluding_human_review']:.3f}")
    print(f"Macro-F1 excluding review: {metrics['macro_f1_excluding_human_review']:.3f}")
    if metrics["missing_predictions"]:
        print(f"Missing predictions: {metrics['missing_predictions']}")
    print("\nPer category                 support  precision  recall  f1")
    for category in CATEGORY_ORDER:
        row = metrics["per_category"][category]
        print(
            f"{category:<28} {row['support']:>7}  "
            f"{row['precision']:>9.3f}  {row['recall']:>6.3f}  {row['f1']:>4.3f}"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--ground-truth", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("output/classification"))
    parser.add_argument("--workers", type=int, default=4, help="Concurrent DeepSeek calls (default: 4)")
    parser.add_argument("--max-emails", type=int, help="Run only the first N emails for a smoke test")
    parser.add_argument("--fresh", action="store_true", help="Ignore an existing checkpoint")
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.workers < 1:
        raise ValueError("--workers must be at least 1")
    if args.max_emails is not None and args.max_emails < 1:
        raise ValueError("--max-emails must be at least 1")

    load_dotenv(args.env_file)
    truth = load_ground_truth(args.ground_truth)
    emails = load_emails(args.dataset, args.max_emails)
    email_ids = {email["email_id"] for email in emails}
    unknown = sorted(email_ids - truth.keys())
    if unknown:
        raise ValueError(f"emails missing from ground truth: {unknown[:5]}")

    mode = "deepseek_only"
    results_path = args.output_dir / f"{mode}_classification_results.json"
    report_path = args.output_dir / f"{mode}_accuracy_report.json"
    submission_path = args.output_dir / f"{mode}_classification_submission.json"
    review_path = args.output_dir / f"{mode}_human_review_queue.json"

    model = os.environ.get("DEEPSEEK_MODEL", "deepseek-flash")
    checkpoint: dict[str, Any] = {
        "metadata": {
            "mode": mode,
            "model": model,
            "pipeline_version": PIPELINE_VERSION,
        },
        "predictions": {},
        "errors": {},
    }
    if results_path.is_file() and not args.fresh:
        checkpoint = json.loads(results_path.read_text(encoding="utf-8"))
        if checkpoint.get("metadata", {}).get("mode") != mode:
            raise ValueError("checkpoint mode mismatch; use --fresh")
        if checkpoint.get("metadata", {}).get("pipeline_version") != PIPELINE_VERSION:
            raise ValueError("checkpoint predates the review gate; use --fresh")
        if checkpoint.get("metadata", {}).get("model") != model:
            raise ValueError("checkpoint model mismatch; use --fresh")

    predictions = checkpoint.setdefault("predictions", {})
    errors = checkpoint.setdefault("errors", {})
    pending = [email for email in emails if email["email_id"] not in predictions]
    print(f"Mode: {mode}")
    print(f"Dataset emails selected: {len(emails)}")
    print(f"Already completed: {len(emails) - len(pending)}")
    print(f"Remaining: {len(pending)}")

    client = None
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print(
            f"DEEPSEEK_API_KEY is missing. Put it in {args.env_file} or export it.",
            file=sys.stderr,
        )
        return 2
    client = DeepSeekClient(
        api_key=api_key,
        base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        model=model,
    )

    def classify_one(email: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        result = classify_email(ClassifyRequest(email=email), client)
        return email["email_id"], result.model_dump()

    completed_before = len(predictions)
    if pending:
        worker_count = min(args.workers, len(pending))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = {executor.submit(classify_one, email): email["email_id"] for email in pending}
            for index, future in enumerate(as_completed(futures), start=1):
                email_id = futures[future]
                try:
                    result_id, row = future.result()
                    predictions[result_id] = row
                    errors.pop(result_id, None)
                    category = prediction_category(row)
                    print(f"[{completed_before + index}/{len(emails)}] {result_id}: {category}")
                except Exception as exc:  # Continue so a large batch remains resumable.
                    errors[email_id] = str(exc)
                    print(f"[{completed_before + index}/{len(emails)}] {email_id}: ERROR {exc}", file=sys.stderr)
                atomic_write_json(results_path, checkpoint)

    selected_predictions = {
        email_id: predictions[email_id] for email_id in sorted(email_ids) if email_id in predictions
    }
    selected_truth = {email_id: truth[email_id] for email_id in sorted(email_ids)}
    metrics = calculate_metrics(selected_truth, selected_predictions)
    emails_by_id = {email["email_id"]: email for email in emails}
    review_queue = {}
    for email_id, row in selected_predictions.items():
        classification = row.get("classification", {})
        if not classification.get("needs_human_review"):
            continue
        email = emails_by_id[email_id]
        review_queue[email_id] = {
            "sender": email.get("from", ""),
            "subject": email.get("subject", ""),
            "current_message_body": email.get("body", "").split("______________________________")[0].strip(),
            "suggested_category": classification.get("category"),
            "competing_category": classification.get("competing_category"),
            "ambiguity_reason": classification.get("ambiguity_reason"),
            "question_for_user": classification.get("question_for_user"),
            "audit": row.get("audit"),
        }
    atomic_write_json(report_path, metrics)
    atomic_write_json(submission_path, make_submission(selected_predictions))
    atomic_write_json(review_path, review_queue)
    print_report(metrics)
    print(f"\nCheckpoint: {results_path}")
    print(f"Accuracy report: {report_path}")
    print(f"Classification submission: {submission_path}")
    print(f"Human review queue: {review_path}")
    if errors:
        print(f"Failed emails retained for retry: {len(errors)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
