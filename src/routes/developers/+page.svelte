<script lang="ts">
	let copiedId = $state<string | null>(null);

	function copyCode(id: string, code: string) {
		navigator.clipboard.writeText(code.trim()).then(() => {
			copiedId = id;
			setTimeout(() => {
				if (copiedId === id) copiedId = null;
			}, 2000);
		});
	}
</script>

<svelte:head>
	<title>Developers | Commons</title>
	<meta name="description" content="Commons Public API documentation. Free, uncapped REST API with TypeScript and Python SDKs." />
</svelte:head>

<div class="dev-page">
	<!-- Hero -->
	<header class="hero">
		<h1 class="hero-title">Building on Commons</h1>
		<p class="hero-subtitle">
			Free, uncapped REST API. TypeScript + Python SDKs. Cursor pagination. Verified civic infrastructure.
		</p>
		<div class="hero-actions">
			<a href="/org" class="btn btn-primary">Get API Key</a>
			<a href="/api/v1/docs" class="btn btn-secondary">View OpenAPI Spec</a>
		</div>
	</header>

	<!-- Quick Start -->
	<section class="section">
		<h2 class="section-title">Quick Start</h2>
		<div class="steps">
			<div class="step">
				<div class="step-number">1</div>
				<div class="step-content">
					<h3>Create an API key</h3>
					<p>Go to your organization dashboard and create an API key, or use the API:</p>
					<div class="code-block">
						<div class="code-header">
							<span class="code-lang">bash</span>
							<button class="copy-btn" onclick={() => copyCode('qs1', `curl -X POST https://commons.email/api/v1/keys \\
  -H "Content-Type: application/json" \\
  -d '{"orgSlug": "your-org"}'`)}>
								{copiedId === 'qs1' ? 'Copied' : 'Copy'}
							</button>
						</div>
						<pre><code>{`curl -X POST https://commons.email/api/v1/keys \\
  -H "Content-Type: application/json" \\
  -d '{"orgSlug": "your-org"}'`}</code></pre>
					</div>
				</div>
			</div>

			<div class="step">
				<div class="step-number">2</div>
				<div class="step-content">
					<h3>Make your first request</h3>
					<div class="code-block">
						<div class="code-header">
							<span class="code-lang">bash</span>
							<button class="copy-btn" onclick={() => copyCode('qs2', `curl https://commons.email/api/v1/supporters \\
  -H "Authorization: Bearer ck_live_your_key_here"`)}>
								{copiedId === 'qs2' ? 'Copied' : 'Copy'}
							</button>
						</div>
						<pre><code>{`curl https://commons.email/api/v1/supporters \\
  -H "Authorization: Bearer ck_live_your_key_here"`}</code></pre>
					</div>
				</div>
			</div>

			<div class="step">
				<div class="step-number">3</div>
				<div class="step-content">
					<h3>Parse the response</h3>
					<div class="code-block">
						<div class="code-header">
							<span class="code-lang">json</span>
							<button class="copy-btn" onclick={() => copyCode('qs3', `{
  "data": [
    {
      "id": "sup_abc123",
      "email": "jane@example.com",
      "name": "Jane Doe",
      "verified": true,
      "tags": [{ "id": "tag_1", "name": "volunteer" }]
    }
  ],
  "meta": {
    "cursor": "sup_abc123",
    "hasMore": true,
    "total": 1450
  }
}`)}>
								{copiedId === 'qs3' ? 'Copied' : 'Copy'}
							</button>
						</div>
						<pre><code>{`{
  "data": [
    {
      "id": "sup_abc123",
      "email": "jane@example.com",
      "name": "Jane Doe",
      "verified": true,
      "tags": [{ "id": "tag_1", "name": "volunteer" }]
    }
  ],
  "meta": {
    "cursor": "sup_abc123",
    "hasMore": true,
    "total": 1450
  }
}`}</code></pre>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- Installation -->
	<section class="section">
		<h2 class="section-title">Installation</h2>
		<div class="install-grid">
			<div>
				<div class="code-block">
					<div class="code-header">
						<span class="code-lang">TypeScript</span>
						<button class="copy-btn" onclick={() => copyCode('inst-ts', 'npm install @commons-platform/sdk')}>
							{copiedId === 'inst-ts' ? 'Copied' : 'Copy'}
						</button>
					</div>
					<pre><code>npm install @commons-platform/sdk</code></pre>
				</div>
				<div class="code-block" style="margin-top: 1rem;">
					<div class="code-header">
						<span class="code-lang">TypeScript</span>
						<button class="copy-btn" onclick={() => copyCode('usage-ts', `import { Commons } from '@commons-platform/sdk';

const commons = new Commons({ apiKey: 'ck_live_...' });

// List supporters
const supporters = await commons.supporters.list();

// Create a campaign
const campaign = await commons.campaigns.create({
  title: 'Clean Energy Act',
  type: 'LETTER'
});`)}>
							{copiedId === 'usage-ts' ? 'Copied' : 'Copy'}
						</button>
					</div>
					<pre><code>{`import { Commons } from '@commons-platform/sdk';

const commons = new Commons({ apiKey: 'ck_live_...' });

// List supporters
const supporters = await commons.supporters.list();

// Create a campaign
const campaign = await commons.campaigns.create({
  title: 'Clean Energy Act',
  type: 'LETTER'
});`}</code></pre>
				</div>
			</div>
			<div>
				<div class="code-block">
					<div class="code-header">
						<span class="code-lang">Python</span>
						<button class="copy-btn" onclick={() => copyCode('inst-py', 'pip install commons-sdk')}>
							{copiedId === 'inst-py' ? 'Copied' : 'Copy'}
						</button>
					</div>
					<pre><code>pip install commons-sdk</code></pre>
				</div>
				<div class="code-block" style="margin-top: 1rem;">
					<div class="code-header">
						<span class="code-lang">Python</span>
						<button class="copy-btn" onclick={() => copyCode('usage-py', `from commons import Commons

client = Commons(api_key="ck_live_...")

# List supporters
supporters = client.supporters.list()

# Create a campaign
campaign = client.campaigns.create(
    title="Clean Energy Act",
    type="LETTER"
)`)}>
							{copiedId === 'usage-py' ? 'Copied' : 'Copy'}
						</button>
					</div>
					<pre><code>{`from commons import Commons

client = Commons(api_key="ck_live_...")

# List supporters
supporters = client.supporters.list()

# Create a campaign
campaign = client.campaigns.create(
    title="Clean Energy Act",
    type="LETTER"
)`}</code></pre>
				</div>
			</div>
		</div>
	</section>

	<!-- Authentication -->
	<section class="section">
		<h2 class="section-title">Authentication</h2>
		<p class="section-desc">
			All API requests require a Bearer token in the <code>Authorization</code> header.
			API keys use the prefix <code>ck_live_</code> and are scoped to a single organization.
		</p>
		<div class="auth-details">
			<div class="info-card">
				<h3>Scopes</h3>
				<ul>
					<li><code>read</code> — List and retrieve resources (default)</li>
					<li><code>write</code> — Create, update, and delete resources (implies read)</li>
				</ul>
			</div>
		</div>
		<div class="code-block">
			<div class="code-header">
				<span class="code-lang">bash</span>
				<button class="copy-btn" onclick={() => copyCode('auth', `curl https://commons.email/api/v1/supporters \\
  -H "Authorization: Bearer ck_live_abc123def456"`)}>
					{copiedId === 'auth' ? 'Copied' : 'Copy'}
				</button>
			</div>
			<pre><code>{`curl https://commons.email/api/v1/supporters \\
  -H "Authorization: Bearer ck_live_abc123def456"`}</code></pre>
		</div>
	</section>

	<!-- Resources Reference -->
	<section class="section">
		<h2 class="section-title">Resources</h2>
		<p class="section-desc">All resources are accessed under <code>/api/v1/</code>. Responses use the envelope format <code>{`{ data, meta?, error? }`}</code>.</p>

		<!-- Organization -->
		<details class="resource">
			<summary class="resource-summary">
				<span class="resource-name">Organization</span>
				<span class="resource-methods"><span class="method get">GET</span></span>
			</summary>
			<div class="resource-body">
				<p>Returns the organization bound to the API key.</p>
				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/orgs</code>
				</div>
				<div class="code-block">
					<div class="code-header">
						<span class="code-lang">Response</span>
						<button class="copy-btn" onclick={() => copyCode('org-resp', `{
  "data": {
    "id": "org_1",
    "name": "Climate Action Coalition",
    "slug": "climate-action",
    "description": "Grassroots climate advocacy",
    "counts": {
      "supporters": 12500,
      "campaigns": 8,
      "templates": 15
    }
  }
}`)}>
							{copiedId === 'org-resp' ? 'Copied' : 'Copy'}
						</button>
					</div>
					<pre><code>{`{
  "data": {
    "id": "org_1",
    "name": "Climate Action Coalition",
    "slug": "climate-action",
    "description": "Grassroots climate advocacy",
    "counts": {
      "supporters": 12500,
      "campaigns": 8,
      "templates": 15
    }
  }
}`}</code></pre>
				</div>
			</div>
		</details>

		<!-- Supporters -->
		<details class="resource">
			<summary class="resource-summary">
				<span class="resource-name">Supporters</span>
				<span class="resource-methods">
					<span class="method get">GET</span>
					<span class="method post">POST</span>
					<span class="method patch">PATCH</span>
					<span class="method delete">DELETE</span>
				</span>
			</summary>
			<div class="resource-body">
				<p>Manage your organization's supporter CRM.</p>

				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/supporters</code>
				</div>
				<div class="params">
					<h4>Query Parameters</h4>
					<table class="params-table">
						<thead><tr><th>Param</th><th>Type</th><th>Description</th></tr></thead>
						<tbody>
							<tr><td><code>cursor</code></td><td>string</td><td>Pagination cursor</td></tr>
							<tr><td><code>limit</code></td><td>integer</td><td>Items per page (max 50)</td></tr>
							<tr><td><code>email</code></td><td>string</td><td>Filter by exact email</td></tr>
							<tr><td><code>verified</code></td><td>boolean</td><td>Filter by verification status</td></tr>
							<tr><td><code>email_status</code></td><td>string</td><td>subscribed, unsubscribed, bounced, complained</td></tr>
							<tr><td><code>source</code></td><td>string</td><td>csv, action_network, organic, widget</td></tr>
							<tr><td><code>tag</code></td><td>string</td><td>Filter by tag ID</td></tr>
						</tbody>
					</table>
				</div>

				<div class="endpoint-row">
					<span class="method post">POST</span>
					<code>/api/v1/supporters</code>
					<span class="scope-badge">write</span>
				</div>
				<div class="code-block">
					<div class="code-header">
						<span class="code-lang">Request Body</span>
						<button class="copy-btn" onclick={() => copyCode('sup-create', `{
  "email": "jane@example.com",
  "name": "Jane Doe",
  "postalCode": "94105",
  "tags": ["tag_volunteer"]
}`)}>
							{copiedId === 'sup-create' ? 'Copied' : 'Copy'}
						</button>
					</div>
					<pre><code>{`{
  "email": "jane@example.com",
  "name": "Jane Doe",
  "postalCode": "94105",
  "tags": ["tag_volunteer"]
}`}</code></pre>
				</div>

				<div class="endpoint-row">
					<span class="method patch">PATCH</span>
					<code>/api/v1/supporters/{'{id}'}</code>
					<span class="scope-badge">write</span>
				</div>

				<div class="endpoint-row">
					<span class="method delete">DELETE</span>
					<code>/api/v1/supporters/{'{id}'}</code>
					<span class="scope-badge">write</span>
				</div>
			</div>
		</details>

		<!-- Campaigns -->
		<details class="resource">
			<summary class="resource-summary">
				<span class="resource-name">Campaigns</span>
				<span class="resource-methods">
					<span class="method get">GET</span>
					<span class="method post">POST</span>
					<span class="method patch">PATCH</span>
				</span>
			</summary>
			<div class="resource-body">
				<p>Create and manage campaigns. Each campaign can have associated actions.</p>

				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/campaigns</code>
				</div>
				<div class="params">
					<h4>Query Parameters</h4>
					<table class="params-table">
						<thead><tr><th>Param</th><th>Type</th><th>Description</th></tr></thead>
						<tbody>
							<tr><td><code>status</code></td><td>string</td><td>DRAFT, ACTIVE, PAUSED, COMPLETE</td></tr>
							<tr><td><code>type</code></td><td>string</td><td>LETTER, EVENT, FORM</td></tr>
						</tbody>
					</table>
				</div>

				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/campaigns/{'{id}'}</code>
				</div>

				<div class="endpoint-row">
					<span class="method post">POST</span>
					<code>/api/v1/campaigns</code>
					<span class="scope-badge">write</span>
				</div>

				<div class="endpoint-row">
					<span class="method patch">PATCH</span>
					<code>/api/v1/campaigns/{'{id}'}</code>
					<span class="scope-badge">write</span>
				</div>

				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/campaigns/{'{id}'}/actions</code>
				</div>
				<div class="params">
					<h4>Query Parameters</h4>
					<table class="params-table">
						<thead><tr><th>Param</th><th>Type</th><th>Description</th></tr></thead>
						<tbody>
							<tr><td><code>verified</code></td><td>boolean</td><td>Filter by verification status</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		</details>

		<!-- Tags -->
		<details class="resource">
			<summary class="resource-summary">
				<span class="resource-name">Tags</span>
				<span class="resource-methods">
					<span class="method get">GET</span>
					<span class="method post">POST</span>
					<span class="method patch">PATCH</span>
					<span class="method delete">DELETE</span>
				</span>
			</summary>
			<div class="resource-body">
				<p>Organize supporters with tags.</p>
				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/tags</code>
				</div>
				<div class="endpoint-row">
					<span class="method post">POST</span>
					<code>/api/v1/tags</code>
					<span class="scope-badge">write</span>
				</div>
				<div class="code-block">
					<div class="code-header"><span class="code-lang">Request Body</span></div>
					<pre><code>{`{ "name": "volunteer" }`}</code></pre>
				</div>
				<div class="endpoint-row">
					<span class="method patch">PATCH</span>
					<code>/api/v1/tags/{'{id}'}</code>
					<span class="scope-badge">write</span>
				</div>
				<div class="endpoint-row">
					<span class="method delete">DELETE</span>
					<code>/api/v1/tags/{'{id}'}</code>
					<span class="scope-badge">write</span>
				</div>
			</div>
		</details>

		<!-- Events -->
		<details class="resource">
			<summary class="resource-summary">
				<span class="resource-name">Events</span>
				<span class="resource-methods"><span class="method get">GET</span></span>
			</summary>
			<div class="resource-body">
				<p>List and retrieve events with RSVP and attendance tracking.</p>
				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/events</code>
				</div>
				<div class="params">
					<h4>Query Parameters</h4>
					<table class="params-table">
						<thead><tr><th>Param</th><th>Type</th><th>Description</th></tr></thead>
						<tbody>
							<tr><td><code>status</code></td><td>string</td><td>DRAFT, PUBLISHED, CANCELLED, COMPLETED</td></tr>
							<tr><td><code>eventType</code></td><td>string</td><td>IN_PERSON, VIRTUAL, HYBRID</td></tr>
						</tbody>
					</table>
				</div>
				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/events/{'{id}'}</code>
				</div>
				<div class="code-block">
					<div class="code-header"><span class="code-lang">Response</span></div>
					<pre><code>{`{
  "data": {
    "id": "evt_1",
    "title": "Town Hall Q3",
    "eventType": "IN_PERSON",
    "status": "PUBLISHED",
    "startsAt": "2026-04-15T18:00:00Z",
    "endsAt": "2026-04-15T20:00:00Z",
    "venue": "City Hall, Room 201",
    "capacity": 200,
    "rsvpCount": 142,
    "attendeeCount": 0
  }
}`}</code></pre>
				</div>
			</div>
		</details>

		<!-- Donations -->
		<details class="resource">
			<summary class="resource-summary">
				<span class="resource-name">Donations</span>
				<span class="resource-methods"><span class="method get">GET</span></span>
			</summary>
			<div class="resource-body">
				<p>Retrieve donation records. 0% platform fee -- only Stripe's processing fee applies.</p>
				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/donations</code>
				</div>
				<div class="params">
					<h4>Query Parameters</h4>
					<table class="params-table">
						<thead><tr><th>Param</th><th>Type</th><th>Description</th></tr></thead>
						<tbody>
							<tr><td><code>status</code></td><td>string</td><td>pending, completed, refunded</td></tr>
							<tr><td><code>campaignId</code></td><td>string</td><td>Filter by campaign ID</td></tr>
						</tbody>
					</table>
				</div>
				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/donations/{'{id}'}</code>
				</div>
			</div>
		</details>

		<!-- Workflows -->
		<details class="resource">
			<summary class="resource-summary">
				<span class="resource-name">Workflows</span>
				<span class="resource-methods"><span class="method get">GET</span></span>
			</summary>
			<div class="resource-body">
				<p>Automation workflows with event-driven triggers and multi-step actions.</p>
				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/workflows</code>
				</div>
				<div class="params">
					<h4>Query Parameters</h4>
					<table class="params-table">
						<thead><tr><th>Param</th><th>Type</th><th>Description</th></tr></thead>
						<tbody>
							<tr><td><code>enabled</code></td><td>boolean</td><td>Filter by enabled status</td></tr>
						</tbody>
					</table>
				</div>
				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/workflows/{'{id}'}</code>
				</div>
			</div>
		</details>

		<!-- SMS Blasts -->
		<details class="resource">
			<summary class="resource-summary">
				<span class="resource-name">SMS Blasts</span>
				<span class="resource-methods"><span class="method get">GET</span></span>
			</summary>
			<div class="resource-body">
				<p>Twilio-powered SMS blast campaigns.</p>
				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/sms</code>
				</div>
				<div class="params">
					<h4>Query Parameters</h4>
					<table class="params-table">
						<thead><tr><th>Param</th><th>Type</th><th>Description</th></tr></thead>
						<tbody>
							<tr><td><code>status</code></td><td>string</td><td>draft, sending, sent, failed</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		</details>

		<!-- Calls -->
		<details class="resource">
			<summary class="resource-summary">
				<span class="resource-name">Patch-Through Calls</span>
				<span class="resource-methods"><span class="method get">GET</span></span>
			</summary>
			<div class="resource-body">
				<p>Patch-through calling with verified district matching.</p>
				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/calls</code>
				</div>
				<div class="params">
					<h4>Query Parameters</h4>
					<table class="params-table">
						<thead><tr><th>Param</th><th>Type</th><th>Description</th></tr></thead>
						<tbody>
							<tr><td><code>status</code></td><td>string</td><td>initiated, ringing, in-progress, completed, failed, no-answer, busy</td></tr>
							<tr><td><code>campaignId</code></td><td>string</td><td>Filter by campaign ID</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		</details>

		<!-- Representatives -->
		<details class="resource">
			<summary class="resource-summary">
				<span class="resource-name">Representatives</span>
				<span class="resource-methods"><span class="method get">GET</span></span>
			</summary>
			<div class="resource-body">
				<p>International representative lookup with constituency filtering.</p>
				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/representatives</code>
				</div>
				<div class="params">
					<h4>Query Parameters</h4>
					<table class="params-table">
						<thead><tr><th>Param</th><th>Type</th><th>Description</th></tr></thead>
						<tbody>
							<tr><td><code>country</code></td><td>string</td><td>ISO country code</td></tr>
							<tr><td><code>constituency</code></td><td>string</td><td>Constituency ID</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		</details>

		<!-- Usage -->
		<details class="resource">
			<summary class="resource-summary">
				<span class="resource-name">Usage</span>
				<span class="resource-methods"><span class="method get">GET</span></span>
			</summary>
			<div class="resource-body">
				<p>Current billing period usage for your organization.</p>
				<div class="endpoint-row">
					<span class="method get">GET</span>
					<code>/api/v1/usage</code>
				</div>
				<div class="code-block">
					<div class="code-header"><span class="code-lang">Response</span></div>
					<pre><code>{`{
  "data": {
    "verifiedActions": 847,
    "maxVerifiedActions": 5000,
    "emailsSent": 3200,
    "maxEmails": 10000
  }
}`}</code></pre>
				</div>
			</div>
		</details>
	</section>

	<!-- Pagination -->
	<section class="section">
		<h2 class="section-title">Pagination</h2>
		<p class="section-desc">
			All list endpoints use cursor-based pagination. Pass the <code>cursor</code> from the previous response's <code>meta</code> object to get the next page.
		</p>
		<div class="code-block">
			<div class="code-header">
				<span class="code-lang">bash</span>
				<button class="copy-btn" onclick={() => copyCode('pag-req', `# First page
curl "https://commons.email/api/v1/supporters?limit=25"

# Next page (use cursor from previous response)
curl "https://commons.email/api/v1/supporters?limit=25&cursor=sup_abc123"`)}>
					{copiedId === 'pag-req' ? 'Copied' : 'Copy'}
				</button>
			</div>
			<pre><code>{`# First page
curl "https://commons.email/api/v1/supporters?limit=25"

# Next page (use cursor from previous response)
curl "https://commons.email/api/v1/supporters?limit=25&cursor=sup_abc123"`}</code></pre>
		</div>
		<div class="code-block">
			<div class="code-header"><span class="code-lang">Response meta</span></div>
			<pre><code>{`{
  "meta": {
    "cursor": "sup_xyz789",
    "hasMore": true,
    "total": 1450
  }
}`}</code></pre>
		</div>
		<p class="section-desc" style="margin-top: 1.5rem;">The SDKs provide auto-pagination with async iterators:</p>
		<div class="install-grid">
			<div class="code-block">
				<div class="code-header">
					<span class="code-lang">TypeScript</span>
					<button class="copy-btn" onclick={() => copyCode('pag-ts', `// Auto-paginate through all supporters
for await (const supporter of commons.supporters.list()) {
  console.log(supporter.email);
}`)}>
						{copiedId === 'pag-ts' ? 'Copied' : 'Copy'}
					</button>
				</div>
				<pre><code>{`// Auto-paginate through all supporters
for await (const supporter of commons.supporters.list()) {
  console.log(supporter.email);
}`}</code></pre>
			</div>
			<div class="code-block">
				<div class="code-header">
					<span class="code-lang">Python</span>
					<button class="copy-btn" onclick={() => copyCode('pag-py', `# Auto-paginate through all supporters
for supporter in client.supporters.list():
    print(supporter.email)`)}>
						{copiedId === 'pag-py' ? 'Copied' : 'Copy'}
					</button>
				</div>
				<pre><code>{`# Auto-paginate through all supporters
for supporter in client.supporters.list():
    print(supporter.email)`}</code></pre>
			</div>
		</div>
	</section>

	<!-- Errors -->
	<section class="section">
		<h2 class="section-title">Errors</h2>
		<p class="section-desc">
			Error responses use the same envelope format with <code>data: null</code> and an <code>error</code> object:
		</p>
		<div class="code-block">
			<div class="code-header"><span class="code-lang">Error response</span></div>
			<pre><code>{`{
  "data": null,
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  }
}`}</code></pre>
		</div>
		<table class="error-table">
			<thead>
				<tr><th>Code</th><th>HTTP</th><th>Description</th></tr>
			</thead>
			<tbody>
				<tr><td><code>BAD_REQUEST</code></td><td>400</td><td>Invalid input or malformed JSON</td></tr>
				<tr><td><code>UNAUTHORIZED</code></td><td>401</td><td>Missing or invalid API key</td></tr>
				<tr><td><code>FORBIDDEN</code></td><td>403</td><td>API key lacks required scope</td></tr>
				<tr><td><code>NOT_FOUND</code></td><td>404</td><td>Resource does not exist</td></tr>
				<tr><td><code>CONFLICT</code></td><td>409</td><td>Duplicate resource (e.g. email already exists)</td></tr>
				<tr><td><code>RATE_LIMITED</code></td><td>429</td><td>Too many requests -- slow down</td></tr>
				<tr><td><code>INTERNAL_ERROR</code></td><td>500</td><td>Unexpected server error</td></tr>
			</tbody>
		</table>
	</section>

	<!-- Rate Limits -->
	<section class="section">
		<h2 class="section-title">Rate Limits</h2>
		<p class="section-desc">
			Rate limits are applied per API key based on your organization's plan. When rate limited, you'll receive a <code>429</code> response.
		</p>
		<table class="rate-table">
			<thead>
				<tr><th>Plan</th><th>Requests / min</th></tr>
			</thead>
			<tbody>
				<tr><td>Free</td><td>100</td></tr>
				<tr><td>Starter</td><td>300</td></tr>
				<tr><td>Organization</td><td>1,000</td></tr>
				<tr><td>Coalition</td><td>3,000</td></tr>
			</tbody>
		</table>
	</section>

	<footer class="page-footer">
		<p>Questions? Reach us at <a href="mailto:hello@commons.email">hello@commons.email</a></p>
	</footer>
