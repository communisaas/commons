"""Commons Python SDK — sync and async clients for the Commons Public API."""

from __future__ import annotations

from .client import (
    AsyncCallResource,
    AsyncCampaignResource,
    AsyncDonationResource,
    AsyncEventResource,
    AsyncKeyResource,
    AsyncNetworkResource,
    AsyncOrgResource,
    AsyncRepresentativeResource,
    AsyncSmsResource,
    AsyncSupporterResource,
    AsyncTagResource,
    AsyncUsageResource,
    AsyncWebhookResource,
    AsyncWorkflowResource,
    CallResource,
    CampaignResource,
    DonationResource,
    EventResource,
    KeyResource,
    NetworkResource,
    OrgResource,
    RepresentativeResource,
    SmsResource,
    SupporterResource,
    TagResource,
    UsageResource,
    WebhookResource,
    WorkflowResource,
    _AsyncHttpClient,
    _HttpClient,
    verify_webhook_signature,
)
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

__all__ = [
    "Commons",
    "AsyncCommons",
    # Errors
    "CommonsError",
    "BadRequestError",
    "AuthenticationError",
    "ForbiddenError",
    "NotFoundError",
    "ConflictError",
    "RateLimitError",
    # Pagination
    "CursorPage",
    "AsyncCursorPage",
    # Types
    "Supporter",
    "CreateSupporterInput",
    "UpdateSupporterInput",
    "Campaign",
    "CampaignDetail",
    "CampaignFull",
    "CampaignAction",
    "Tag",
    "Usage",
    "OrgInfo",
    "Event",
    "EventDetail",
    "Donation",
    "DonationDetail",
    "Workflow",
    "WorkflowDetail",
    "SmsBlast",
    "PatchThroughCall",
    "Representative",
    "Network",
    "NetworkDetail",
    "NetworkStats",
    "Webhook",
    "WebhookCreated",
    "WebhookSecretRotated",
    "CreateWebhookInput",
    "UpdateWebhookInput",
    # Helpers
    "verify_webhook_signature",
]

_DEFAULT_BASE_URL = "https://commons.email/api/v1"


class Commons:
    """Synchronous client for the Commons Public API.

    Usage::

        client = Commons(api_key="ck_live_...")

        # List supporters with auto-pagination
        for supporter in client.supporters.list():
            print(supporter["email"])

        # Get org info
        org = client.org.get()
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ) -> None:
        self._client = _HttpClient(api_key, base_url, timeout)
        self.supporters = SupporterResource(self._client)
        self.campaigns = CampaignResource(self._client)
        self.events = EventResource(self._client)
        self.donations = DonationResource(self._client)
        self.workflows = WorkflowResource(self._client)
        self.sms = SmsResource(self._client)
        self.calls = CallResource(self._client)
        self.tags = TagResource(self._client)
        self.representatives = RepresentativeResource(self._client)
        self.networks = NetworkResource(self._client)
        self.usage = UsageResource(self._client)
        self.org = OrgResource(self._client)
        self.keys = KeyResource(self._client)
        self.webhooks = WebhookResource(self._client)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "Commons":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


class AsyncCommons:
    """Asynchronous client for the Commons Public API.

    Usage::

        async with AsyncCommons(api_key="ck_live_...") as client:
            async for supporter in await client.supporters.list():
                print(supporter["email"])
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ) -> None:
        self._client = _AsyncHttpClient(api_key, base_url, timeout)
        self.supporters = AsyncSupporterResource(self._client)
        self.campaigns = AsyncCampaignResource(self._client)
        self.events = AsyncEventResource(self._client)
        self.donations = AsyncDonationResource(self._client)
        self.workflows = AsyncWorkflowResource(self._client)
        self.sms = AsyncSmsResource(self._client)
        self.calls = AsyncCallResource(self._client)
        self.tags = AsyncTagResource(self._client)
        self.representatives = AsyncRepresentativeResource(self._client)
        self.networks = AsyncNetworkResource(self._client)
        self.usage = AsyncUsageResource(self._client)
        self.org = AsyncOrgResource(self._client)
        self.keys = AsyncKeyResource(self._client)
        self.webhooks = AsyncWebhookResource(self._client)

    async def close(self) -> None:
        await self._client.close()

    async def __aenter__(self) -> "AsyncCommons":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()
