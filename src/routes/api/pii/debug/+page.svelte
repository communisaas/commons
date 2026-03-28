<script lang="ts">
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';

	let log = $state<string[]>([]);

	function addLog(msg: string) {
		log = [...log, `${new Date().toISOString().slice(11,19)} ${msg}`];
	}

	onMount(async () => {
		const user = $page.data?.user as Record<string, unknown> | null;
		addLog(`user: ${user ? 'YES (id=' + user.id + ')' : 'NO'}`);

		const oauthSeed = user?.oauthPiiSeed as { email: string; name: string | null } | null;
		addLog(`oauthPiiSeed: ${oauthSeed ? JSON.stringify(oauthSeed) : 'NULL'}`);
		addLog(`encryptedEmail in data: ${user?.encryptedEmail ? 'PRESENT' : 'MISSING'}`);
		addLog(`encryptedName in data: ${user?.encryptedName ? 'PRESENT' : 'MISSING'}`);

		if (!oauthSeed?.email) {
			addLog('STOP: no seed email — $effect would exit here');
			return;
		}

		try {
			const { isClientPiiAvailable, encryptUserPiiClient } = await import('$lib/core/crypto/client-pii');
			addLog(`isClientPiiAvailable: ${isClientPiiAvailable()}`);

			if (!isClientPiiAvailable()) {
				addLog('STOP: client PII not available');
				return;
			}

			const userId = user!.id as string;
			addLog(`encrypting for userId: ${userId}`);

			const encrypted = await encryptUserPiiClient(oauthSeed.email, oauthSeed.name, userId);
			addLog(`encrypted email length: ${encrypted.encryptedEmail.length}`);
			addLog(`encrypted name: ${encrypted.encryptedName ? 'YES' : 'NULL'}`);

			addLog('POSTing to /api/pii/encrypt...');
			const res = await fetch('/api/pii/encrypt', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					encryptedEmail: encrypted.encryptedEmail,
					encryptedName: encrypted.encryptedName,
				}),
			});
			addLog(`POST result: ${res.status} ${res.statusText}`);
			const body = await res.text();
			addLog(`POST body: ${body}`);

			// Now try decrypting
			const { decryptUserPiiClient } = await import('$lib/core/crypto/client-pii');
			const decrypted = await decryptUserPiiClient(encrypted.encryptedEmail, encrypted.encryptedName, userId);
			addLog(`decrypted email: ${decrypted.email}`);
			addLog(`decrypted name: ${decrypted.name}`);
		} catch (err) {
			addLog(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
			addLog(`STACK: ${err instanceof Error ? err.stack?.split('\n').slice(0,3).join(' | ') : ''}`);
		}
	});
</script>

<h1>PII Debug</h1>
<pre style="font-size: 14px; line-height: 1.6; padding: 20px; background: #111; color: #0f0;">
{#each log as line}
{line}
{/each}
{#if log.length === 0}
Waiting...
{/if}
</pre>
