#!/usr/bin/env python3
"""Small DeepSeek-backed classifier for the SDOC hackathon inbox."""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


CATEGORY_ORDER = (
    "BL_COMPARISON",
    "SI_REQUEST",
    "INVOICE_QUERY",
    "GENERAL",
    "SPAM",
)
CATEGORIES = set(CATEGORY_ORDER)
EVIDENCE_SOURCES = {"subject", "body", "attachment", "rule_engine"}
DEFAULT_PROMPT = Path(__file__).with_name("prompt.txt")
DEFAULT_AUDIT_PROMPT = Path(__file__).with_name("audit_prompt.txt")


def split_message(body: str) -> tuple[str, str | None]:
    """Separate the newest message from the dataset's common reply delimiter."""
    parts = re.split(r"\n_{10,}\n", body, maxsplit=1)
    latest = parts[0].strip()
    history = parts[1].strip() if len(parts) == 2 and parts[1].strip() else None
    return latest, history


def attachment_metadata(paths: list[str]) -> list[dict[str, str]]:
    result = []
    for path in paths:
        name = Path(path).name
        upper = name.upper()
        if re.search(r"(?:^|_)SI(?:_|\.)", upper):
            document_type = "SI"
        elif re.search(r"(?:^|_)BL(?:_|\.)", upper):
            document_type = "BL"
        else:
            document_type = "UNKNOWN"
        result.append(
            {
                "name": name,
                "extension": Path(name).suffix.lower(),
                "detected_document_type": document_type,
            }
        )
    return result


def build_user_message(email: dict[str, Any]) -> str:
    latest, history = split_message(email.get("body", ""))
    payload = {
        "email_id": email.get("email_id"),
        "sender": email.get("from", ""),
        "subject": email.get("subject", ""),
        "current_message_body": latest,
        "quoted_history": history,
        "attachments": attachment_metadata(email.get("attachments", [])),
    }
    return (
        "Classify this email. Inspect the email independently and return only the required JSON object.\n\n"
        + json.dumps(payload, ensure_ascii=False, indent=2)
    )


def detect_review_risks(email: dict[str, Any]) -> list[str]:
    """Find patterns that deserve an independent audit."""
    latest, _ = split_message(email.get("body", ""))
    subject = email.get("subject", "")
    risks = []

    def matches(pattern: str, value: str) -> bool:
        return re.search(pattern, value, flags=re.IGNORECASE | re.DOTALL) is not None

    if matches(r"\b(all|multiple)\s+pending\s+shipments?\b|\boutstanding\s+list\b", latest):
        risks.append("bulk_workflow_reminder")
    if matches(r"\b(process|billing).{0,60}\bcompleted\b|\bno action required\b", latest):
        risks.append("no_action_process_notification")
    if matches(r"\b(happy|greetings?|holiday|office resumes?|time off|leave request)\b", latest):
        risks.append("internal_announcement_or_hr_message")

    topic_patterns = {
        "si": r"\bsi\b|shipping instructions?",
        "billing": r"\binvoice\b|\bbilling\b|\bcharges?\b",
        "hr": r"time off|leave request|human resources|\bhr\b",
        "operations": r"berthing|vessel schedule|operational update",
    }
    subject_topics = {name for name, pattern in topic_patterns.items() if matches(pattern, subject)}
    body_topics = {name for name, pattern in topic_patterns.items() if matches(pattern, latest)}
    if subject_topics and body_topics and subject_topics.isdisjoint(body_topics):
        risks.append("subject_body_topic_conflict")
    return risks


def build_audit_message(
    email: dict[str, Any],
    classification: dict[str, Any],
    risk_flags: list[str],
) -> str:
    latest, history = split_message(email.get("body", ""))
    payload = {
        "email": {
            "email_id": email.get("email_id"),
            "sender": email.get("from", ""),
            "subject": email.get("subject", ""),
            "current_message_body": latest,
            "quoted_history": history,
            "attachments": attachment_metadata(email.get("attachments", [])),
        },
        "initial_classification": classification,
        "risk_flags": risk_flags,
    }
    return "Audit this classification and return only the required JSON object.\n\n" + json.dumps(
        payload, ensure_ascii=False, indent=2
    )


