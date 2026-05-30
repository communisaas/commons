"""HTTP client and resource classes for the Commons API."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Type, TypeVar

import httpx

from .errors import (
    AuthenticationError,
    BadRequestError,
    CommonsError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    RateLimitError,
)
from .pagination import AsyncCursorPage, CursorPage
from .types import (
    Campaign,
    CampaignAction,
    CampaignDetail,
    CampaignFull,
    CreateSupporterInput,
    CreateWebhookInput,
    Donation,
    DonationDetail,
    Event,
    EventDetail,
    Network,
    NetworkDetail,
    NetworkStats,
    OrgInfo,
    PatchThroughCall,
    Representative,
    SmsBlast,
    Supporter,
    Tag,
    UpdateSupporterInput,
    UpdateWebhookInput,
    Usage,
    Webhook,
    WebhookCreated,
    WebhookSecretRotated,
    Workflow,
    WorkflowDetail,
)

T = TypeVar("T")

_ERROR_MAP: Dict[int, Type[CommonsError]] = {
    400: BadRequestError,
    401: AuthenticationError,
    403: ForbiddenError,
    404: NotFoundError,
    409: ConflictError,
    429: RateLimitError,
}


def _raise_for_error(status: int, body: Dict[str, Any]) -> None:
    error_data = body.get("error", {})
    code = error_data.get("code", "UNKNOWN")
    message = error_data.get("message", "Unknown error")
    cls = _ERROR_MAP.get(status, CommonsError)
    if cls is CommonsError:
        raise CommonsError(code, message, status)
    raise cls(code, message)


# ---------------------------------------------------------------------------
# Sync HTTP client
# ---------------------------------------------------------------------------


class _HttpClient:
    """Internal httpx-based sync client with auth + error handling."""

    def __init__(self, api_key: str, base_url: str, timeout: float = 30.0) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=timeout,
        )

    def request(self, method: str, path: str, **kwargs: Any) -> Dict[str, Any]:
        response = self._client.request(method, path, **kwargs)
        body: Dict[str, Any] = response.json()
        if response.status_code >= 400:
            _raise_for_error(response.status_code, body)
        return body

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "_HttpClient":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


# ---------------------------------------------------------------------------
# Async HTTP client
# ---------------------------------------------------------------------------


class _AsyncHttpClient:
    """Internal httpx-based async client with auth + error handling."""

    def __init__(self, api_key: str, base_url: str, timeout: float = 30.0) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=timeout,
        )

    async def request(self, method: str, path: str, **kwargs: Any) -> Dict[str, Any]:
        response = await self._client.request(method, path, **kwargs)
        body: Dict[str, Any] = response.json()
        if response.status_code >= 400:
            _raise_for_error(response.status_code, body)
        return body

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "_AsyncHttpClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()


# ---------------------------------------------------------------------------
# Sync resource classes
# ---------------------------------------------------------------------------


class SupporterResource:
    def __init__(self, client: _HttpClient) -> None:
        self._client = client

    def list(self, **params: Any) -> CursorPage[Supporter]:
        def fetch(cursor: Optional[str] = None) -> CursorPage[Supporter]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = self._client.request("GET", "/supporters", params=p)
            return CursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=lambda c: fetch(c),
            )

        return fetch(params.get("cursor"))

    def get(self, supporter_id: str) -> Supporter:
        return self._client.request("GET", f"/supporters/{supporter_id}")["data"]

    def create(self, data: CreateSupporterInput) -> Supporter:
        return self._client.request("POST", "/supporters", json=data)["data"]

    def update(self, supporter_id: str, data: UpdateSupporterInput) -> Dict[str, Any]:
        return self._client.request("PATCH", f"/supporters/{supporter_id}", json=data)["data"]

    def delete(self, supporter_id: str) -> Dict[str, Any]:
        return self._client.request("DELETE", f"/supporters/{supporter_id}")["data"]


class CampaignResource:
    def __init__(self, client: _HttpClient) -> None:
        self._client = client

    def list(self, **params: Any) -> CursorPage[Campaign]:
        def fetch(cursor: Optional[str] = None) -> CursorPage[Campaign]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = self._client.request("GET", "/campaigns", params=p)
            return CursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=lambda c: fetch(c),
            )

        return fetch(params.get("cursor"))

    def get(self, campaign_id: str) -> CampaignFull:
        return self._client.request("GET", f"/campaigns/{campaign_id}")["data"]

    def create(self, data: Dict[str, Any]) -> CampaignDetail:
        return self._client.request("POST", "/campaigns", json=data)["data"]

    def update(self, campaign_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._client.request("PATCH", f"/campaigns/{campaign_id}", json=data)["data"]

    def list_actions(self, campaign_id: str, **params: Any) -> CursorPage[CampaignAction]:
        def fetch(cursor: Optional[str] = None) -> CursorPage[CampaignAction]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = self._client.request("GET", f"/campaigns/{campaign_id}/actions", params=p)
            return CursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=lambda c: fetch(c),
            )

        return fetch(params.get("cursor"))


class EventResource:
    def __init__(self, client: _HttpClient) -> None:
        self._client = client

    def list(self, **params: Any) -> CursorPage[Event]:
        def fetch(cursor: Optional[str] = None) -> CursorPage[Event]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = self._client.request("GET", "/events", params=p)
            return CursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=lambda c: fetch(c),
            )

        return fetch(params.get("cursor"))

    def get(self, event_id: str) -> EventDetail:
        return self._client.request("GET", f"/events/{event_id}")["data"]


class DonationResource:
    def __init__(self, client: _HttpClient) -> None:
        self._client = client

    def list(self, **params: Any) -> CursorPage[Donation]:
        def fetch(cursor: Optional[str] = None) -> CursorPage[Donation]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = self._client.request("GET", "/donations", params=p)
            return CursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=lambda c: fetch(c),
            )

        return fetch(params.get("cursor"))

    def get(self, donation_id: str) -> DonationDetail:
        return self._client.request("GET", f"/donations/{donation_id}")["data"]


class WorkflowResource:
    def __init__(self, client: _HttpClient) -> None:
        self._client = client

    def list(self, **params: Any) -> CursorPage[Workflow]:
        def fetch(cursor: Optional[str] = None) -> CursorPage[Workflow]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = self._client.request("GET", "/workflows", params=p)
            return CursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=lambda c: fetch(c),
            )

        return fetch(params.get("cursor"))

    def get(self, workflow_id: str) -> WorkflowDetail:
        return self._client.request("GET", f"/workflows/{workflow_id}")["data"]


class SmsResource:
    def __init__(self, client: _HttpClient) -> None:
        self._client = client

    def list(self, **params: Any) -> CursorPage[SmsBlast]:
        def fetch(cursor: Optional[str] = None) -> CursorPage[SmsBlast]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = self._client.request("GET", "/sms", params=p)
            return CursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=lambda c: fetch(c),
            )

        return fetch(params.get("cursor"))


class CallResource:
    def __init__(self, client: _HttpClient) -> None:
        self._client = client

    def list(self, **params: Any) -> CursorPage[PatchThroughCall]:
        def fetch(cursor: Optional[str] = None) -> CursorPage[PatchThroughCall]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = self._client.request("GET", "/calls", params=p)
            return CursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=lambda c: fetch(c),
            )

        return fetch(params.get("cursor"))


class TagResource:
    def __init__(self, client: _HttpClient) -> None:
        self._client = client

    def list(self) -> List[Tag]:
        return self._client.request("GET", "/tags")["data"]

    def create(self, name: str) -> Dict[str, Any]:
        return self._client.request("POST", "/tags", json={"name": name})["data"]

    def update(self, tag_id: str, name: str) -> Dict[str, Any]:
        return self._client.request("PATCH", f"/tags/{tag_id}", json={"name": name})["data"]

    def delete(self, tag_id: str) -> Dict[str, Any]:
        return self._client.request("DELETE", f"/tags/{tag_id}")["data"]


class NetworkResource:
    def __init__(self, client: _HttpClient) -> None:
        self._client = client

    def list(self, **params: Any) -> CursorPage[Network]:
        def fetch(cursor: Optional[str] = None) -> CursorPage[Network]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = self._client.request("GET", "/networks", params=p)
            return CursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=lambda c: fetch(c),
            )

        return fetch(params.get("cursor"))

    def get(self, network_id: str) -> NetworkDetail:
        return self._client.request("GET", f"/networks/{network_id}")["data"]

    def stats(self, network_id: str) -> NetworkStats:
        return self._client.request("GET", f"/networks/{network_id}/stats")["data"]


class RepresentativeResource:
    def __init__(self, client: _HttpClient) -> None:
        self._client = client

    def list(self, **params: Any) -> CursorPage[Representative]:
        def fetch(cursor: Optional[str] = None) -> CursorPage[Representative]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = self._client.request("GET", "/representatives", params=p)
            return CursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=lambda c: fetch(c),
            )

        return fetch(params.get("cursor"))


class UsageResource:
    def __init__(self, client: _HttpClient) -> None:
        self._client = client

    def get(self) -> Usage:
        return self._client.request("GET", "/usage")["data"]


class OrgResource:
    def __init__(self, client: _HttpClient) -> None:
        self._client = client

    def get(self) -> OrgInfo:
        return self._client.request("GET", "/orgs")["data"]


class KeyResource:
    def __init__(self, client: _HttpClient) -> None:
        self._client = client

    def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._client.request("POST", "/keys", json=data)["data"]

    def update(self, key_id: str, name: str, org_slug: str) -> Dict[str, Any]:
        return self._client.request(
            "PATCH", f"/keys/{key_id}", json={"name": name}, params={"orgSlug": org_slug}
        )["data"]

    def revoke(self, key_id: str, org_slug: str) -> Dict[str, Any]:
        return self._client.request("DELETE", f"/keys/{key_id}", params={"orgSlug": org_slug})[
            "data"
        ]


class WebhookResource:
    def __init__(self, client: _HttpClient) -> None:
        self._client = client

    def list(self) -> List[Webhook]:
        return self._client.request("GET", "/webhooks")["data"]

    def get(self, webhook_id: str) -> Webhook:
        return self._client.request("GET", f"/webhooks/{webhook_id}")["data"]

    def create(self, data: CreateWebhookInput) -> WebhookCreated:
        # signingSecret is returned ONCE on creation — persist it now.
        return self._client.request("POST", "/webhooks", json=data)["data"]

    def update(self, webhook_id: str, data: UpdateWebhookInput) -> Webhook:
        return self._client.request("PATCH", f"/webhooks/{webhook_id}", json=data)["data"]

    def rotate_secret(self, webhook_id: str) -> WebhookSecretRotated:
        return self._client.request("POST", f"/webhooks/{webhook_id}/rotate-secret")["data"]

    def delete(self, webhook_id: str) -> Dict[str, Any]:
        return self._client.request("DELETE", f"/webhooks/{webhook_id}")["data"]


# ---------------------------------------------------------------------------
# Async resource classes
# ---------------------------------------------------------------------------


class AsyncSupporterResource:
    def __init__(self, client: _AsyncHttpClient) -> None:
        self._client = client

    async def list(self, **params: Any) -> AsyncCursorPage[Supporter]:
        async def fetch(cursor: Optional[str] = None) -> AsyncCursorPage[Supporter]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = await self._client.request("GET", "/supporters", params=p)
            return AsyncCursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=fetch,
            )

        return await fetch(params.get("cursor"))

    async def get(self, supporter_id: str) -> Supporter:
        return (await self._client.request("GET", f"/supporters/{supporter_id}"))["data"]

    async def create(self, data: CreateSupporterInput) -> Supporter:
        return (await self._client.request("POST", "/supporters", json=data))["data"]

    async def update(self, supporter_id: str, data: UpdateSupporterInput) -> Dict[str, Any]:
        return (await self._client.request("PATCH", f"/supporters/{supporter_id}", json=data))[
            "data"
        ]

    async def delete(self, supporter_id: str) -> Dict[str, Any]:
        return (await self._client.request("DELETE", f"/supporters/{supporter_id}"))["data"]


class AsyncCampaignResource:
    def __init__(self, client: _AsyncHttpClient) -> None:
        self._client = client

    async def list(self, **params: Any) -> AsyncCursorPage[Campaign]:
        async def fetch(cursor: Optional[str] = None) -> AsyncCursorPage[Campaign]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = await self._client.request("GET", "/campaigns", params=p)
            return AsyncCursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=fetch,
            )

        return await fetch(params.get("cursor"))

    async def get(self, campaign_id: str) -> CampaignFull:
        return (await self._client.request("GET", f"/campaigns/{campaign_id}"))["data"]

    async def create(self, data: Dict[str, Any]) -> CampaignDetail:
        return (await self._client.request("POST", "/campaigns", json=data))["data"]

    async def update(self, campaign_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return (await self._client.request("PATCH", f"/campaigns/{campaign_id}", json=data))[
            "data"
        ]

    async def list_actions(
        self, campaign_id: str, **params: Any
    ) -> AsyncCursorPage[CampaignAction]:
        async def fetch(cursor: Optional[str] = None) -> AsyncCursorPage[CampaignAction]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = await self._client.request(
                "GET", f"/campaigns/{campaign_id}/actions", params=p
            )
            return AsyncCursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=fetch,
            )

        return await fetch(params.get("cursor"))


class AsyncEventResource:
    def __init__(self, client: _AsyncHttpClient) -> None:
        self._client = client

    async def list(self, **params: Any) -> AsyncCursorPage[Event]:
        async def fetch(cursor: Optional[str] = None) -> AsyncCursorPage[Event]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = await self._client.request("GET", "/events", params=p)
            return AsyncCursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=fetch,
            )

        return await fetch(params.get("cursor"))

    async def get(self, event_id: str) -> EventDetail:
        return (await self._client.request("GET", f"/events/{event_id}"))["data"]


class AsyncDonationResource:
    def __init__(self, client: _AsyncHttpClient) -> None:
        self._client = client

    async def list(self, **params: Any) -> AsyncCursorPage[Donation]:
        async def fetch(cursor: Optional[str] = None) -> AsyncCursorPage[Donation]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = await self._client.request("GET", "/donations", params=p)
            return AsyncCursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=fetch,
            )

        return await fetch(params.get("cursor"))

    async def get(self, donation_id: str) -> DonationDetail:
        return (await self._client.request("GET", f"/donations/{donation_id}"))["data"]


class AsyncWorkflowResource:
    def __init__(self, client: _AsyncHttpClient) -> None:
        self._client = client

    async def list(self, **params: Any) -> AsyncCursorPage[Workflow]:
        async def fetch(cursor: Optional[str] = None) -> AsyncCursorPage[Workflow]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = await self._client.request("GET", "/workflows", params=p)
            return AsyncCursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=fetch,
            )

        return await fetch(params.get("cursor"))

    async def get(self, workflow_id: str) -> WorkflowDetail:
        return (await self._client.request("GET", f"/workflows/{workflow_id}"))["data"]


class AsyncSmsResource:
    def __init__(self, client: _AsyncHttpClient) -> None:
        self._client = client

    async def list(self, **params: Any) -> AsyncCursorPage[SmsBlast]:
        async def fetch(cursor: Optional[str] = None) -> AsyncCursorPage[SmsBlast]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = await self._client.request("GET", "/sms", params=p)
            return AsyncCursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=fetch,
            )

        return await fetch(params.get("cursor"))


class AsyncCallResource:
    def __init__(self, client: _AsyncHttpClient) -> None:
        self._client = client

    async def list(self, **params: Any) -> AsyncCursorPage[PatchThroughCall]:
        async def fetch(cursor: Optional[str] = None) -> AsyncCursorPage[PatchThroughCall]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = await self._client.request("GET", "/calls", params=p)
            return AsyncCursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=fetch,
            )

        return await fetch(params.get("cursor"))


class AsyncTagResource:
    def __init__(self, client: _AsyncHttpClient) -> None:
        self._client = client

    async def list(self) -> List[Tag]:
        return (await self._client.request("GET", "/tags"))["data"]

    async def create(self, name: str) -> Dict[str, Any]:
        return (await self._client.request("POST", "/tags", json={"name": name}))["data"]

    async def update(self, tag_id: str, name: str) -> Dict[str, Any]:
        return (await self._client.request("PATCH", f"/tags/{tag_id}", json={"name": name}))[
            "data"
        ]

    async def delete(self, tag_id: str) -> Dict[str, Any]:
        return (await self._client.request("DELETE", f"/tags/{tag_id}"))["data"]


class AsyncNetworkResource:
    def __init__(self, client: _AsyncHttpClient) -> None:
        self._client = client

    async def list(self, **params: Any) -> AsyncCursorPage[Network]:
        async def fetch(cursor: Optional[str] = None) -> AsyncCursorPage[Network]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = await self._client.request("GET", "/networks", params=p)
            return AsyncCursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=fetch,
            )

        return await fetch(params.get("cursor"))

    async def get(self, network_id: str) -> NetworkDetail:
        return (await self._client.request("GET", f"/networks/{network_id}"))["data"]

    async def stats(self, network_id: str) -> NetworkStats:
        return (await self._client.request("GET", f"/networks/{network_id}/stats"))["data"]


class AsyncRepresentativeResource:
    def __init__(self, client: _AsyncHttpClient) -> None:
        self._client = client

    async def list(self, **params: Any) -> AsyncCursorPage[Representative]:
        async def fetch(cursor: Optional[str] = None) -> AsyncCursorPage[Representative]:
            p = {k: v for k, v in params.items() if v is not None}
            if cursor:
                p["cursor"] = cursor
            body = await self._client.request("GET", "/representatives", params=p)
            return AsyncCursorPage(
                data=body.get("data", []),
                meta=body.get("meta", {}),
                fetch_next=fetch,
            )

        return await fetch(params.get("cursor"))


class AsyncUsageResource:
    def __init__(self, client: _AsyncHttpClient) -> None:
        self._client = client

    async def get(self) -> Usage:
        return (await self._client.request("GET", "/usage"))["data"]


class AsyncOrgResource:
    def __init__(self, client: _AsyncHttpClient) -> None:
        self._client = client

    async def get(self) -> OrgInfo:
        return (await self._client.request("GET", "/orgs"))["data"]


class AsyncKeyResource:
    def __init__(self, client: _AsyncHttpClient) -> None:
        self._client = client

    async def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return (await self._client.request("POST", "/keys", json=data))["data"]

    async def update(self, key_id: str, name: str, org_slug: str) -> Dict[str, Any]:
        return (
            await self._client.request(
                "PATCH", f"/keys/{key_id}", json={"name": name}, params={"orgSlug": org_slug}
            )
        )["data"]

    async def revoke(self, key_id: str, org_slug: str) -> Dict[str, Any]:
        return (
            await self._client.request(
                "DELETE", f"/keys/{key_id}", params={"orgSlug": org_slug}
            )
        )["data"]


class AsyncWebhookResource:
    def __init__(self, client: _AsyncHttpClient) -> None:
        self._client = client

    async def list(self) -> List[Webhook]:
        return (await self._client.request("GET", "/webhooks"))["data"]

    async def get(self, webhook_id: str) -> Webhook:
        return (await self._client.request("GET", f"/webhooks/{webhook_id}"))["data"]

    async def create(self, data: CreateWebhookInput) -> WebhookCreated:
        return (await self._client.request("POST", "/webhooks", json=data))["data"]

    async def update(self, webhook_id: str, data: UpdateWebhookInput) -> Webhook:
        return (await self._client.request("PATCH", f"/webhooks/{webhook_id}", json=data))["data"]

    async def rotate_secret(self, webhook_id: str) -> WebhookSecretRotated:
        return (await self._client.request("POST", f"/webhooks/{webhook_id}/rotate-secret"))[
            "data"
        ]

    async def delete(self, webhook_id: str) -> Dict[str, Any]:
        return (await self._client.request("DELETE", f"/webhooks/{webhook_id}"))["data"]


# ---------------------------------------------------------------------------
# Signature verification helper
# ---------------------------------------------------------------------------

import hashlib  # noqa: E402
import hmac  # noqa: E402
import time as _time  # noqa: E402


def verify_webhook_signature(
    payload: str,
    header: str,
    secrets: List[str] | str,
    tolerance_seconds: int = 300,
) -> bool:
    """Verify ``X-Commons-Signature-256: t=<ts>,v1=<hex>``.

    Reconstructs ``HMAC-SHA256(timestamp + "." + payload, secret)`` and
    constant-time compares. Accepts a list of secrets so callers can supply
    current + previous during a rotation window.
    """
    parts: Dict[str, str] = {}
    for p in header.split(","):
        if "=" in p:
            k, v = p.split("=", 1)
            parts[k.strip()] = v.strip()

    ts_str = parts.get("t")
    sig = parts.get("v1")
    if not ts_str or not sig:
        return False
    try:
        ts = int(ts_str)
    except ValueError:
        return False
    now_ms = int(_time.time() * 1000)
    if abs(now_ms - ts) > tolerance_seconds * 1000:
        return False

    secret_list = [secrets] if isinstance(secrets, str) else secrets
    message = f"{ts_str}.{payload}".encode("utf-8")
    for secret in secret_list:
        mac = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
        if hmac.compare_digest(mac, sig):
            return True
    return False
