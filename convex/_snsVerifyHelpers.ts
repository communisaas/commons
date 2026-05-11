// Pure helpers for SNS signature verification — no Node runtime dependency,
// so they can be unit-tested directly without spinning up Convex actions.
// The crypto-bearing wrapper lives in `_snsVerify.ts` ("use node").

export interface SnsMessageFields {
	Type: string;
	MessageId: string;
	TopicArn: string;
	Timestamp: string;
	Message: string;
	Subject?: string;
	SubscribeURL?: string;
	Token?: string;
}

// SSRF guard: only accept SigningCertURLs served by AWS SNS over HTTPS.
export function validateCertURL(certURL: string): boolean {
	try {
		const url = new URL(certURL);
		return (
			url.protocol === "https:" &&
			url.pathname.endsWith(".pem") &&
			/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)
		);
	} catch {
		return false;
	}
}

// Canonical signing string per the AWS SNS spec. Field order and inclusion
// depend on message Type. Trailing newline is required.
export function buildSigningString(msg: SnsMessageFields): string {
	const lines: string[] = [];
	lines.push("Message", msg.Message);
	lines.push("MessageId", msg.MessageId);
	if (msg.Type === "SubscriptionConfirmation" || msg.Type === "UnsubscribeConfirmation") {
		lines.push("SubscribeURL", msg.SubscribeURL || "");
	}
	if (msg.Subject !== undefined) {
		lines.push("Subject", msg.Subject);
	}
	lines.push("Timestamp", msg.Timestamp);
	if (msg.Token !== undefined) {
		lines.push("Token", msg.Token);
	}
	lines.push("TopicArn", msg.TopicArn);
	lines.push("Type", msg.Type);
	return lines.join("\n") + "\n";
}