def validate_classification(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("classification must be a JSON object")
    category = value.get("category")
    if category not in CATEGORIES:
        raise ValueError(f"invalid category: {category!r}")
    if not isinstance(value.get("needs_human_review"), bool):
        raise ValueError("needs_human_review must be boolean")
    if not isinstance(value.get("rationale"), str) or not value["rationale"].strip():
        raise ValueError("rationale must be a non-empty string")
    evidence = value.get("evidence")
    if not isinstance(evidence, list):
        raise ValueError("evidence must be a list")
    for item in evidence:
        if not isinstance(item, dict) or item.get("source") not in EVIDENCE_SOURCES:
            raise ValueError("each evidence item needs a valid source")
        if not isinstance(item.get("signal"), str) or not item["signal"].strip():
            raise ValueError("each evidence item needs a signal")
    competing = value.get("competing_category")
    if competing is not None and (competing not in CATEGORIES or competing == category):
        raise ValueError("competing_category must be null or a different valid category")
    ambiguity_reason = value.get("ambiguity_reason")
    question_for_user = value.get("question_for_user")
    if ambiguity_reason is not None and not isinstance(ambiguity_reason, str):
        raise ValueError("ambiguity_reason must be null or a string")
    if question_for_user is not None and not isinstance(question_for_user, str):
        raise ValueError("question_for_user must be null or a string")

    needs_review = value["needs_human_review"]
    if needs_review:
        ambiguity_reason = (ambiguity_reason or "The classifier could not make a dependable decision.").strip()
        question_for_user = (
            question_for_user
            or f"Should this email be classified as {category} or another category?"
        ).strip()
    else:
        ambiguity_reason = None
        question_for_user = None

    result = {
        "category": category,
        "needs_human_review": needs_review,
        "rationale": value["rationale"].strip(),
        "evidence": evidence,
        "competing_category": competing,
        "ambiguity_reason": ambiguity_reason,
        "question_for_user": question_for_user,
    }
    return result


def validate_audit(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("audit must be a JSON object")
    category = value.get("recommended_category")
    if category not in CATEGORIES:
        raise ValueError(f"invalid audit category: {category!r}")
    needs_review = value.get("needs_human_review")
    if not isinstance(needs_review, bool):
        raise ValueError("audit needs_human_review must be boolean")
    reason = value.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError("audit reason must be a non-empty string")
    question = value.get("question_for_user")
    if question is not None and not isinstance(question, str):
        raise ValueError("audit question_for_user must be null or a string")
    if needs_review and not (question or "").strip():
        raise ValueError("audit question_for_user is required for human review")
    return {
        "recommended_category": category,
        "needs_human_review": needs_review,
        "reason": reason.strip(),
        "question_for_user": question.strip() if isinstance(question, str) else None,
    }


class DeepSeekClient:
    def __init__(self, api_key: str, base_url: str, model: str, retries: int = 3):
        self.api_key = api_key
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.retries = retries

    def _complete_json(
        self,
        system_prompt: str,
        user_message: str,
        validator,
        max_tokens: int,
    ) -> dict[str, Any]:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "response_format": {"type": "json_object"},
            "thinking": {"type": "disabled"},
            "temperature": 0,
            "max_tokens": max_tokens,
            "stream": False,
        }
        request = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        last_error: Exception | None = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    api_result = json.loads(response.read().decode("utf-8"))
                content = api_result["choices"][0]["message"].get("content", "").strip()
                if not content:
                    raise ValueError("DeepSeek returned empty content")
                return validator(json.loads(content))
            except (urllib.error.URLError, TimeoutError, KeyError, IndexError, TypeError, AttributeError, ValueError) as exc:
                last_error = exc
                if isinstance(exc, urllib.error.HTTPError) and exc.code not in {408, 429, 500, 502, 503, 504}:
                    break
                if attempt + 1 < self.retries:
                    time.sleep(2**attempt)
        raise RuntimeError(f"DeepSeek classification failed after {self.retries} attempts: {last_error}")

    def classify(self, system_prompt: str, user_message: str) -> dict[str, Any]:
        return self._complete_json(system_prompt, user_message, validate_classification, 600)

    def audit(self, system_prompt: str, user_message: str) -> dict[str, Any]:
        return self._complete_json(system_prompt, user_message, validate_audit, 350)

