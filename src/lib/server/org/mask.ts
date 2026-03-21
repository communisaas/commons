export function maskEmail(email: string): string {
	const [local, domain] = email.split('@');
	if (!domain) return '***';
	return `${local.charAt(0)}***@${domain}`;
}
