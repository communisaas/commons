import { describe, expect, it } from 'vitest';

import {
	classifyRetrievalBlock,
	hasUsableRetrievalContact
} from '$lib/core/agents/retrieval-outcome';

describe('classifyRetrievalBlock', () => {
	it('classifies a Cloudflare challenge from its strong path marker', () => {
		const result = classifyRetrievalBlock({
			statusCode: 403,
			title: 'Just a moment...',
			text: 'Enable JavaScript and cookies to continue',
			rawHtml: '<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>'
		});

		expect(result).toMatchObject({
			vendor: 'cloudflare',
			evidence: '/cdn-cgi/challenge-platform/h/',
			statusCode: 403
		});
	});

	it('classifies the 354,000-character HTTP-200 Cloudflare shape', () => {
		const text = 'challenge /cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1 '.padEnd(
			354_000,
			'x'
		);

		const result = classifyRetrievalBlock({
			statusCode: 200,
			title: 'Checking your browser',
			text
		});

		expect(text).toHaveLength(354_000);
		expect(result).toMatchObject({
			vendor: 'cloudflare',
			evidence: '/cdn-cgi/challenge-platform/h/',
			statusCode: 200
		});
	});

	it('classifies a small Akamai access-denied response', () => {
		const body = [
			'<TITLE>Access Denied</TITLE>',
			'You do not have permission to access this server.',
			'https://errors&#46;edgesuite&#46;net/18.d0ac0317.1720000000.1a2b3c4d'
		]
			.join('\n')
			.padEnd(424, 'x');

		const result = classifyRetrievalBlock({
			statusCode: 403,
			title: 'Access Denied',
			text: body
		});

		expect(body).toHaveLength(424);
		expect(result).toMatchObject({
			vendor: 'akamai',
			evidence: 'errors.edgesuite.net',
			statusCode: 403
		});
	});

	it('does not treat the cf-mitigated response-header name as a body signal', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'Cloudflare response-header advisory',
				text: 'This advisory discusses the cf-mitigated response header. Email security@county.gov.',
				rawHtml: '<main>HTTP response header documentation</main>'
			})
		).toBeNull();
	});

	it('requires the full Akamai marker intersection', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'CDN error-reference documentation',
				text:
					'Our guide explains links on errors.edgesuite.net. Email webteam@county.gov.'.padEnd(
						3_000,
						'x'
					)
			})
		).toBeNull();
	});

	it('does not mistake public-records appeal instructions for an Akamai block', () => {
		const text =
			'If your request is access denied in whole or in part, cite the Reference # from your denial letter and email publicrecords@county.gov.'.padEnd(
				6_000,
				'x'
			);

		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'Public Records Appeals',
				text
			})
		).toBeNull();
	});

	it('classifies a Vercel security checkpoint', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 429,
				title: 'Vercel Security Checkpoint',
				text: 'Please wait.'
			})
		).toMatchObject({
			vendor: 'vercel',
			evidence: 'vercel security checkpoint',
			statusCode: 429
		});
	});

	it('treats the vendor-specific Vercel token as strong at HTTP 200', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'Hosting security glossary',
				text:
					'The phrase Vercel Security Checkpoint identifies a hosted interstitial. Email web@county.gov.'
			})
		).toMatchObject({
			vendor: 'vercel',
			evidence: 'vercel security checkpoint',
			statusCode: 200
		});
	});

	it('pins the captured PerimeterX captcha signal', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 403,
				title: 'Access to this page has been denied',
				text: 'Press and hold to confirm you are a human.',
				rawHtml: '<div id="px-captcha"></div>'
			})
		).toMatchObject({ vendor: 'perimeterx', evidence: 'px-captcha', statusCode: 403 });
	});

	it('treats the vendor-specific PerimeterX token as strong at HTTP 200', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'Frontend integration guide',
				text: 'The integration mounts a px-captcha element. Email webteam@county.gov.'
			})
		).toMatchObject({ vendor: 'perimeterx', evidence: 'px-captcha', statusCode: 200 });
	});

	it('pins the captured mn.gov Radware captcha title', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'Radware Bot Manager Captcha',
				text: 'Complete the captcha to continue.'
			})
		).toMatchObject({
			vendor: 'radware',
			evidence: 'radware bot manager captcha',
			statusCode: 200
		});
	});

	it('keeps the full Radware title marker readable when visible contact content follows', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'Radware Bot Manager Captcha',
				text:
					'This training page reproduces the vendor screen for staff. Email security@county.gov.'
			})
		).toBeNull();
	});

	it('does not mistake Radware vendor-disclosure prose for a challenge', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'County IT vendor disclosure',
				text: 'Our vendor list includes Radware Bot Manager, which flags unusual activity.'
			})
		).toBeNull();
	});

	it('classifies an Imperva Incapsula interstitial', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 403,
				title: 'Request unsuccessful',
				text: 'Incident ID: 123456789',
				rawHtml: '<script src="/_Incapsula_Resource?SWJIYLWA=1"></script>'
			})
		).toMatchObject({ vendor: 'imperva', evidence: 'request unsuccessful', statusCode: 403 });
	});

	it('keeps the full former Imperva conjunction on a served police-records page readable', () => {
		const text =
			'Austin Police records: provide the Incident ID: 2024-01187 and email records@austintexas.gov.'.padEnd(
				3_136,
				'x'
			);
		const rawHtml =
			'<script src="/_Incapsula_Resource?SWJIYLWA=1&ns=2&cb=123"></script>'.padEnd(
				108_286,
				'x'
			);

		expect(text).toHaveLength(3_136);
		expect(rawHtml).toHaveLength(108_286);
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'Police Records | AustinTexas.gov',
				text,
				rawHtml
			})
		).toBeNull();
	});

	it('does not mistake a PerimeterX custom-prefix sensor on a readable page for a block', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'Walmart Corporate Newsroom',
				text: 'Press resources and contacts. Email press@walmart.com.'.padEnd(4_000, 'x'),
				rawHtml: '<script src="/_px/PXu6b0qd2S/main.min.js"></script>'
			})
		).toBeNull();
	});

	it('treats the unverified AWS WAF token host as generic, corroborated evidence', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 403,
				title: 'AWS WAF challenge',
				text: 'Complete the challenge to continue.',
				rawHtml: '<script src="https://token.awswaf.com/challenge.js"></script>'
			})
		).toMatchObject({ vendor: 'awswaf', evidence: 'token.awswaf.com', statusCode: 403 });
	});

	it('does not mistake an AWS WAF integration script on a readable page for a block', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'IMDb Help Center',
				text: 'Help articles and customer support. Email support@imdb.com.'.padEnd(3_000, 'x'),
				rawHtml: '<script src="https://token.awswaf.com/challenge.js"></script>'
			})
		).toBeNull();
	});

	it.each(['hero@2x.jpeg', `${'a'.repeat(245)}@county.gov`])(
		'does not let the pseudo-address %s suppress a generic challenge',
		(pseudoAddress) => {
			expect(
				classifyRetrievalBlock({
					statusCode: 403,
					title: 'Access Denied',
					text: `Request blocked. Asset reference: ${pseudoAddress}`
				})
			).toMatchObject({ vendor: 'unknown', evidence: 'access denied', statusCode: 403 });
		}
	);

	it('does not classify a large branded 404 shell as blocked', () => {
		const text = 'CommonSpirit Health page shell '.padEnd(141_000, 'x');

		expect(text).toHaveLength(141_000);
		expect(
			classifyRetrievalBlock({
				statusCode: 404,
				title: '404 | CommonSpirit Health',
				text
			})
		).toBeNull();
	});

	it('does not reclassify contact-page prose containing the exact access denied marker', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'County Clerk Contact',
				text: 'When access denied appears on a notice, contact clerk@county.gov for an appeal.'
			})
		).toBeNull();
	});

	it('uses a usable email to reject a generic marker with a known blocked status', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 403,
				title: 'County Clerk Contact',
				text: 'Access denied appeals are handled by clerk@county.gov.'
			})
		).toBeNull();
	});

	it('does not treat missing status as evidence for a generic-only block signal', () => {
		const input = {
			title: 'Police Records Instructions',
			text: 'Provide the Incident ID: 2024-01187 when requesting a copy.'.padEnd(900, 'x')
		};

		expect(classifyRetrievalBlock(input)).toBeNull();
		expect(classifyRetrievalBlock({ ...input, statusCode: 403 })).toMatchObject({
			vendor: 'unknown',
			evidence: 'incident id:',
			statusCode: 403
		});
	});

	it.each([
		'just a moment...',
		'checking your browser before accessing',
		'access denied',
		'attention required',
		'pardon our interruption',
		'verify you are human',
		'verifying you are a human',
		'are you a robot',
		'bot detection',
		'request unsuccessful',
		'security checkpoint',
		'403 forbidden',
		'datadome',
		'incident id:',
		'token.awswaf.com'
	])('pins the generic matcher %s behind blocked-status corroboration', (marker) => {
		const isCloudflareCapture = marker === 'attention required';
		const vendor = isCloudflareCapture
			? 'cloudflare'
			: marker === 'datadome'
				? 'datadome'
				: marker === 'token.awswaf.com'
					? 'awswaf'
					: 'unknown';
		expect(
			classifyRetrievalBlock({
				statusCode: 403,
				title: isCloudflareCapture
					? 'Attention Required! | Cloudflare'
					: 'Compact provider interstitial',
				text: marker
			})
		).toMatchObject({ vendor, evidence: marker, statusCode: 403 });
	});

	it.each([
		{
			source: 'crunchbase.com Cloudflare 1020',
			title: 'Attention Required! | Cloudflare',
			text: 'Sorry, you have been blocked. Cloudflare Ray ID: 8f1234567890abcd'.padEnd(
				773,
				'x'
			),
			textLength: 773,
			evidence: 'cloudflare ray id:'
		},
		{
			source: 'compact contact-free community.make.com discussion',
			title: 'Browser automation discussion',
			text: 'Enable JavaScript and cookies to continue.'.padEnd(76, 'x'),
			textLength: 76,
			evidence: 'enable javascript and cookies to continue'
		}
	])('keeps body prose from $source readable when the provider supplies no status', (capture) => {
		expect(capture.text).toHaveLength(capture.textLength);
		expect(capture.text).toContain(
			capture.evidence === 'cloudflare ray id:'
				? 'Cloudflare Ray ID:'
				: 'Enable JavaScript and cookies to continue'
		);
		expect(classifyRetrievalBlock({ title: capture.title, text: capture.text })).toBeNull();
	});

	it('pins compact enable-javascript body prose when a known response is blocked', () => {
		const text = 'Enable JavaScript and cookies to continue.'.padEnd(171, 'x');

		expect(
			classifyRetrievalBlock({
				statusCode: 403,
				title: 'Browser verification',
				text
			})
		).toMatchObject({
			vendor: 'cloudflare',
			evidence: 'enable javascript and cookies to continue',
			statusCode: 403
		});
	});

	it('does not pretend Indeed noscript prose survives Exa text extraction', () => {
		const text = 'Security verification page.'.padEnd(27, 'x');

		expect(text).toHaveLength(27);
		expect(text).not.toContain('Additional Verification Required');
		expect(text).not.toContain('Enable JavaScript and cookies to continue');
		expect(
			classifyRetrievalBlock({
				title: 'Security Check - Indeed.com',
				text
			})
		).toBeNull();
	});

	it.each([
		{
			guard: 'known HTTP-200 status',
			statusCode: 200,
			text: 'Sorry, you have been blocked. Cloudflare Ray ID: 8f1234567890abcd'.padEnd(
				773,
				'x'
			)
		},
		{
			guard: 'compact-body ceiling with a known blocked status',
			statusCode: 403,
			text: 'Enable JavaScript and cookies to continue.'.padEnd(4_818, 'x')
		},
		{
			guard: 'compact-body ceiling on the status-less Exa shape',
			statusCode: undefined,
			text: 'Sorry, you have been blocked. Cloudflare Ray ID: 8f1234567890abcd'.padEnd(
				60_968,
				'x'
			)
		}
	])('keeps full body-prose matches readable under the $guard', ({ statusCode, text }) => {
		expect(text).not.toContain('@');
		expect(
			classifyRetrievalBlock({
				statusCode,
				title: 'Security guidance and support discussion',
				text
			})
		).toBeNull();
	});

	it.each([
		'Sorry, you have been blocked. This response has no vendor request identifier.',
		'Cloudflare Ray ID: 8f1234567890abcd. This is a request-tracing glossary.'
	])('requires the full Cloudflare 1020 body-prose intersection: %s', (text) => {
		expect(classifyRetrievalBlock({ statusCode: 403, title: 'Edge response', text })).toBeNull();
	});

	it('uses body text, not a captured title, for the extracted-prose signal', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 403,
				title: 'Enable JavaScript and cookies to continue',
				text: 'County technology guidance and browser support information.'.padEnd(900, 'x')
			})
		).toBeNull();
	});

	it.each([
		'Sorry, you have been blocked. Cloudflare Ray ID: 8f1234567890abcd. Email security@county.gov.',
		'Enable JavaScript and cookies to continue. Call the web office at (555) 010-1234.'
	])('keeps readable contact content that quotes body-prose markers: %s', (text) => {
		expect(
			classifyRetrievalBlock({ statusCode: 403, title: 'Security training', text })
		).toBeNull();
	});

	it.each([
		{
			vendor: 'cloudflare',
			evidence: '/cdn-cgi/challenge-platform/h/',
			title: 'Just a moment...',
			text: '/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1'
		},
		{
			vendor: 'akamai',
			evidence: 'errors.edgesuite.net',
			title: 'Captured response',
			text: 'Access denied. See errors.edgesuite.net for details.'
		},
		{
			vendor: 'perimeterx',
			evidence: 'px-captcha',
			title: 'Captured response',
			text: '<div id="px-captcha"></div>'
		},
		{
			vendor: 'vercel',
			evidence: 'vercel security checkpoint',
			title: 'Captured response',
			text: 'Vercel Security Checkpoint'
		},
		{
			vendor: 'radware',
			evidence: 'radware bot manager captcha',
			title: 'Radware Bot Manager Captcha',
			text: 'Radware Bot Manager Captcha'
		}
	])('classifies the $vendor matcher when the retrieval path has no status', (capture) => {
		expect(
			classifyRetrievalBlock({
				title: capture.title,
				text: capture.text
			})
		).toMatchObject({ vendor: capture.vendor, evidence: capture.evidence });
	});

	it('does not treat a full readable body as a compact generic interstitial', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 403,
				title: 'County Technology Overview',
				text: 'Our vendor list includes DataDome for bot mitigation.'.padEnd(3_000, 'x')
			})
		).toBeNull();
	});

	it.each(['(555)010-1234', '5550101234'])(
		'accepts the published phone format %s as usable contact evidence',
		(phone) => {
			expect(
				classifyRetrievalBlock({
					statusCode: 403,
					title: 'Police Records',
					text: `Provide the Incident ID: 2024-01187 and call the Records Unit at ${phone}.`
				})
			).toBeNull();
		}
	);

	it.each(['555-010-1234', '555.010.1234', '(555) 010-1234'])(
		'uses punctuation alone to recognize the published phone format %s',
		(phone) => {
			expect(
				classifyRetrievalBlock({
					statusCode: 403,
					title: 'Police Records',
					text: `Provide the Incident ID: 2024-01187. Records desk: ${phone}.`
				})
			).toBeNull();
		}
	);

	it('requires punctuation or phone context before a bare digit run becomes contact evidence', () => {
		expect(hasUsableRetrievalContact('Records desk identifier: 5550101234')).toBe(false);
		expect(hasUsableRetrievalContact('Call the records desk at 5550101234')).toBe(true);
	});

	it('does not mistake an unanchored CDN reference epoch for a published phone', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 403,
				title: 'Access Denied',
				text: 'Reference 18.27f51602.1786144462.13d417a1'
			})
		).toMatchObject({ vendor: 'unknown', evidence: 'access denied', statusCode: 403 });
	});

	it('does not scan a raw-HTML phone-shaped reference as published contact', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 403,
				title: 'Access Denied',
				text: 'The request was refused.',
				rawHtml: '<script>window.reference="tel:1786144460"</script>'
			})
		).toMatchObject({ vendor: 'unknown', evidence: 'access denied', statusCode: 403 });
	});

	it('does not reclassify an article that discusses human verification', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'How CAPTCHA systems work',
				text:
					'This article explains why websites ask users to verify you are human. Email research@university.edu for details.'
			})
		).toBeNull();
	});

	it('does not mistake Cloudflare JS Detections on a readable page for a challenge', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'Hospital Board',
				text: 'Board members and meeting information. Email boardclerk@hospital.org.'.padEnd(
					3_000,
					'x'
				),
				rawHtml:
					'<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>'
			})
		).toBeNull();
	});

	it('keeps the bare Cloudflare JS path readable even with a challenge-like title', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'Just a moment...',
				text: 'Board minutes use “just a moment” as an agenda heading.'.padEnd(3_000, 'x'),
				rawHtml:
					'<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>'
			})
		).toBeNull();
	});

	it('requires a Cloudflare challenge title at HTTP 200', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'Cloudflare challenge-path advisory',
				text: 'This advisory documents deployment paths for edge security.'.padEnd(3_000, 'x'),
				rawHtml:
					'<code>/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1</code>'
			})
		).toBeNull();
	});

	it('uses visible contact content to veto the full HTTP-200 Cloudflare conjunction', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'Just a moment...',
				text:
					'Call the security office at (555) 010-1234. /cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1'
			})
		).toBeNull();
	});

	it('requires the Radware marker to be the captured captcha title', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'Bot management training',
				text: 'Radware Bot Manager Captcha'
			})
		).toBeNull();
	});

	it('does not inspect a strong marker beyond the 200,000-character scan ceiling', () => {
		const text = `${'x'.repeat(200_000)}/cdn-cgi/challenge-platform/h/g/orchestrate`;

		expect(classifyRetrievalBlock({ title: 'Just a moment...', text })).toBeNull();
	});

	it('does not mistake an ordinary Just a moment title for a Cloudflare challenge', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'Just a moment...',
				text: 'Just a moment... before the meeting begins, please review the agenda.'.padEnd(
					3_000,
					'x'
				)
			})
		).toBeNull();
	});

	it('does not mistake the DataDome client tag on a readable page for a block', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'City Council',
				text: 'Council agendas and minutes. Email council@city.gov.'.padEnd(3_000, 'x'),
				rawHtml: '<script src="https://js.datadome.co/tags.js"></script>'
			})
		).toBeNull();
	});

	it('does not mistake an institutional Incident ID reference for an Imperva block', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 200,
				title: 'Police Records',
				text:
					'Provide the Incident ID: 2024-01187 and email records@city.gov for a copy.'.padEnd(
						3_000,
						'x'
					)
			})
		).toBeNull();
	});

	it('still classifies a corroborated DataDome marker as blocked', () => {
		expect(
			classifyRetrievalBlock({
				statusCode: 403,
				title: 'Please wait',
				text: 'DataDome challenge'
			})
		).toMatchObject({ vendor: 'datadome', evidence: 'datadome', statusCode: 403 });
	});
});
