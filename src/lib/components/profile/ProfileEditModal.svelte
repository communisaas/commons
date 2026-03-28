<script lang="ts">
	import { X as _X, User, Building, Save, Loader2 } from '@lucide/svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import SimpleModal from '$lib/components/modals/SimpleModal.svelte';
	import { decryptedUser } from '$lib/stores/decryptedUser.svelte';
	import type { UserProfileData, ProfileUpdateData } from '$lib/types/any-replacements.js';

	// NOTE: 'address' section removed per CYPHERPUNK-ARCHITECTURE.md
	// PII (street, city, state, zip) is encrypted in EncryptedDeliveryData, not stored on User
	let {
		user,
		section = 'basic',
		onclose,
		onsave
	}: {
		user: UserProfileData;
		section?: 'basic' | 'profile';
		onclose?: () => void;
		onsave?: (data: ProfileUpdateData) => void;
	} = $props();

	let isSubmitting = $state(false);
	let errors = $state<Record<string, string>>({});

	// Form data based on section
	let formData = $state(getInitialFormData());

	function getInitialFormData() {
		switch (section) {
			case 'basic':
				return {
					name: decryptedUser.name || user.name || '',
					email: decryptedUser.email || user.email || ''
				};
			case 'profile':
				return {
					role: user.role || '',
					organization: user.organization || '',
					location: user.location || '',
					connection: user.connection || '',
					profile_visibility: user.profile_visibility || 'private'
				};
			default:
				return {};
		}
	}

	function handleClose() {
		onclose?.();
	}

	function validateForm(): boolean {
		errors = {};

		switch (section) {
			case 'basic':
				if (!formData.name?.trim()) {
					errors.name = 'Name is required';
				}
				if (!formData.email?.trim()) {
					errors.email = 'Email is required';
				} else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
					errors.email = 'Please enter a valid email address';
				}
				break;

			case 'profile':
				if (!formData.role?.trim()) {
					errors.role = 'Role is required';
				}
				if (!formData.connection?.trim()) {
					errors.connection = 'Connection to issues is required';
				}
				break;
		}

		return Object.keys(errors).length === 0;
	}

	async function handleSave() {
		if (!validateForm()) return;

		isSubmitting = true;

		try {
			// Call the profile API endpoint
			const endpoint = '/api/user/profile';
			const payload = { ...formData };

			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			const result = await response.json();

			if (result.success) {
				onsave?.({ section, data: formData });
				handleClose();
			} else {
				errors.general = result.error || 'Failed to save changes';
			}
		} catch {
			errors.general = 'Failed to save changes. Please try again.';
		} finally {
			isSubmitting = false;
		}
	}

	const sectionTitles = {
		basic: 'Basic Information',
		profile: 'Profile Details'
	};

	const sectionIcons = {
		basic: User,
		profile: Building
	};
</script>

<SimpleModal title={sectionTitles[section]} maxWidth="max-w-lg" onclose={handleClose}>
	<div class="p-6">
		<!-- Section Icon -->
		<div class="mb-6 flex items-center">
			{#snippet iconSnippet()}
				{@const IconComponent = sectionIcons[section]}
				<IconComponent class="mr-2 h-5 w-5 text-participation-primary-600" />
			{/snippet}
			{@render iconSnippet()}
			<h3 class="text-lg font-semibold text-slate-900">{sectionTitles[section]}</h3>
		</div>

		<!-- Error Display -->
		{#if errors.general}
			<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
				<p class="text-sm text-red-600">{errors.general}</p>
			</div>
		{/if}

		<!-- Form Fields -->
		<div class="space-y-4">
			{#if section === 'basic'}
				<div>
					<label for="name" class="mb-1 block text-sm font-medium text-slate-700"> Name * </label>
					<input
						id="name"
						type="text"
						bind:value={formData.name}
						class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-participation-primary-500 focus:ring-2 focus:ring-participation-primary-500 {errors.name
							? 'border-red-300'
							: ''}"
						placeholder="Enter your full name"
					/>
					{#if errors.name}
						<p class="mt-1 text-sm text-red-600">{errors.name}</p>
					{/if}
				</div>

				<div>
					<label for="email" class="mb-1 block text-sm font-medium text-slate-700"> Email * </label>
					<input
						id="email"
						type="email"
						bind:value={formData.email}
						class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-participation-primary-500 focus:ring-2 focus:ring-participation-primary-500 {errors.email
							? 'border-red-300'
							: ''}"
						placeholder="your@email.com"
					/>
					{#if errors.email}
						<p class="mt-1 text-sm text-red-600">{errors.email}</p>
					{/if}
				</div>

			{:else if section === 'profile'}
				<div>
					<label for="role" class="mb-1 block text-sm font-medium text-slate-700">
						Role/Profession *
					</label>
					<input
						id="role"
						type="text"
						bind:value={formData.role}
						class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-participation-primary-500 focus:ring-2 focus:ring-participation-primary-500 {errors.role
							? 'border-red-300'
							: ''}"
						placeholder="e.g., Teacher, Student, Parent, etc."
					/>
					{#if errors.role}
						<p class="mt-1 text-sm text-red-600">{errors.role}</p>
					{/if}
				</div>

				<div>
					<label for="organization" class="mb-1 block text-sm font-medium text-slate-700">
						Organization
					</label>
					<input
						id="organization"
						type="text"
						bind:value={formData.organization}
						class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-participation-primary-500 focus:ring-2 focus:ring-participation-primary-500"
						placeholder="Company, school, nonprofit, etc."
					/>
				</div>

				<div>
					<label for="location" class="mb-1 block text-sm font-medium text-slate-700">
						General Location
					</label>
					<input
						id="location"
						type="text"
						bind:value={formData.location}
						class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-participation-primary-500 focus:ring-2 focus:ring-participation-primary-500"
						placeholder="e.g., San Francisco Bay Area"
					/>
				</div>

				<div>
					<label for="connection" class="mb-1 block text-sm font-medium text-slate-700">
						Connection to Issues *
					</label>
					<select
						id="connection"
						bind:value={formData.connection}
						class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-participation-primary-500 focus:ring-2 focus:ring-participation-primary-500 {errors.connection
							? 'border-red-300'
							: ''}"
					>
						<option value="">Select your connection...</option>
						<option value="directly_affected">Directly affected by this issue</option>
						<option value="professional">Professional interest/expertise</option>
						<option value="community">Concerned resident</option>
						<option value="advocate">Long-time advocate</option>
						<option value="other">Other</option>
					</select>
					{#if errors.connection}
						<p class="mt-1 text-sm text-red-600">{errors.connection}</p>
					{/if}
				</div>

				<div>
					<label for="visibility" class="mb-1 block text-sm font-medium text-slate-700">
						Profile Visibility
					</label>
					<select
						id="visibility"
						bind:value={formData.profile_visibility}
						class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-participation-primary-500 focus:ring-2 focus:ring-participation-primary-500"
					>
						<option value="private">Private - Only visible to me</option>
						<option value="limited">Limited - Visible to template users</option>
						<option value="public">Public - Visible to everyone</option>
					</select>
				</div>
			{/if}
		</div>

		<!-- Form Actions -->
		<div class="mt-8 flex justify-end space-x-3 border-t border-slate-200 pt-6">
			<Button variant="secondary" onclick={handleClose} disabled={isSubmitting}>Cancel</Button>
			<Button variant="primary" onclick={handleSave} disabled={isSubmitting}>
				{#if isSubmitting}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Saving...
				{:else}
					<Save class="mr-2 h-4 w-4" />
					Save Changes
				{/if}
			</Button>
		</div>
	</div>
</SimpleModal>
