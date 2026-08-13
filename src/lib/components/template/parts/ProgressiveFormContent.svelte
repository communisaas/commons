<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { ArrowRight, ArrowLeft, User, MapPin, Send } from '@lucide/svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { coordinated, useTimerCleanup } from '$lib/utils/timerCoordinator';
	import { isCongressionalDelivery } from '$convex/lib/templateDeliveryMethod';

	let {
		template,
		user = null,
		_onclose,
		onsend
	}: {
		template: {
			id: string;
			title: string;
			description: string;
			slug: string;
			deliveryMethod: string;
			preview?: string;
		};
		user?: { id: string; name: string; address?: string } | null;
		_onclose?: () => void;
		onsend: (data: { name: string; address?: string; email?: string }) => void;
	} = $props();

	// Component ID for timer coordination
	const componentId = 'progressive-form-content-' + Math.random().toString(36).substring(2, 15);

	type Step = 'name' | 'address' | 'send';
	let currentStep: Step = $state('name');
	let isTransitioning = $state(false);

	// Form data — snapshot user prop at init (one-shot default values)
	let name = $state(untrack(() => user?.name || ''));
	let address = $state(untrack(() => user?.address || ''));
	let email = $state('');

	// Validation states
	let nameError = $state('');
	let addressError = $state('');
	let emailError = $state('');

	const isCongressional = $derived(isCongressionalDelivery(template.deliveryMethod));
	// Congressional delivery is the only lane that needs a street address; a
	// signed-out sender is the only one who still has to type an email.
	const requiresAddress = $derived(isCongressional);
	const requiresEmail = $derived(!user);

	// Determine the flow based on template type and user status
	const steps = $derived(getSteps());
	const currentStepIndex = $derived(steps.indexOf(currentStep));
	const isLastStep = $derived(currentStepIndex === steps.length - 1);

	function getSteps(): Step[] {
		if (user) {
			// Authenticated user
			if (user.address && isCongressional) {
				return ['send']; // Skip directly to send
			} else if (isCongressional) {
				return ['address', 'send']; // Need address for congressional
			} else {
				return ['send']; // Direct email, no address needed
			}
		} else {
			// Guest user
			if (isCongressional) {
				return ['name', 'address', 'send']; // Need name and address
			} else {
				return ['name', 'send']; // Only need name for direct email
			}
		}
	}

	function validateName(): boolean {
		nameError = '';
		if (!name.trim()) {
			nameError = 'Please enter your name';
			return false;
		}
		if (name.trim().length < 2) {
			nameError = 'Name must be at least 2 characters';
			return false;
		}
		return true;
	}

	function validateAddress(): boolean {
		addressError = '';
		if (!address.trim()) {
			addressError = 'Please enter your address';
			return false;
		}
		// Basic address validation - should contain street and city/state
		const addressParts = address.trim().split(',');
		if (addressParts.length < 2) {
			addressError = 'Please enter a complete address (street, city, state)';
			return false;
		}
		return true;
	}

	function validateEmail(): boolean {
		emailError = '';
		if (requiresEmail && !email.trim()) {
			emailError = 'Please enter your email';
			return false;
		}
		if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			emailError = 'Please enter a valid email address';
			return false;
		}
		return true;
	}

	function validateCurrentStep(): boolean {
		switch (currentStep) {
			case 'name':
				return validateName() && validateEmail();
			case 'address':
				return validateAddress();
			case 'send':
				return true; // Send step doesn't need validation
			default:
				return false;
		}
	}

	function nextStep() {
		if (!validateCurrentStep()) return;

		isTransitioning = true;

		coordinated.transition(
			() => {
				const nextIndex = currentStepIndex + 1;
				if (nextIndex < steps.length) {
					currentStep = steps[nextIndex];
				}
				isTransitioning = false;
			},
			200,
			componentId
		);
	}

	function prevStep() {
		isTransitioning = true;

		coordinated.transition(
			() => {
				const prevIndex = currentStepIndex - 1;
				if (prevIndex >= 0) {
					currentStep = steps[prevIndex];
				}
				isTransitioning = false;
			},
			200,
			componentId
		);
	}

	function handleSend() {
		if (!validateCurrentStep()) return;

		onsend({
			name: name.trim(),
			address: requiresAddress ? address.trim() : undefined,
			email: requiresEmail ? email.trim() : undefined
		});
	}

	// Initialize step based on user state
	$effect(() => {
		if (user?.address && isCongressional) {
			currentStep = 'send';
		} else if (user && !isCongressional) {
			currentStep = 'send';
		}
	});

	// Cleanup on destroy
	$effect(() => {
		return () => {
			useTimerCleanup(componentId)();
		};
	});