</div>

<style>
	/* ========================================
	   Developer Guide Page Styles
	   ======================================== */

	.dev-page {
		max-width: 960px;
		margin: 0 auto;
		padding: 3rem 1.5rem 4rem;
		font-family: 'Satoshi', ui-sans-serif, system-ui, -apple-system, sans-serif;
		color: #1a1a2e;
	}

	@media (min-width: 768px) {
		.dev-page {
			padding: 4rem 2rem 6rem;
		}
	}

	/* Hero */
	.hero {
		text-align: center;
		padding: 3rem 0 4rem;
		border-bottom: 1px solid #e5e7eb;
		margin-bottom: 3rem;
	}

	.hero-title {
		font-size: 2.5rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		margin: 0 0 1rem;
		color: #111827;
	}

	@media (min-width: 768px) {
		.hero-title {
			font-size: 3.25rem;
		}
	}

	.hero-subtitle {
		font-size: 1.125rem;
		color: #4b5563;
		margin: 0 0 2rem;
		max-width: 640px;
		margin-left: auto;
		margin-right: auto;
		line-height: 1.6;
	}

	.hero-actions {
		display: flex;
		gap: 1rem;
		justify-content: center;
		flex-wrap: wrap;
	}

	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		padding: 0.75rem 1.75rem;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.9375rem;
		text-decoration: none;
		transition: all 150ms ease;
		font-family: inherit;
	}

	.btn-primary {
		background: #4f46e5;
		color: #fff;
		border: 1px solid #4338ca;
	}

	.btn-primary:hover {
		background: #4338ca;
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
	}

	.btn-secondary {
		background: #fff;
		color: #374151;
		border: 1px solid #d1d5db;
	}

	.btn-secondary:hover {
		background: #f9fafb;
		border-color: #9ca3af;
		transform: translateY(-1px);
	}

	/* Sections */
	.section {
		margin-bottom: 4rem;
	}

	.section-title {
		font-size: 1.75rem;
		font-weight: 700;
		margin: 0 0 1rem;
		color: #111827;
		letter-spacing: -0.01em;
	}

	.section-desc {
		color: #4b5563;
		line-height: 1.7;
		margin: 0 0 1.5rem;
	}

	.section-desc code {
		background: #f3f4f6;
		padding: 0.15em 0.4em;
		border-radius: 4px;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.875em;
		color: #1a1a2e;
	}

	/* Steps */
	.steps {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.step {
		display: flex;
		gap: 1.25rem;
		align-items: flex-start;
	}

	.step-number {
		flex-shrink: 0;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: #4f46e5;
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.875rem;
		margin-top: 0.125rem;
	}

	.step-content {
		flex: 1;
		min-width: 0;
	}

	.step-content h3 {
		font-size: 1.125rem;
		font-weight: 600;
		margin: 0 0 0.5rem;
		color: #111827;
	}

	.step-content p {
		color: #4b5563;
		margin: 0 0 1rem;
		line-height: 1.6;
	}

	/* Code blocks */
	.code-block {
		background: #1a1a2e;
		border-radius: 10px;
		overflow: hidden;
		margin-bottom: 1rem;
	}

	.code-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 1rem;
		background: rgba(255, 255, 255, 0.06);
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}

	.code-lang {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.75rem;
		color: #9ca3af;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.copy-btn {
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: #d1d5db;
		padding: 0.25rem 0.75rem;
		border-radius: 5px;
		font-size: 0.75rem;
		font-family: 'Satoshi', system-ui, sans-serif;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.copy-btn:hover {
		background: rgba(255, 255, 255, 0.18);
		color: #fff;
	}

	.code-block pre {
		margin: 0;
		padding: 1rem;
		overflow-x: auto;
	}

	.code-block code {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.8125rem;
		line-height: 1.7;
		color: #e5e7eb;
		white-space: pre;
	}

	/* Install grid */
	.install-grid {
		display: grid;
		gap: 1.5rem;
	}

	@media (min-width: 768px) {
		.install-grid {
			grid-template-columns: 1fr 1fr;
		}
	}

	/* Auth info card */
	.auth-details {
		margin-bottom: 1.5rem;
	}

	.info-card {
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		padding: 1.25rem 1.5rem;
	}

	.info-card h3 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 0.75rem;
		color: #111827;
	}

	.info-card ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.info-card li {
		padding: 0.375rem 0;
		color: #374151;
		line-height: 1.6;
	}

	.info-card li code {
		background: #e5e7eb;
		padding: 0.15em 0.4em;
		border-radius: 4px;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.85em;
		font-weight: 500;
		color: #4f46e5;
	}

	/* Resources */
	.resource {
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		margin-bottom: 0.75rem;
		overflow: hidden;
		transition: border-color 150ms ease;
	}

	.resource[open] {
		border-color: #c7d2fe;
	}

	.resource-summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		cursor: pointer;
		user-select: none;
		list-style: none;
		transition: background 150ms ease;
	}

	.resource-summary::-webkit-details-marker {
		display: none;
	}

	.resource-summary:hover {
		background: #f9fafb;
	}

	.resource-name {
		font-weight: 600;
		font-size: 1rem;
		color: #111827;
	}

	.resource-methods {
		display: flex;
		gap: 0.375rem;
	}

	.method {
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.method.get {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.method.post {
		background: #d1fae5;
		color: #047857;
	}

	.method.patch {
		background: #fef3c7;
		color: #92400e;
	}

	.method.delete {
		background: #fee2e2;
		color: #b91c1c;
	}

	.resource-body {
		padding: 1rem 1.25rem 1.5rem;
		border-top: 1px solid #e5e7eb;
	}

	.resource-body > p {
		color: #4b5563;
		margin: 0 0 1.25rem;
		line-height: 1.6;
	}

	.endpoint-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0;
		margin-bottom: 0.5rem;
	}

	.endpoint-row code {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.875rem;
		color: #1a1a2e;
	}

	.scope-badge {
		background: #fef3c7;
		color: #92400e;
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		font-size: 0.6875rem;
		font-weight: 600;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		text-transform: uppercase;
	}

	/* Params */
	.params {
		margin-bottom: 1rem;
	}

	.params h4 {
		font-size: 0.8125rem;
		font-weight: 600;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 0.5rem;
	}

	.params-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.params-table th {
		text-align: left;
		padding: 0.5rem 0.75rem;
		background: #f9fafb;
		border-bottom: 1px solid #e5e7eb;
		font-weight: 600;
		color: #374151;
		font-size: 0.8125rem;
	}

	.params-table td {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #f3f4f6;
		color: #4b5563;
	}

	.params-table td code {
		background: #f3f4f6;
		padding: 0.1em 0.35em;
		border-radius: 3px;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.85em;
		color: #4f46e5;
	}

	/* Error + Rate tables */
	.error-table,
	.rate-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
		margin-top: 1.5rem;
	}

	.error-table th,
	.rate-table th {
		text-align: left;
		padding: 0.75rem 1rem;
		background: #f9fafb;
		border-bottom: 2px solid #e5e7eb;
		font-weight: 600;
		color: #374151;
	}

	.error-table td,
	.rate-table td {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #f3f4f6;
		color: #374151;
	}

	.error-table td code {
		background: #f3f4f6;
		padding: 0.15em 0.4em;
		border-radius: 4px;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.85em;
		color: #1a1a2e;
		font-weight: 500;
	}

	/* Footer */
	.page-footer {
		text-align: center;
		padding: 3rem 0 0;
		border-top: 1px solid #e5e7eb;
		margin-top: 2rem;
	}

	.page-footer p {
		color: #6b7280;
		font-size: 0.9375rem;
	}

	.page-footer a {
		color: #4f46e5;
		text-decoration: none;
	}

	.page-footer a:hover {
		text-decoration: underline;
	}

	/* Responsive tweaks */
	@media (max-width: 640px) {
		.hero {
			padding: 2rem 0 3rem;
		}

		.hero-title {
			font-size: 2rem;
		}

		.step {
			flex-direction: column;
			gap: 0.75rem;
		}

		.resource-summary {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.5rem;
		}

		.endpoint-row {
			flex-wrap: wrap;
		}

		.params-table,
		.error-table,
		.rate-table {
			font-size: 0.8125rem;
		}

		.params-table th,
		.params-table td,
		.error-table th,
		.error-table td,
		.rate-table th,
		.rate-table td {
			padding: 0.5rem;
		}
	}
</style>
