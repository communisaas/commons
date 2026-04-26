<script lang="ts">
	/**
	 * Footer: The Quiet Coda
	 *
	 * Perceptual Engineering: The footer is a spatial boundary, not content.
	 * It answers: "Who made this?" and "Can I contact them?"
	 * Everything else is cognitive surplus.
	 *
	 * Visual bookends: Hero opens with "commons", footer closes with it.
	 */
</script>

<footer class="footer-coda">
	<div class="footer-coda__inner">
		<!-- Brand closure: matches hero overture -->
		<p class="footer-coda__brand">commons</p>

		<!-- Contact row: individual + org surfaces -->
		<div class="footer-coda__links">
			<a href="mailto:hello@commons.email" class="footer-coda__contact">hello@commons.email</a>
			<span class="footer-coda__sep" aria-hidden="true"></span>
			<a href="/org" class="footer-coda__contact footer-coda__contact--org">For organizations</a>
		</div>

		<!-- Legal links (F-1.2: privacy disclosure must be discoverable from
		     every page; full /privacy and /terms routes pending F-4.4) -->
		<div class="footer-coda__links">
			<a href="/about/integrity#data-practices" class="footer-coda__contact">Privacy &amp; data</a>
			<span class="footer-coda__sep" aria-hidden="true"></span>
			<a href="/about/integrity" class="footer-coda__contact">Integrity</a>
		</div>

		<!-- Legal minimum -->
		<p class="footer-coda__legal">© {new Date().getFullYear()} Commons PBC</p>
	</div>
</footer>

<style>
	.footer-coda {
		margin-top: 4rem;
		padding: 3rem 1.5rem;
		border-top: 1px solid oklch(0.9 0.01 250 / 0.6);
	}

	.footer-coda__inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		max-width: 80rem;
		margin: 0 auto;
	}

	/*
	 * Brand whisper: echoes hero overture
	 *
	 * Same warm human tone, quieter presence.
	 * Visual bookend: opens with commons, closes with commons
	 * The warmth carries through - people at both ends.
	 */
	.footer-coda__brand {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem; /* 14px - quieter than hero, still present */
		font-weight: 600; /* Same confidence */
		letter-spacing: -0.015em; /* Same collective density */
		text-transform: lowercase;
		color: oklch(0.48 0.06 55); /* Same warm hue, lighter = coda whisper */
	}

	/* Links row */
	.footer-coda__links {
		display: flex;
		align-items: center;
		gap: 1.25rem;
	}

	/* Contact: simple, recognizable */
	.footer-coda__contact {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		color: oklch(0.45 0.02 250);
		text-decoration: none;
		transition: color 150ms ease-out;
	}

	.footer-coda__contact:hover {
		color: oklch(0.35 0.02 250);
	}

	.footer-coda__contact--org {
		color: oklch(0.5 0.04 180);
	}

	.footer-coda__contact--org:hover {
		color: oklch(0.38 0.08 180);
	}

	.footer-coda__sep {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: oklch(0.7 0.02 250);
		flex-shrink: 0;
	}

	/* Legal: minimal presence */
	.footer-coda__legal {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		color: oklch(0.6 0.01 250);
		margin-top: 0.5rem;
	}
</style>