</script>

<div class="p-6">
	<!-- Progress Indicator -->
	<div class="-mt-2 flex justify-center pb-6">
		<div class="flex gap-2">
			{#each steps as _step, i}
				<div
					class="h-2 rounded-full transition-all duration-500 ease-out {currentStepIndex === i
						? 'w-12 bg-blue-600 shadow-lg shadow-blue-200'
						: currentStepIndex > i
							? 'w-8 bg-blue-300'
							: 'w-8 bg-slate-200'}"
				></div>
			{/each}
		</div>
	</div>

	<!-- Content -->
	<div class="relative min-h-[400px] overflow-hidden">
		{#key currentStep}
			<div
				class="absolute inset-0"
				in:fly={{ x: 20, duration: 400, delay: 300, easing: quintOut }}
				out:fly={{ x: -20, duration: 300, easing: quintOut }}
			>
				{#if currentStep === 'name'}
					<!-- Name Step -->
					<div class="mb-6 text-center">
						<div
							class="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-100"
						>
							<User class="h-6 w-6 text-blue-600" />
						</div>
						<h2 class="mb-2 text-xl font-bold text-slate-900">
							Quick setup to send
						</h2>
						<p class="text-slate-600">
							{`Your name makes this message yours, not generic`}
						</p>
					</div>

					<div class="mb-6 space-y-4">
						<div>
							<label for="name" class="mb-2 block text-sm font-medium text-slate-700">
								Full Name
							</label>
							<input
								id="name"
								type="text"
								bind:value={name}
								placeholder="Enter your full name"
								class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
							/>
							{#if nameError}
								<p class="mt-1 text-sm text-red-600">{nameError}</p>
							{/if}
						</div>

						{#if requiresEmail}
							<div>
								<label for="email" class="mb-2 block text-sm font-medium text-slate-700">
									Email Address
								</label>
								<input
									id="email"
									type="email"
									bind:value={email}
									placeholder="Enter your email address"
									class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
								/>
								{#if emailError}
									<p class="mt-1 text-sm text-red-600">{emailError}</p>
								{/if}
							</div>
						{/if}
					</div>
				{:else if currentStep === 'address'}
					<!-- Address Step -->
					<div class="mb-6 text-center">
						<div
							class="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-100"
						>
							<MapPin class="h-6 w-6 text-green-600" />
						</div>
						<h2 class="mb-2 text-xl font-bold text-slate-900">Which representatives get this?</h2>
						<p class="text-slate-600">
							Your address determines which offices see this - they only count messages from their
							district
						</p>
					</div>

					<div class="mb-6 space-y-4">
						<div>
							<label for="address" class="mb-2 block text-sm font-medium text-slate-700">
								Address
							</label>
							<textarea
								id="address"
								bind:value={address}
								placeholder="123 Main Street, City, State 12345"
								rows="3"
								class="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
							></textarea>
							{#if addressError}
								<p class="mt-1 text-sm text-red-600">{addressError}</p>
							{/if}
						</div>
					</div>
				{:else if currentStep === 'send'}
					<!-- Send Step -->
					<div class="mb-6 text-center">
						<div
							class="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-100"
						>
							<Send class="h-6 w-6 text-green-600" />
						</div>
						<h2 class="mb-2 text-xl font-bold text-slate-900">
							All set - this goes out now
						</h2>
						<p class="text-slate-600">
							{`"${template.title}" will be sent ${isCongressional ? 'to your representatives' : 'via email'}`}
						</p>
					</div>

					{#if template.preview}
						<div class="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
							<p class="text-sm text-slate-700">{template.preview}</p>
						</div>
					{/if}
				{/if}

				<!-- Navigation -->
				<div class="flex gap-3">
					{#if currentStepIndex > 0}
						<Button
							variant="secondary"
							size="sm"
							classNames="flex-1"
							onclick={prevStep}
							disabled={isTransitioning}
						>
							<ArrowLeft class="mr-1 h-4 w-4" />
							Back
						</Button>
					{/if}

					{#if isLastStep}
						<Button
							variant="primary"
							size="sm"
							classNames={currentStepIndex === 0 ? 'w-full' : 'flex-1'}
							onclick={handleSend}
							disabled={isTransitioning}
						>
							<Send class="mr-1 h-4 w-4" />
							Send Message
						</Button>
					{:else}
						<Button
							variant="primary"
							size="sm"
							classNames={currentStepIndex === 0 ? 'w-full' : 'flex-1'}
							onclick={nextStep}
							disabled={isTransitioning}
						>
							Continue
							<ArrowRight class="ml-1 h-4 w-4" />
						</Button>
					{/if}
				</div>
			</div>
		{/key}
	</div>
</div>
