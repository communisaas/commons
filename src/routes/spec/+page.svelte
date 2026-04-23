<!--
  /spec — Commons Cryptographic Protocol Specification

  A URL you can drop in a DM. The spec page embodies the rigor it describes:
  every domain tag rendered is a real domain tag from the code; every
  hash value shown is the actual hex in the circuits; every claim cites
  its source. The page practices what the protocol preaches.

  Strong center: the cross-tree identity binding diagram — an invariant
  that prose would bury, made spatially obvious.

  Audience: cryptographers, security reviewers, independent implementers.
  Not marketing. Not journalism. A specification.
-->
<script lang="ts">
	import { Datum, Cite } from '$lib/design';
	import CrossTreeBinding from './CrossTreeBinding.svelte';
	import SpongeDiagram from './SpongeDiagram.svelte';
	import TagSpecimen, { type Slot } from './TagSpecimen.svelte';
	import TreeTopology from './TreeTopology.svelte';
	import TreeSpecimen from './TreeSpecimen.svelte';
	import CircuitSpecimen from './CircuitSpecimen.svelte';
	import CircuitPrimer from './CircuitPrimer.svelte';
	import ThreeTreeGraph from './ThreeTreeGraph.svelte';
	import BubbleGraph from './BubbleGraph.svelte';
	import DebateWeightGraph from './DebateWeightGraph.svelte';
	import PositionNoteGraph from './PositionNoteGraph.svelte';

	// Domain separation registry — seven tags, three functional clusters.
	// Each tag's layout shows its position in the 4-slot Poseidon2 state.
	const arityTags: Array<{
		name: string;
		hex: string;
		layout: Slot[] | null;
		layoutNote?: string;
		arity: string;
		use: string;
	}> = [
		{
			name: 'H1M',
			hex: '0x48314d',
			layout: [
				{ kind: 'input', label: 'x' },
				{ kind: 'tag', label: 'H1M' },
				{ kind: 'zero' },
				{ kind: 'zero' }
			],
			arity: '1',
			use: 'Single-input hash'
		},
		{
			name: 'H2M',
			hex: '0x48324d',
			layout: [
				{ kind: 'input', label: 'a' },
				{ kind: 'input', label: 'b' },
				{ kind: 'tag', label: 'H2M' },
				{ kind: 'zero' }
			],
			arity: '2',
			use: 'Merkle nodes, nullifier, cell-map leaf, engagement leaf'
		},
		{
			name: 'H3M',
			hex: '0x48334d',
			layout: [
				{ kind: 'input', label: 'a' },
				{ kind: 'input', label: 'b' },
				{ kind: 'input', label: 'c' },
				{ kind: 'tag', label: 'H3M' }
			],
			arity: '3',
			use: 'Engagement data commitment, debate note commitment'
		},
		{
			name: 'H4M',
			hex: '0x48344d',
			layout: null,
			layoutNote: '2-round sponge — state width exceeded, tag carried across permutations',
			arity: '4',
			use: 'User leaf: H4(user_secret, cell_id, registration_salt, authority_level)'
		}
	];

	const purposeTags: Array<{
		name: string;
		hex: string;
		layout: Slot[] | null;
		layoutNote?: string;
		arity: string;
		use: string;
	}> = [
		{
			name: 'PCM',
			hex: '0x50434d',
			layout: [
				{ kind: 'input', label: 'arg' },
				{ kind: 'input', label: 'wt' },
				{ kind: 'input', label: 'rand' },
				{ kind: 'tag', label: 'PCM' }
			],
			arity: '3',
			use: 'Debate position commitment'
		},
		{
			name: 'PNL',
			hex: '0x504e4c',
			layout: [
				{ kind: 'input', label: 'key' },
				{ kind: 'input', label: 'c' },
				{ kind: 'input', label: 'dbt' },
				{ kind: 'tag', label: 'PNL' }
			],
			arity: '3',
			use: 'Debate position nullifier'
		}
	];

	const capacityTags: Array<{
		name: string;
		hex: string;
		layout: Slot[] | null;
		layoutNote?: string;
		arity: string;
		use: string;
	}> = [
		{
			name: 'SONGE_$',
			hex: '0x534f4e47455f24',
			layout: [
				{ kind: 'tag', label: 'SONGE_$' },
				{ kind: 'zero' },
				{ kind: 'zero' },
				{ kind: 'zero' }
			],
			arity: '24',
			use: 'District commitment · sponge capacity seed · mnemonic SONGE_24'
		}
	];
</script>

<svelte:head>
	<title>Cryptographic Protocol Specification | Commons</title>
	<meta
		name="description"
		content="The canonical cryptographic specification for the Commons protocol. Circuit topology, Poseidon2 construction, domain separation, nullifier scheme, trusted setup, threat model."
	/>
</svelte:head>

<div class="spec-root">
	<!-- ================================================================ -->
	<!-- HERO — Strong center establishes what this document IS           -->
	<!-- ================================================================ -->
	<header class="hero">
		<p class="eyebrow">Specification · Version 1.0.0 · 2026-04-21</p>
		<h1 class="hero-title">Commons Cryptographic Protocol</h1>
		<p class="hero-lede">
			The full cryptographic construction of Commons. Every proof, hash, and domain separator an auditor needs to reproduce our claims.
		</p>

		<!--
			Zone ② — Pointer.  One spec line (what the system IS, compact) +
			one canonical source pointer (where the truth lives).  No framed grid.
		-->
		<div class="hero-pointer">
			<p class="hero-spec-line">
				UltraHonk over BN254
				<span class="hero-spec-sep" aria-hidden="true">·</span>
				Aztec Ignition SRS, 1-of-N honesty
				<span class="hero-spec-sep" aria-hidden="true">·</span>
				<Cite
					form="whisper"
					provenance={() => 'three-tree membership · position note · debate weight · bubble membership'}
				><Datum value={4} class="hero-spec-datum" /> live circuits</Cite>
			</p>
			<a
				class="hero-canonical"
				href="https://github.com/communisaas/voter-protocol/blob/main/specs/CRYPTOGRAPHY-SPEC.md"
			>
				<span class="hero-canonical-label">Canonical source</span>
				<span class="hero-canonical-path">
					<span class="hero-canonical-name">CRYPTOGRAPHY-SPEC.md</span><span class="hero-canonical-arrow" aria-hidden="true">↗</span>
				</span>
			</a>
		</div>

		<!--
			Zone ③ — Fork.  Two-column audience split, promoted to a first-class
			structural decision.  Hairline between, no containers.
		-->
		<div class="hero-fork">
			<a class="hero-fork-path" href="/org">
				<span class="hero-fork-title">For advocacy orgs &rarr;</span>
				<span class="hero-fork-note">Plain-English read of what the protocol proves.</span>
			</a>
			<a class="hero-fork-path" href="https://github.com/communisaas/voter-protocol/blob/main/specs/CRYPTOGRAPHY-SPEC.md">
				<span class="hero-fork-title">For cryptographers &rarr;</span>
				<span class="hero-fork-note">Circuit sources, formal specs, walkaway roadmap.</span>
			</a>
		</div>
	</header>

	<!-- ================================================================ -->
	<!-- TOC — scannable, anchor-addressable                               -->
	<!-- ================================================================ -->
	<nav class="toc" aria-label="Specification sections">
		<ol>
			<li><a href="#trust-stack"><span class="toc-title">Trust stack</span></a></li>
			<li><a href="#primitives"><span class="toc-title">Primitives</span></a></li>
			<li><a href="#domain-separation"><span class="toc-title">Domain separation</span></a></li>
			<li><a href="#data-structures"><span class="toc-title">Data structures</span></a></li>
			<li><a href="#binding"><span class="toc-title">Cross-tree binding</span></a></li>
			<li><a href="#circuits"><span class="toc-title">Circuits</span></a></li>
			<li><a href="#nullifier"><span class="toc-title">Nullifier scheme</span></a></li>
			<li><a href="#trusted-setup"><span class="toc-title">Trusted setup</span></a></li>
			<li><a href="#limitations"><span class="toc-title">Known limitations</span></a></li>
		</ol>
	</nav>

	<!-- ================================================================ -->
	<!-- 1. TRUST STACK                                                    -->
	<!-- ================================================================ -->
	<section id="trust-stack" class="section">
		<div class="section-head">
			<span class="section-num">01</span>
			<h2>Trust stack</h2>
		</div>
		<p class="section-lede">
			Four layers. The integrity ceiling is set by the weakest.
		</p>

		<ol class="stack">
			<li class="stack-layer">
				<div class="stack-header">
					<span class="stack-index">L4</span>
					<span class="stack-name">ZK Proof Verification</span>
					<span class="stack-quality q-trustless">trustless</span>
				</div>
				<p>
					UltraHonk on BN254 provides computational soundness under the algebraic group model and the hardness of discrete log on BN254. If a proof verifies, the prover demonstrably knows a witness satisfying every circuit constraint. No off-chain component is trusted.
				</p>
			</li>
			<li class="stack-layer">
				<div class="stack-header">
					<span class="stack-index">L3</span>
					<span class="stack-name">Root Registries</span>
					<span class="stack-quality q-observable">observable</span>
				</div>
				<p>
					Three immutable append-only registries on Scroll L2. Lifecycle transitions require 7-day timelocks; verifier upgrades require 14 days. The guarantee is transparency with exit rights &mdash; malicious governance action is visible on-chain before execution.
				</p>
			</li>
			<li class="stack-layer">
				<div class="stack-header">
					<span class="stack-index">L2</span>
					<span class="stack-name">Tree Construction</span>
					<span class="stack-quality q-trusted">trusted</span>
				</div>
				<p>
					The Shadow Atlas operator downloads public Census TIGER data and builds Poseidon2 Merkle trees. The operator <em>cannot forge proofs</em> (user secrets are client-side only) but <em>can poison the tree</em> (mis-map an address) or <em>censor</em> (omit a user). Mitigations documented; walkaway roadmap published.
				</p>
			</li>
			<li class="stack-layer">
				<div class="stack-header">
					<span class="stack-index">L1</span>
					<span class="stack-name">Data Acquisition</span>
					<span class="stack-quality q-verifiable">verifiable</span>
				</div>
				<p>
					Census TIGER/Line boundary data is public, free, and published with SHA-256 checksums. Anyone can download the same shapefiles and verify them. The trust assumption is that the Census Bureau publishes accurate boundaries.
				</p>
			</li>
		</ol>
	</section>

	<!-- ================================================================ -->
	<!-- 2. PRIMITIVES — three nested layers                               -->
	<!-- ================================================================ -->
	<section id="primitives" class="section">
		<div class="section-head">
			<span class="section-num">02</span>
			<h2>Primitives</h2>
		</div>
		<p class="section-lede">
			Three primitives, nested. A prime field; a hash that operates on it; a sponge that chains the hash.
		</p>

		<div class="primitives-stack">
			<!-- ─── LAYER I — FIELD ─── -->
			<article class="prim">
				<p class="prim-eyebrow">Field</p>
				<h3 class="prim-name">BN254 scalar</h3>

				<div class="field-scale">
					<div class="scale-block">
						<span class="scale-value">p &asymp; 2.188 &times; 10<sup>76</sup></span>
						<span class="scale-note">order of magnitude</span>
					</div>
					<div class="scale-block">
						<span class="scale-value">254</span>
						<span class="scale-note">bits</span>
					</div>
				</div>

				<p class="modulus-label">p =</p>
				<code class="modulus">
					21888242871839275222246405745257275088548364400416034343698204186575808495617
				</code>

				<p class="prim-note">
					All field elements are members of F<sub>p</sub>. Every external input is validated &lt; p before circuit execution.
				</p>
			</article>

			<!-- ─── LAYER II — HASH — strong center is the gate comparison ─── -->
			<article class="prim">
				<p class="prim-eyebrow">Hash, over F<sub>p</sub></p>
				<h3 class="prim-name">Poseidon2</h3>

				<figure class="gate-compare">
					<figcaption class="gate-caption">In-circuit constraint cost per hash</figcaption>
					<div class="gate-row gate-poseidon">
						<span class="gate-label">Poseidon2</span>
						<span class="gate-bar"><span class="gate-fill" style="width: 0.64%;"></span></span>
						<span class="gate-value">~160</span>
					</div>
					<div class="gate-row gate-sha">
						<span class="gate-label">SHA-256</span>
						<span class="gate-bar"><span class="gate-fill" style="width: 100%;"></span></span>
						<span class="gate-value">~25,000</span>
					</div>
					<p class="gate-verdict">
						<span class="ratio">~156&times;</span> cheaper in-circuit. Field-native; no bit decomposition.
					</p>
				</figure>

				<dl class="hash-params">
					<div><dt>t</dt><dd>4</dd></div>
					<div><dt>rate</dt><dd>3</dd></div>
					<div><dt>capacity</dt><dd>1</dd></div>
					<div><dt>R<sub>F</sub></dt><dd>8</dd></div>
					<div><dt>R<sub>P</sub></dt><dd>56</dd></div>
				</dl>

				<p class="prim-note">
					Security level 128. Implementation: Noir stdlib. Parameters match the reference Aztec / ZCash specification.
				</p>
			</article>

			<!-- ─── LAYER III — SPONGE — the += made spatial ─── -->
			<article class="prim">
				<p class="prim-eyebrow">Sponge, over Poseidon2</p>
				<h3 class="prim-name">24-input absorption</h3>

				<SpongeDiagram />

				<p class="prim-note">
					The <code class="op-emph">+=</code> is load-bearing. Overwriting rate slots would break the cryptographic chain &mdash; each permutation output must carry forward into the next absorb step. A cross-language golden-vector check runs in CI: Noir, TypeScript, and Rust implementations must produce bit-identical digests.
				</p>
			</article>
		</div>
	</section>

	<!-- ================================================================ -->
	<!-- 3. DOMAIN SEPARATION — typological registry, three clusters      -->
	<!-- ================================================================ -->
	<section id="domain-separation" class="section">
		<div class="section-head">
			<span class="section-num">03</span>
			<h2>Domain separation</h2>
		</div>
		<p class="section-lede">
			Every hash output carries a tag at a fixed position in the Poseidon2 state. Seven tags define the protocol&rsquo;s typology. No tag can change without invalidating all historical proofs.
		</p>

		<div class="tag-registry">
			<!-- ─── Cluster 1: Arity separation ─── -->
			<div class="cluster">
				<header class="cluster-head">
					<p class="cluster-eyebrow">Arity separation</p>
					<p class="cluster-desc">
						One tag per input count. The tag&rsquo;s position shifts right as arity grows &mdash; visible across the cluster.
					</p>
				</header>
				<div class="specimens">
					{#each arityTags as tag}
						<TagSpecimen {...tag} />
					{/each}
				</div>
			</div>

			<!-- ─── Cluster 2: Purpose separation ─── -->
			<div class="cluster">
				<header class="cluster-head">
					<p class="cluster-eyebrow">Purpose separation</p>
					<p class="cluster-desc">
						Same arity, different semantic domain. <code>PCM</code> and <code>PNL</code> both consume three inputs into the final slot; distinct tag values prevent cross-purpose collisions.
					</p>
				</header>
				<div class="specimens">
					{#each purposeTags as tag}
						<TagSpecimen {...tag} />
					{/each}
				</div>
			</div>

			<!-- ─── Cluster 3: Capacity initialization ─── -->
			<div class="cluster">
				<header class="cluster-head">
					<p class="cluster-eyebrow">Capacity initialization</p>
					<p class="cluster-desc">
						Tag seeds the capacity slot, making the entire sponge computation depend on the domain from its first permutation.
					</p>
				</header>
				<div class="specimens">
					{#each capacityTags as tag}
						<TagSpecimen {...tag} />
					{/each}
				</div>
			</div>
		</div>

		<!-- Attestation — the consummation of the arc. Separation is a claim;
		     this is the enforcement. -->
		<aside class="attestation">
			<div class="attest-head">
				<span class="attest-mark">v1.0 &middot; locked</span>
				<span class="attest-sep" aria-hidden="true"></span>
				<span class="attest-label">Non-collision enforced</span>
			</div>
			<p class="attest-body">
				The five domain tags (<code>DOMAIN_HASH1..4</code>, <code>DOMAIN_SPONGE_24</code>) are asserted distinct at the constant level in <a href="https://github.com/communisaas/voter-protocol/blob/main/packages/crypto/test/golden-vectors.test.ts"><code>packages/crypto/test/golden-vectors.test.ts</code></a>; combined with Poseidon2 collision-resistance, distinct tags yield distinct outputs for arbitrary inputs. The test runs on every CI build.
			</p>
		</aside>
	</section>

	<!-- ================================================================ -->
	<!-- 4. DATA STRUCTURES — topology + two kinship clusters             -->
	<!-- ================================================================ -->
	<section id="data-structures" class="section">
		<div class="section-head">
			<span class="section-num">04</span>
			<h2>Data structures</h2>
		</div>
		<p class="section-lede">
			Four Merkle trees carry the protocol state. Three persistent trees link through shared witnesses; one is debate-scoped and cryptographically isolated.
		</p>

		<TreeTopology />

		<div class="tree-clusters">
			<!-- ─── Core: persistent, linked ─── -->
			<div class="cluster">
				<header class="cluster-head">
					<p class="cluster-eyebrow">Core &middot; persistent, linked</p>
				</header>
				<div class="specimens">
					<TreeSpecimen
						name="Tree 1 — Identity"
						construction="binary Merkle"
						leaf="H4(user_secret, cell_id, registration_salt, authority_level)"
						depth="18 / 20 / 22 / 24"
						depthNote="scales with population tier"
						node="H2(left, right)"
						lifecycle="stable — user re-registers only on physical move"
						crossTree={`<code>cell_id</code> binds to Tree 2; <code>user_secret</code> derives the <code>identity_commitment</code> that feeds Tree 3 and the nullifier (§5). <code>authority_level</code> bound in leaf (BR5-001).`}
					/>

					<TreeSpecimen
						name="Tree 2 — Cell→Districts"
						construction="sparse Merkle, key-derived"
						leaf="H2(cell_id, district_commitment)"
						depth="20"
						node="H2(left, right)"
						lifecycle="dynamic — redistricts on cycle; Tree 1 identities unaffected"
						crossTree={`<code>cell_id</code> is the join key with Tree 1. Sparse path means proof size is logarithmic in occupied keys, not in depth.`}
					/>

					<TreeSpecimen
						name="Tree 3 — Engagement"
						construction="binary Merkle"
						leaf="H2(ic, H3(tier, action_count, diversity_score))"
						depth="20"
						node="H2(left, right)"
						lifecycle="append-only — updated per verified civic action"
						crossTree={`<code>ic</code> is the same private <code>identity_commitment</code> that feeds the nullifier. The cross-tree binding in §5 enforces that no engagement leaf can be claimed by a foreign identity.`}
					/>
				</div>
			</div>

			<!-- ─── Debate-scoped: ephemeral, isolated ─── -->
			<div class="cluster">
				<header class="cluster-head">
					<p class="cluster-eyebrow">Debate-scoped &middot; ephemeral</p>
				</header>
				<div class="specimens">
					<TreeSpecimen
						name="Position Tree"
						construction="binary Merkle"
						leaf="H_PCM(argument_index, weighted_amount, randomness)"
						depth="20"
						node="H2(left, right)"
						lifecycle="per debate — pruned on settle"
						crossTree={`Leaf uses the <code>PCM</code> domain tag (§3), not <code>H3M</code> — preventing cross-circuit commitment aliasing with engagement data. Consumed by <code>position_note</code> circuit (§6).`}
					/>
				</div>
			</div>
		</div>
	</section>

	<!-- ================================================================ -->
	<!-- 5. CROSS-TREE BINDING — the strong center                         -->
	<!-- ================================================================ -->
	<section id="binding" class="section section-centered">
		<div class="section-head">
			<span class="section-num">05</span>
			<h2>Cross-tree identity binding</h2>
		</div>
		<p class="section-lede center">
			A single private input feeds two derivations.
		</p>

		<CrossTreeBinding />

		<div class="binding-properties">
			<div class="property">
				<p class="prop-label">Zero-knowledge</p>
				<p class="prop-body">
					The proof reveals none of <code>ic</code>. An observer sees <code>nullifier</code> and <code>engagement_leaf</code>, both one-way derived. Recovering <code>ic</code> reduces to breaking the discrete-log assumption on BN254.
				</p>
			</div>
			<div class="property">
				<p class="prop-label">Equality assertion</p>
				<p class="prop-body">
					The circuit asserts the <code>ic</code> consumed by the nullifier derivation equals the <code>ic</code> consumed by the leaf derivation. Rotating between them fails at witness generation &mdash; no satisfying proof exists.
				</p>
			</div>
		</div>

		<p class="binding-verdict">
			Attacker cannot extract <code>ic</code>, and cannot substitute a different one. Engagement data cannot be claimed by a foreign identity.
		</p>
	</section>

	<!-- ================================================================ -->
	<!-- 6. CIRCUITS — two clusters, four signature-forward specimens     -->
	<!-- ================================================================ -->
	<section id="circuits" class="section">
		<div class="section-head">
			<span class="section-num">06</span>
			<h2>Circuits</h2>
		</div>
		<CircuitPrimer />

		<div class="circuit-clusters">
			<!-- ─── Civic action cluster ─── -->
			<div class="cluster">
				<header class="cluster-head">
					<p class="cluster-eyebrow">Civic action</p>
				</header>
				<div class="specimens">
					<CircuitSpecimen
						name="three_tree_membership"
						subtitle="identity ⟶ action"
						claim="I'm a verified person in one of these 24 districts, at engagement tier ≥ N, and this is my one action."
						hidden={['identity witnesses', 'exact H3 cell', 'action history']}
						visible={['24-district set', 'tier threshold', 'one-time action receipt', 'authority']}
						depth="18 / 20 / 22 / 24"
						source="packages/crypto/noir/three_tree_membership/src/main.nr"
						relates="Sibling: <code>bubble_membership</code> reuses the same identity binding."
					>
						<ThreeTreeGraph />
					</CircuitSpecimen>

					<CircuitSpecimen
						name="bubble_membership"
						subtitle="identity ⟶ community field"
						claim="I'm a verified person who lives in these specific map cells."
						hidden={['identity', 'individual cell IDs', 'engagement details']}
						visible={['cell_set_root', 'cell_count', 'epoch_nullifier']}
						depth="20 · 4"
						source="packages/crypto/noir/bubble_membership/src/main.nr"
						relates="Shares identity binding with <code>three_tree_membership</code>."
					>
						<BubbleGraph />
					</CircuitSpecimen>
				</div>
			</div>

			<!-- ─── Debate market cluster ─── -->
			<div class="cluster">
				<header class="cluster-head">
					<p class="cluster-eyebrow">Debate market</p>
				</header>
				<div class="specimens">
					<CircuitSpecimen
						name="debate_weight"
						subtitle="stake ⟶ weight"
						claim="My influence is √stake × 2^tier — without revealing stake or tier."
						hidden={['stake', 'tier', 'randomness']}
						visible={['weighted_amount', 'note_commitment']}
						source="packages/crypto/noir/debate_weight/src/main.nr"
						relates="<code>note_commitment</code> becomes a leaf in the position tree, consumed by <code>position_note</code>."
					>
						<DebateWeightGraph />
					</CircuitSpecimen>

					<CircuitSpecimen
						name="position_note"
						subtitle="commitment ⟶ settlement"
						claim="I own a position in the winning argument and I'm claiming its payout."
						hidden={['which position', 'stake', 'tier', 'randomness', 'identity']}
						visible={['position_root', 'nullifier', 'debate_id', 'winning argument', 'payout']}
						depth="20"
						gates="~1,350"
						source="packages/crypto/noir/position_note/src/main.nr"
						relates="Reads the position tree built from <code>debate_weight</code>'s commitments."
					>
						<PositionNoteGraph />
					</CircuitSpecimen>
				</div>
			</div>
		</div>
	</section>

	<!-- ================================================================ -->
	<!-- 7. NULLIFIER SCHEME — Sybil fix: user_secret → identity_commitment -->
	<!-- ================================================================ -->
	<section id="nullifier" class="section">
		<div class="section-head">
			<span class="section-num">07</span>
			<h2>Nullifier scheme</h2>
		</div>

		<p class="nul-lede">
			A natural first cut: hash a per-registration secret and call it a nullifier. But nothing binds that secret to a person — <strong>register again with a new secret, the hash changes, one person gets two nullifiers for the same action.</strong> Binding the nullifier to a verified identity instead closes the attack before it opens.
		</p>

		<!-- ── Attack: two lanes diverge into two nullifiers ─────────────── -->
		<figure class="nul-scene nul-scene-attack">
			<figcaption class="nul-scene-caption">
				<span class="nul-scene-label nul-scene-label-bad">Naïve · Sybil via re-registration</span>
				<span class="nul-scene-claim">one person, two keys → <em>two</em> nullifiers for the same action</span>
			</figcaption>

			<svg class="nul-svg" viewBox="0 0 680 300" xmlns="http://www.w3.org/2000/svg"
				aria-hidden="true" preserveAspectRatio="xMidYMid meet">
				<!-- Header strip: zones -->
				<text class="nul-zone" x="80" y="16" text-anchor="middle">same person</text>
				<text class="nul-zone" x="300" y="16" text-anchor="middle">two registrations (key rotation)</text>
				<text class="nul-zone" x="560" y="16" text-anchor="middle">two nullifiers</text>

				<!-- Person anchor: teal box -->
				<rect class="g-shared" x="20" y="128" width="120" height="44" rx="3" />
				<text class="g-label-ic" x="80" y="147" text-anchor="middle">verified</text>
				<text class="g-label-ic" x="80" y="162" text-anchor="middle">person</text>

				<!-- Fork paths: person → upper and lower lanes -->
				<path class="nul-fork" d="M 140 140 Q 170 140 190 85" fill="none" />
				<path class="nul-fork" d="M 140 160 Q 170 160 190 215" fill="none" />

				<!-- ── Top lane (registration A) ── -->
				<rect class="g-witness" x="190" y="60" width="120" height="24" rx="3" />
				<text class="g-label" x="250" y="77" text-anchor="middle">user_secret_A</text>
				<rect class="g-witness" x="316" y="60" width="76" height="24" rx="3" />
				<text class="g-label" x="354" y="77" text-anchor="middle">salt_A</text>
				<path class="g-arrow" d="M 392 72 L 440 72" fill="none" marker-end="url(#nul-arrow-old)" />

				<!-- Top H2 -->
				<rect class="g-op" x="446" y="58" width="54" height="28" rx="14" />
				<text class="g-op-label" x="473" y="76" text-anchor="middle">H2</text>

				<!-- Top output: nullifier_A (distinct peg) -->
				<path class="g-arrow" d="M 500 72 L 532 72" fill="none" marker-end="url(#nul-arrow-old)" />
				<rect class="nul-peg-bad" x="532" y="58" width="132" height="28" rx="3" />
				<text class="nul-peg-bad-label" x="598" y="76" text-anchor="middle">nullifier_A</text>

				<!-- ── Bottom lane (registration B) ── -->
				<rect class="g-witness" x="190" y="215" width="120" height="24" rx="3" />
				<text class="g-label" x="250" y="232" text-anchor="middle">user_secret_B</text>
				<rect class="g-witness" x="316" y="215" width="76" height="24" rx="3" />
				<text class="g-label" x="354" y="232" text-anchor="middle">salt_B</text>
				<path class="g-arrow" d="M 392 227 L 440 227" fill="none" marker-end="url(#nul-arrow-old)" />

				<!-- Bottom H2 -->
				<rect class="g-op" x="446" y="213" width="54" height="28" rx="14" />
				<text class="g-op-label" x="473" y="231" text-anchor="middle">H2</text>

				<!-- Bottom output: nullifier_B (distinct peg) -->
				<path class="g-arrow" d="M 500 227 L 532 227" fill="none" marker-end="url(#nul-arrow-old)" />
				<rect class="nul-peg-bad" x="532" y="213" width="132" height="28" rx="3" />
				<text class="nul-peg-bad-label" x="598" y="231" text-anchor="middle">nullifier_B</text>

				<!-- Shared action_domain in the middle, feeds both H2 ops -->
				<rect class="g-public" x="368" y="138" width="160" height="26" rx="3" />
				<text class="g-label-public" x="448" y="156" text-anchor="middle">action_domain</text>
				<path class="g-arrow" d="M 448 138 Q 448 110 473 86" fill="none" />
				<path class="g-arrow" d="M 448 164 Q 448 190 473 213" fill="none" />

				<!-- Divergence annotation: bracket on right showing the two outputs are different -->
				<path class="nul-bracket-bad" d="M 672 72 L 678 72 L 678 227 L 672 227" fill="none" />
				<text class="nul-annot-bad" x="680" y="154" text-anchor="start">≠</text>

				<defs>
					<marker id="nul-arrow-old" viewBox="0 0 10 10" refX="9" refY="5"
						markerWidth="6" markerHeight="6" orient="auto">
						<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-tertiary)" />
					</marker>
				</defs>
			</svg>

			<p class="nul-scene-note">
				<code>user_secret</code> varies with each registration. Two secrets → two hash outputs → two valid nullifiers for the same <code>action_domain</code>. The attacker casts two votes as one person.
			</p>
		</figure>

		<!-- ── Fix: two lanes converge through identity_commitment ───────── -->
		<figure class="nul-scene nul-scene-fix">
			<figcaption class="nul-scene-caption">
				<span class="nul-scene-label nul-scene-label-good">Adopted · anchored to identity</span>
				<span class="nul-scene-claim">one person, any keys → <em>one</em> nullifier per action</span>
			</figcaption>

			<svg class="nul-svg" viewBox="0 0 680 340" xmlns="http://www.w3.org/2000/svg"
				aria-hidden="true" preserveAspectRatio="xMidYMid meet">
				<text class="nul-zone" x="80" y="16" text-anchor="middle">same person</text>
				<text class="nul-zone" x="260" y="16" text-anchor="middle">two registrations</text>
				<text class="nul-zone" x="450" y="16" text-anchor="middle">converge on identity</text>
				<text class="nul-zone" x="614" y="16" text-anchor="middle">one nullifier</text>

				<!-- Person anchor -->
				<rect class="g-shared" x="20" y="128" width="120" height="44" rx="3" />
				<text class="g-label-ic" x="80" y="147" text-anchor="middle">verified</text>
				<text class="g-label-ic" x="80" y="162" text-anchor="middle">person</text>

				<!-- Fork to two lanes -->
				<path class="nul-fork" d="M 140 140 Q 170 140 190 85" fill="none" />
				<path class="nul-fork" d="M 140 160 Q 170 160 190 215" fill="none" />

				<!-- ── Top lane: mDL_A → H_id ── -->
				<rect class="g-witness" x="190" y="60" width="90" height="24" rx="3" />
				<text class="g-label" x="235" y="77" text-anchor="middle">mDL</text>
				<text class="g-label-tag" x="235" y="97" text-anchor="middle">reg A · signed by issuer</text>
				<path class="g-arrow" d="M 280 72 L 316 72" fill="none" marker-end="url(#nul-arrow-new)" />

				<rect class="g-op" x="322" y="58" width="64" height="28" rx="14" />
				<text class="g-op-label" x="354" y="76" text-anchor="middle">H_id</text>

				<!-- ── Bottom lane: mDL_B → H_id ── -->
				<rect class="g-witness" x="190" y="215" width="90" height="24" rx="3" />
				<text class="g-label" x="235" y="232" text-anchor="middle">mDL</text>
				<text class="g-label-tag" x="235" y="252" text-anchor="middle">reg B · signed by issuer</text>
				<path class="g-arrow" d="M 280 227 L 316 227" fill="none" marker-end="url(#nul-arrow-new)" />

				<rect class="g-op" x="322" y="213" width="64" height="28" rx="14" />
				<text class="g-op-label" x="354" y="231" text-anchor="middle">H_id</text>

				<!-- Both H_id outputs converge on the SAME identity_commitment peg -->
				<path class="g-arrow-ic" d="M 386 72 Q 410 72 430 135" fill="none" />
				<path class="g-arrow-ic" d="M 386 227 Q 410 227 430 165" fill="none" />

				<!-- Convergence peg: identity_commitment -->
				<rect class="g-shared" x="430" y="130" width="130" height="40" rx="3" />
				<text class="g-label-ic" x="495" y="148" text-anchor="middle">identity_</text>
				<text class="g-label-ic" x="495" y="162" text-anchor="middle">commitment</text>

				<!-- Caption below ic peg reinforces the point -->
				<text class="g-label-tag" x="495" y="188" text-anchor="middle">SAME in both lanes</text>

				<!-- ic → H2 horizontal -->
				<path class="g-arrow-ic" d="M 560 150 L 605 150" fill="none" />

				<!-- H2 operator -->
				<rect class="g-op" x="608" y="136" width="48" height="28" rx="14" />
				<text class="g-op-label" x="632" y="154" text-anchor="middle">H2</text>

				<!-- action_domain on bottom row, feeds up into H2 -->
				<rect class="g-public" x="260" y="295" width="160" height="26" rx="3" />
				<text class="g-label-public" x="340" y="313" text-anchor="middle">action_domain</text>
				<text class="g-label-tag" x="340" y="285" text-anchor="middle">contract-fixed · same across lanes</text>
				<!-- arrow: action_domain up (avoiding the nullifier peg) then into H2 bottom -->
				<path class="g-arrow" d="M 420 308 Q 420 200 605 155" fill="none" marker-end="url(#nul-arrow-new)" />

				<!-- H2 → single nullifier peg (down) -->
				<line class="g-closure" x1="632" y1="164" x2="632" y2="202" />
				<text class="g-equiv" x="632" y="190" text-anchor="middle">≡</text>
				<rect class="g-closure-peg" x="556" y="206" width="116" height="28" rx="3" />
				<text class="g-label-closure" x="614" y="224" text-anchor="middle">nullifier</text>

				<defs>
					<marker id="nul-arrow-new" viewBox="0 0 10 10" refX="9" refY="5"
						markerWidth="6" markerHeight="6" orient="auto">
						<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-tertiary)" />
					</marker>
				</defs>
			</svg>

			<p class="nul-scene-note">
				<code>H_id</code> is deterministic on the mDL's stable fields. Same person, same <code>identity_commitment</code> — regardless of <code>user_secret</code>, <code>registration_salt</code>, or <code>cell_id</code>. Feeding it into <code>H2</code> with a contract-fixed <code>action_domain</code> collapses all re-registrations onto the same output.
			</p>
		</figure>

		<!-- ── Formal diff: the equation before and after ─────────────── -->
		<div class="evo nul-evo">
			<p class="evo-header">Formal statement</p>
			<div class="evo-row evo-old">
				<span class="evo-label">naïve</span>
				<code class="evo-expr">nullifier = H2(<span class="evo-varying">user_secret</span>, action_domain)</code>
				<span class="evo-verdict">Sybil via re-registration</span>
			</div>
			<div class="evo-arrow" aria-hidden="true">
				<span class="evo-arrow-label">identity-bound</span>
			</div>
			<div class="evo-row evo-new">
				<span class="evo-label">adopted</span>
				<code class="evo-expr">nullifier = H2(<span class="evo-stable">identity_commitment</span>, action_domain)</code>
				<span class="evo-verdict">deterministic per verified person</span>
			</div>
		</div>

		<!-- ── Property card: the two inputs, side by side ─────────────── -->
		<dl class="nul-card">
			<div class="nul-card-col">
				<dt class="nul-card-head">
					<code>identity_commitment</code>
					<span class="nul-card-tag nul-card-tag-private">private</span>
				</dt>
				<dd class="nul-card-row">
					<span class="nul-card-key">derivation</span>
					<span class="nul-card-val"><code>H_id(mDL signed fields)</code></span>
				</dd>
				<dd class="nul-card-row">
					<span class="nul-card-key">invariance</span>
					<span class="nul-card-val">stable across <code>user_secret</code>, <code>registration_salt</code>, <code>cell_id</code></span>
				</dd>
				<dd class="nul-card-row">
					<span class="nul-card-key">trust anchor</span>
					<span class="nul-card-val">mDL issuer signature (state DMV)</span>
				</dd>
			</div>
			<div class="nul-card-col">
				<dt class="nul-card-head">
					<code>action_domain</code>
					<span class="nul-card-tag nul-card-tag-public">public</span>
				</dt>
				<dd class="nul-card-row">
					<span class="nul-card-key">derivation</span>
					<span class="nul-card-val"><code>keccak256(protocol, country, jurisdictionType, recipientSubdivision, templateId, sessionId)</code> mod BN254</span>
				</dd>
				<dd class="nul-card-row">
					<span class="nul-card-key">invariance</span>
					<span class="nul-card-val">one nullifier per (user, recipient, template, legislative session)</span>
				</dd>
				<dd class="nul-card-row">
					<span class="nul-card-key">trust anchor</span>
					<span class="nul-card-val"><code>DistrictGate.allowedActionDomains</code> — governance-whitelisted</span>
				</dd>
			</div>
		</dl>
	</section>

	<!-- ================================================================ -->
	<!-- 8. TRUSTED SETUP                                                  -->
	<!-- ================================================================ -->
	<section id="trusted-setup" class="section">
		<div class="section-head">
			<span class="section-num">08</span>
			<h2>Trusted setup</h2>
		</div>

		<p class="srs-lede">
			The protocol's zero-knowledge machinery rests on a public reference string. If the party who generated it kept a secret, every proof could be forged. Here's how that didn't happen.
		</p>

		<!-- The 1-of-N wall: 176 dots, one highlighted teal.
		     Aztec Ignition 2020: 176 participants, BN254, 100.8M SRS points.
		     Each dot is one participant — a resolvable, real number, not a crowd-wash. -->
		<figure class="srs-wall">
			<figcaption class="srs-wall-caption srs-wall-caption-top">
				<span class="srs-wall-count"><Datum value={176} class="srs-wall-count-num" /></span>
				<span class="srs-wall-desc">participants · Aztec Ignition ceremony, Jan 2020 · each added randomness, each destroyed their copy</span>
			</figcaption>

			<svg class="srs-wall-svg" viewBox="0 0 680 210" xmlns="http://www.w3.org/2000/svg"
				aria-label="176 dots representing each individual participant in the Aztec Ignition ceremony, with one highlighted to show that a single honest participant is sufficient for security"
				preserveAspectRatio="xMidYMid meet">
				<!-- Grid of 176 dots (22 × 8 = 176). Each dot is ONE participant — not
				     an abstraction. Larger dot size (14px) reflects the honest count. -->
				{#each Array.from({ length: 176 }, (_, i) => i) as i (i)}
					<rect
						x={186 + (i % 22) * 14}
						y={18 + Math.floor(i / 22) * 14}
						width="10" height="10" rx="1.5"
						class={i === 94 ? 'srs-dot-honest' : 'srs-dot'}
					/>
				{/each}

				<!-- Highlight ring around the honest dot (col 6, row 4) -->
				<!-- center: x = 186 + 6*14 + 5 = 275, y = 18 + 4*14 + 5 = 79 -->
				<circle cx="275" cy="79" r="13" class="srs-dot-ring" />

				<!-- Callout below the grid, arrow curving up to the honest dot -->
				<text class="srs-callout-text" x="150" y="180" text-anchor="start">this one · or any other</text>
				<path class="srs-callout-line" d="M 230 176 Q 260 150 272 92" fill="none" marker-end="url(#srs-arrow)" />

				<defs>
					<marker id="srs-arrow" viewBox="0 0 10 10" refX="9" refY="5"
						markerWidth="6" markerHeight="6" orient="auto">
						<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--coord-route-solid)" />
					</marker>
				</defs>
			</svg>

			<figcaption class="srs-wall-caption srs-wall-caption-bottom">
				If <strong>one</strong> of these 176 contributors destroyed their copy, the SRS is secure. <span class="srs-wall-threat">To forge: <em>all 176</em> must collude <em>and</em> all must have kept their secrets.</span>
			</figcaption>
		</figure>

		<!-- Property card: two columns × three rows (same idiom as nullifier) -->
		<dl class="srs-card">
			<div class="srs-card-col">
				<dt class="srs-card-head">What it is</dt>
				<dd class="srs-card-row">
					<span class="srs-card-key">Proving system</span>
					<span class="srs-card-val">UltraHonk + KZG commitments</span>
				</dd>
				<dd class="srs-card-row">
					<span class="srs-card-key">SRS ceremony</span>
					<span class="srs-card-val">Aztec Ignition · Jan 2020 · BN254</span>
				</dd>
				<dd class="srs-card-row">
					<span class="srs-card-key">Per-circuit setup</span>
					<span class="srs-card-val">none required</span>
				</dd>
			</div>
			<div class="srs-card-col">
				<dt class="srs-card-head">Why it's safe</dt>
				<dd class="srs-card-row">
					<span class="srs-card-key">Participants</span>
					<span class="srs-card-val"><Datum value={176} /></span>
				</dd>
				<dd class="srs-card-row">
					<span class="srs-card-key">Honesty threshold</span>
					<span class="srs-card-val"><code>1-of-176</code></span>
				</dd>
				<dd class="srs-card-row">
					<span class="srs-card-key">Public audit</span>
					<span class="srs-card-val"><a href="https://github.com/AztecProtocol/ignition-verification" target="_blank" rel="noopener">transcript + participants</a></span>
				</dd>
			</div>
		</dl>

		<p class="srs-footer">
			The ceremony output &mdash; 100.8 million BN254 points &mdash; is reused by every Barretenberg protocol. Shared infrastructure, shared eyeballs, shared integrity surface.
		</p>
	</section>

	<!-- ================================================================ -->
	<!-- 9. KNOWN LIMITATIONS — prominent, honest                          -->
	<!-- ================================================================ -->
	<section id="limitations" class="section section-limitations">
		<div class="section-head">
			<span class="section-num">09</span>
			<h2>Known limitations</h2>
		</div>
		<p class="section-lede">
			Load-bearing for the walkaway roadmap. None block shipping. Ordered worst-first.
		</p>

		<div class="limits">
			<section class="limit-band limit-band-gap">
				<header class="limit-band-head">
					<span class="limit-band-glyph" aria-hidden="true">◆</span>
					<h3 class="limit-band-title">Open gaps</h3>
					<span class="limit-band-note">live threats to the security model</span>
				</header>
				<ul class="limit-list">
					<li class="limit">
						<h4 class="limit-title">Operator tree-construction trust</h4>
						<p>The Shadow Atlas operator can poison or censor tree construction. Walkaway roadmap target. See <a href="https://github.com/communisaas/voter-protocol/blob/main/specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md">TRUST-MODEL-AND-OPERATOR-INTEGRITY.md</a> &sect;5.</p>
					</li>
					<li class="limit">
						<h4 class="limit-title">Reproducible build pipeline</h4>
						<p>A cryptographer cannot today reproduce the verifier contract bytecode from the nargo source without insider knowledge of toolchain versions and flags. This undermines the 14-day verifier upgrade timelock's community-verification property. Remediation: pin toolchain in Docker / Nix.</p>
					</li>
				</ul>
			</section>

			<section class="limit-band limit-band-tradeoff">
				<header class="limit-band-head">
					<span class="limit-band-glyph" aria-hidden="true">◇</span>
					<h3 class="limit-band-title">Design trade-offs</h3>
					<span class="limit-band-note">intentional, with stated mitigation</span>
				</header>
				<ul class="limit-list">
					<li class="limit">
						<h4 class="limit-title">Immediate root registration</h4>
						<p>New roots are registered without timelock (fast UX). A compromised governance key can register a poisoned root instantly; the poisoning must still pass Census-based independent verification.</p>
					</li>
				</ul>
			</section>

			<section class="limit-band limit-band-planned">
				<header class="limit-band-head">
					<span class="limit-band-glyph" aria-hidden="true">○</span>
					<h3 class="limit-band-title">Planned work</h3>
					<span class="limit-band-note">absence of evidence, not active risk</span>
				</header>
				<ul class="limit-list">
					<li class="limit">
						<h4 class="limit-title">Professional security audit</h4>
						<p>Three internal review waves have occurred. Findings documented in <code>docs/wave-4xR-*-review.md</code>. No external firm has audited the circuits or contracts.</p>
					</li>
					<li class="limit">
						<h4 class="limit-title">Formal verification</h4>
						<p>No circuit is currently formally verified. Domain-separation non-collision is asserted by property tests, not by a formal proof.</p>
					</li>
				</ul>
			</section>
		</div>
	</section>

	<!-- ================================================================ -->
	<!-- FOOTER                                                            -->
	<!-- ================================================================ -->
	<footer class="spec-footer">
		<div class="footer-links">
			<a href="https://github.com/communisaas/voter-protocol/blob/main/specs/CRYPTOGRAPHY-SPEC.md">
				<span class="flink-label">Canonical spec</span>
				<span class="flink-path">voter-protocol/specs/CRYPTOGRAPHY-SPEC.md</span>
			</a>
			<a href="https://github.com/communisaas/voter-protocol/tree/main/packages/crypto/noir">
				<span class="flink-label">Circuit source</span>
				<span class="flink-path">packages/crypto/noir/</span>
			</a>
			<a href="https://github.com/communisaas/voter-protocol/blob/main/specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md">
				<span class="flink-label">Threat model</span>
				<span class="flink-path">TRUST-MODEL-AND-OPERATOR-INTEGRITY.md</span>
			</a>
		</div>
		<p class="footer-meta">
			commons.email &middot; v1.0.0 &middot; 2026-04-21
		</p>
	</footer>
</div>

<style>
	/* ───────────────────────────────────────────────────────────────────
	   Root container — warm cream ground, generous horizontal breathing
	   ─────────────────────────────────────────────────────────────────── */
	.spec-root {
		max-width: 880px;
		margin: 0 auto;
		padding: 3.5rem 1.5rem 6rem;
		color: var(--text-primary);
		font-family: 'Satoshi', sans-serif;
		line-height: 1.6;
	}

	@media (max-width: 640px) {
		.spec-root {
			padding: 2rem 1rem 4rem;
		}
	}

	/* ───────────────────────────────────────────────────────────────────
	   HERO
	   ─────────────────────────────────────────────────────────────────── */
	.hero {
		margin-bottom: 4rem;
	}

	.eyebrow {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-quaternary);
		margin: 0 0 1.25rem 0;
	}

	.hero-title {
		font-family: 'Satoshi', sans-serif;
		font-size: clamp(1.75rem, 4vw, 2.5rem);
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.15;
		color: var(--text-primary);
		margin: 0 0 1.125rem 0;
	}

	.hero-lede {
		font-size: 1.0625rem;
		color: var(--text-secondary);
		line-height: 1.55;
		max-width: 42rem;
		margin: 0 0 2.5rem 0;
	}

	/* ───────────────────────────────────────────────────────────────────
	   Zone ② — POINTER.  Spec line + canonical source as peers, not a list.
	   Left: what the system IS (identity facts).  Right: where truth lives
	   (destination).  Baseline-aligned grid so the two kinds of reference
	   read as one composition.
	   ─────────────────────────────────────────────────────────────────── */
	.hero-pointer {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: start;
		gap: 2.25rem;
		margin-bottom: 2.5rem;
	}

	.hero-spec-line {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.875rem;
		color: var(--text-tertiary);
		margin: 0;
		line-height: 1.7;
		max-width: 32rem;
	}

	.hero-spec-sep {
		margin: 0 0.5rem;
		color: var(--text-quaternary);
	}

	:global(.hero-spec-datum) {
		font-family: 'JetBrains Mono', monospace;
		color: var(--text-primary);
	}

	/*
		Canonical pointer — composed as a cited specimen, not a generic link.
		Label names the path.  Underline falls ONLY beneath the filename
		characters (not the arrow), so the arrow reads as egress, not suffix.
		Solid hairline instead of dashed — canonical is a fixed point, not
		placeholder grammar.
	*/
	.hero-canonical {
		display: inline-flex;
		flex-direction: column;
		gap: 0.375rem;
		text-decoration: none;
		align-self: flex-start;
		justify-self: end;
		text-align: right;
	}

	.hero-canonical-label {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--text-tertiary);
	}

	.hero-canonical-path {
		display: inline-flex;
		align-items: baseline;
		gap: 0.625em;
		justify-content: flex-end;
	}

	.hero-canonical-name {
		font-family: 'JetBrains Mono', monospace;
		font-size: 1rem;
		font-weight: 500;
		letter-spacing: 0.02em;
		color: var(--text-primary);
		border-bottom: 1px solid rgba(0, 0, 0, 0.28);
		padding-bottom: 3px;
		transition: border-bottom-color 180ms ease-out, border-bottom-width 0ms;
	}

	.hero-canonical-arrow {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.9375rem;
		color: var(--text-tertiary);
		transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
			color 180ms ease-out;
		display: inline-block;
	}

	.hero-canonical:hover .hero-canonical-name {
		border-bottom-color: var(--text-primary);
	}

	.hero-canonical:hover .hero-canonical-arrow {
		color: var(--text-primary);
		transform: translate(2px, -2px);
	}

	/* ───────────────────────────────────────────────────────────────────
	   Zone ③ — FORK.  Two audience paths, hairline-separated, promoted to
	   first-class structural decision.  No containers.
	   ─────────────────────────────────────────────────────────────────── */
	.hero-fork {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0;
		padding: 1.5rem 0 0;
		border-top: 1px solid var(--coord-node-border);
		margin-bottom: 2rem;
	}

	.hero-fork-path {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.25rem 1.5rem 0.25rem 0;
		text-decoration: none;
		transition: transform 180ms ease-out;
	}

	.hero-fork-path + .hero-fork-path {
		padding-left: 1.5rem;
		border-left: 1px solid var(--coord-node-border);
	}

	.hero-fork-title {
		font-family: 'Satoshi', sans-serif;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary);
		border-bottom: 1px solid oklch(0.82 0.06 180 / 0.5);
		padding-bottom: 2px;
		align-self: flex-start;
		transition: border-bottom-color 150ms ease-out, color 150ms ease-out;
	}

	.hero-fork-note {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		line-height: 1.5;
	}

	.hero-fork-path:hover .hero-fork-title {
		color: oklch(0.32 0.11 175);
		border-bottom-color: oklch(0.45 0.1 180);
	}

	@media (max-width: 640px) {
		.hero-pointer {
			grid-template-columns: 1fr;
			gap: 1.25rem;
		}
		.hero-canonical {
			justify-self: start;
			text-align: left;
		}
		.hero-canonical-path {
			justify-content: flex-start;
		}
		.hero-fork {
			grid-template-columns: 1fr;
			gap: 1.25rem;
		}
		.hero-fork-path + .hero-fork-path {
			padding-left: 0;
			padding-top: 1.25rem;
			border-left: none;
			border-top: 1px solid var(--coord-node-border);
		}
	}

	/* ───────────────────────────────────────────────────────────────────
	   TOC — 3×3 ordinal grid.  Uniform columns so items align vertically
	   across rows; wrap is structural, not emergent.  Prefix and title are
	   typographically paired via a deliberate gap, not fused.
	   ─────────────────────────────────────────────────────────────────── */
	.toc {
		margin-bottom: 5rem;
		padding: 1.25rem 0;
	}

	.toc ol {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		column-gap: 2rem;
		row-gap: 1.25rem;
		counter-reset: toc-counter;
	}

	.toc li {
		counter-increment: toc-counter;
		min-width: 0;
	}

	.toc a {
		display: inline-flex;
		align-items: baseline;
		gap: 0.75rem;
		font-family: 'Satoshi', sans-serif;
		font-size: 0.9375rem;
		color: var(--text-secondary);
		text-decoration: none;
		transition: color 180ms ease-out;
	}

	.toc a::before {
		content: counter(toc-counter, decimal-leading-zero);
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-quaternary);
		transition: color 180ms ease-out;
	}

	.toc-title {
		border-bottom: 1px solid transparent;
		padding-bottom: 2px;
		transition: border-bottom-color 180ms ease-out;
	}

	.toc a:hover {
		color: var(--text-primary);
	}

	.toc a:hover::before {
		color: var(--text-tertiary);
	}

	.toc a:hover .toc-title {
		border-bottom-color: var(--text-quaternary);
	}

	@media (max-width: 720px) {
		.toc ol {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 480px) {
		.toc ol {
			grid-template-columns: 1fr;
		}
	}

	/* ───────────────────────────────────────────────────────────────────
	   SECTIONS — spatial rhythm
	   ─────────────────────────────────────────────────────────────────── */
	.section {
		margin-bottom: 5.5rem;
		scroll-margin-top: 6rem;
	}

	.section-centered {
		text-align: center;
	}

	.section-centered .binding-explain {
		text-align: left;
		max-width: 42rem;
		margin: 2rem auto 0;
	}

	.section-head {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.section-centered .section-head {
		justify-content: center;
	}

	.section-num {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		color: var(--text-quaternary);
		letter-spacing: 0.04em;
	}

	.section h2 {
		font-family: 'Satoshi', sans-serif;
		font-size: 1.375rem;
		font-weight: 600;
		letter-spacing: -0.015em;
		color: var(--text-primary);
		margin: 0;
		line-height: 1.2;
	}

	.section-lede {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		max-width: 42rem;
		margin: 0 0 2rem 0;
		line-height: 1.6;
	}

	.section-lede.center {
		margin-left: auto;
		margin-right: auto;
	}

	.section-aside {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		font-style: italic;
		max-width: 42rem;
		margin: 1.5rem 0 0 0;
		line-height: 1.55;
	}

	/* ───────────────────────────────────────────────────────────────────
	   TRUST STACK
	   ─────────────────────────────────────────────────────────────────── */
	.stack {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.stack-layer {
		padding: 1.25rem 1.5rem;
		border-left: 2px solid var(--coord-node-border);
		background: transparent;
	}

	.stack-header {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
		flex-wrap: wrap;
	}

	.stack-index {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		color: var(--text-quaternary);
		font-weight: 500;
	}

	.stack-name {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.stack-quality {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.75rem;
		font-style: italic;
		letter-spacing: 0;
	}

	.q-trustless {
		color: var(--coord-verified);
	}

	.q-observable {
		color: var(--coord-route-solid);
	}

	.q-trusted {
		color: var(--text-tertiary);
	}

	.q-verifiable {
		color: var(--coord-share-solid);
	}

	.stack-layer p {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin: 0;
		line-height: 1.6;
	}

	.stack-layer em {
		color: var(--text-primary);
		font-style: italic;
	}

	/* ───────────────────────────────────────────────────────────────────
	   PRIMITIVES — three nested layers, vertical stack
	   ─────────────────────────────────────────────────────────────────── */
	.primitives-stack {
		display: flex;
		flex-direction: column;
		gap: 3rem;
	}

	.prim {
		position: relative;
		padding-left: 1.25rem;
		border-left: 1px dashed var(--coord-node-border);
	}

	.prim-eyebrow {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-quaternary);
		margin: 0 0 0.375rem 0;
	}

	.prim-name {
		font-family: 'Satoshi', sans-serif;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0 0 1.25rem 0;
		letter-spacing: -0.015em;
	}

	.prim-note {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		line-height: 1.6;
		margin: 1.25rem 0 0 0;
		max-width: 42rem;
	}

	.prim-note .op-emph {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--coord-verified);
		background: none;
		padding: 0 0.0625rem;
	}

	/* ── Layer I — Field ── */
	.field-scale {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem 3rem;
		align-items: baseline;
		margin-bottom: 1.5rem;
	}

	.scale-block {
		display: flex;
		flex-direction: column;
		gap: 0.3125rem;
	}

	.scale-value {
		font-family: 'JetBrains Mono', monospace;
		font-size: 1.125rem;
		color: var(--text-primary);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	.scale-value sup {
		font-size: 0.6875rem;
		vertical-align: super;
		line-height: 1;
	}

	.scale-note {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-quaternary);
	}

	.modulus-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		color: var(--text-quaternary);
		margin: 0 0 0.375rem 0;
	}

	.modulus {
		display: block;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		color: var(--text-secondary);
		background: none;
		padding: 0;
		margin: 0;
		overflow-wrap: anywhere;
		line-height: 1.55;
		max-width: 44rem;
	}

	/* ── Layer II — Hash ── */
	.gate-compare {
		margin: 0 0 1.5rem 0;
		padding: 0.25rem 0 0.5rem 0;
	}

	.gate-caption {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-quaternary);
		margin-bottom: 0.875rem;
	}

	.gate-row {
		display: grid;
		grid-template-columns: 120px 1fr 5.5rem;
		align-items: center;
		gap: 0.875rem;
		margin-bottom: 0.625rem;
	}

	.gate-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		text-align: right;
	}

	.gate-bar {
		height: 14px;
		background: rgba(0, 0, 0, 0.035);
		position: relative;
		overflow: hidden;
		border-radius: 2px;
	}

	.gate-fill {
		display: block;
		height: 100%;
		min-width: 2px;
		background: var(--text-tertiary);
	}

	.gate-poseidon .gate-fill {
		background: var(--coord-verified);
	}

	.gate-sha .gate-fill {
		background: var(--text-tertiary);
		opacity: 0.45;
	}

	.gate-value {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.875rem;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
		text-align: left;
	}

	.gate-poseidon .gate-value {
		color: var(--coord-verified);
		font-weight: 500;
	}

	.gate-verdict {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin: 0.875rem 0 0 0;
		padding-left: calc(120px + 0.875rem);
		line-height: 1.5;
	}

	.gate-verdict .ratio {
		font-family: 'JetBrains Mono', monospace;
		color: var(--coord-verified);
		font-weight: 600;
		font-size: 1rem;
	}

	.hash-params {
		display: flex;
		flex-wrap: wrap;
		gap: 0 2rem;
		padding: 0.75rem 0;
		margin: 0 0 0.25rem 0;
		border-top: 1px dashed var(--coord-node-border);
		border-bottom: 1px dashed var(--coord-node-border);
	}

	.hash-params > div {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3125rem;
	}

	.hash-params dt {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
	}

	.hash-params dt::after {
		content: '=';
		color: var(--text-quaternary);
		margin-left: 0.3125rem;
	}

	.hash-params dd {
		margin: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: var(--text-primary);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 600px) {
		.gate-row {
			grid-template-columns: 84px 1fr 4.5rem;
			gap: 0.625rem;
		}
		.gate-verdict {
			padding-left: calc(84px + 0.625rem);
		}
		.gate-label {
			font-size: 0.75rem;
		}
	}

	/* ───────────────────────────────────────────────────────────────────
	   DOMAIN SEPARATION — typological registry
	   ─────────────────────────────────────────────────────────────────── */
	.tag-registry {
		display: flex;
		flex-direction: column;
		gap: 3rem;
	}

	.cluster {
		padding-left: 1.25rem;
		border-left: 1px dashed var(--coord-node-border);
	}

	.cluster-head {
		margin-bottom: 0.5rem;
	}

	.cluster-eyebrow {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-quaternary);
		margin: 0 0 0.375rem 0;
	}

	.cluster-desc {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.55;
		margin: 0;
		max-width: 44rem;
	}

	.cluster-desc code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: var(--text-primary);
		background: none;
		padding: 0;
	}

	.specimens {
		display: flex;
		flex-direction: column;
	}

	/* Attestation — the consummation */
	.attestation {
		margin-top: 3.5rem;
		padding: 1.5rem 1.75rem;
		border: 1px solid var(--coord-node-border);
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.015);
	}

	.attest-head {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		margin-bottom: 0.75rem;
	}

	.attest-mark {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--coord-verified);
		padding: 0.1875rem 0.5rem;
		border: 1px solid rgba(16, 185, 129, 0.35);
		border-radius: 3px;
	}

	.attest-sep {
		flex: 1;
		height: 1px;
		background: var(--coord-node-border);
	}

	.attest-label {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-quaternary);
		font-weight: 500;
	}

	.attest-body {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.6;
		margin: 0;
		max-width: 48rem;
	}

	.attest-body code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: var(--text-primary);
		background: none;
		padding: 0;
	}

	.attest-body a {
		color: var(--text-primary);
		text-decoration: none;
		border-bottom: 1px dashed var(--text-quaternary);
	}

	.attest-body a:hover {
		border-bottom-color: var(--text-primary);
	}

	.attest-body sub {
		font-size: 0.6875em;
	}

	/* ───────────────────────────────────────────────────────────────────
	   DATA STRUCTURES — topology + kinship clusters
	   ─────────────────────────────────────────────────────────────────── */
	.tree-clusters {
		display: flex;
		flex-direction: column;
		gap: 3rem;
	}

	/* .cluster, .cluster-head, .cluster-eyebrow, .cluster-desc, .specimens
	   are shared with Domain Separation — defined in that section. */

	/* ───────────────────────────────────────────────────────────────────
	   CROSS-TREE BINDING — two-property specimen + verdict
	   ─────────────────────────────────────────────────────────────────── */
	.binding-properties {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 2.5rem;
		max-width: 48rem;
		margin: 2.5rem auto 1.75rem;
		text-align: left;
	}

	.property {
		padding-left: 1rem;
		border-left: 2px solid var(--coord-route-solid);
	}

	.prop-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-quaternary);
		margin: 0 0 0.5rem 0;
	}

	.prop-body {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.6;
		margin: 0;
	}

	.prop-body code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: var(--coord-route-solid);
		background: none;
		padding: 0;
	}

	.binding-verdict {
		max-width: 44rem;
		margin: 0 auto;
		padding-top: 1.5rem;
		border-top: 1px dashed var(--coord-node-border);
		text-align: center;
		font-family: 'Satoshi', sans-serif;
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.6;
		font-style: italic;
	}

	.binding-verdict code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: var(--text-primary);
		background: none;
		padding: 0;
		font-style: normal;
	}

	@media (max-width: 640px) {
		.binding-properties {
			grid-template-columns: 1fr;
			gap: 1.5rem;
		}
	}

	/* ───────────────────────────────────────────────────────────────────
	   CIRCUITS — two clusters, four signature-forward specimens
	   (specimen internals live in CircuitSpecimen.svelte)
	   ─────────────────────────────────────────────────────────────────── */
	.circuit-clusters {
		display: flex;
		flex-direction: column;
		gap: 3rem;
	}

	/* ───────────────────────────────────────────────────────────────────
	   NULLIFIER EVOLUTION
	   ─────────────────────────────────────────────────────────────────── */
	.evo {
		display: grid;
		grid-template-rows: auto auto auto;
		gap: 0.75rem;
		margin-bottom: 2rem;
	}

	.evo-row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: baseline;
		gap: 1rem;
		padding: 1rem 1.25rem;
		border-radius: 6px;
	}

	.evo-old {
		background: rgba(0, 0, 0, 0.025);
		border: 1px solid var(--coord-node-border);
	}

	.evo-new {
		background: rgba(16, 185, 129, 0.05);
		border: 1px solid rgba(16, 185, 129, 0.22);
	}

	.evo-label {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-quaternary);
	}

	.evo-old .evo-label {
		color: var(--text-quaternary);
	}

	.evo-new .evo-label {
		color: var(--coord-verified);
	}

	.evo-expr {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.9375rem;
		color: var(--text-primary);
		background: none;
		padding: 0;
	}

	.evo-old .evo-expr {
		color: var(--text-tertiary);
		text-decoration: line-through;
		text-decoration-color: rgba(0, 0, 0, 0.3);
	}

	.evo-varying {
		color: var(--text-primary) !important;
		font-weight: 500;
	}

	.evo-stable {
		color: var(--coord-verified);
		font-weight: 500;
	}

	.evo-verdict {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		font-style: italic;
		text-align: right;
	}

	.evo-new .evo-verdict {
		color: var(--coord-verified);
		font-style: normal;
	}

	.evo-arrow {
		text-align: center;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		color: var(--text-quaternary);
		letter-spacing: 0.08em;
	}

	.evo-arrow::before,
	.evo-arrow::after {
		content: '';
		display: inline-block;
		width: 2rem;
		height: 1px;
		background: var(--coord-node-border);
		vertical-align: middle;
		margin: 0 0.75rem;
	}

	.evo-arrow-label {
		text-transform: uppercase;
	}

	.nul-explain {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		line-height: 1.65;
		max-width: 42rem;
	}

	.nul-explain p {
		margin: 0 0 1rem 0;
	}

	.nul-explain p:last-child {
		margin-bottom: 0;
	}

	.nul-explain code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: var(--text-primary);
		background: none;
		padding: 0;
	}

	/* ─── Nullifier pedagogy: lede → attack → fix → formal → property card ─── */

	.nul-lede {
		font-family: 'Satoshi', sans-serif;
		font-size: 1.0625rem;
		line-height: 1.55;
		color: var(--text-secondary);
		max-width: 44rem;
		margin: 0 0 1.75rem 0;
	}

	.nul-lede strong {
		color: var(--text-primary);
		font-weight: 600;
	}

	/* Two visual scenarios: attack and fix. Stacked. */
	.nul-scene {
		margin: 0 0 1.5rem 0;
		padding: 1rem 1.25rem 1.125rem;
		border: 1px solid var(--coord-node-border);
		border-radius: 6px;
		background: var(--surface-base);
	}

	/* State cue lives in the label and the diagram's internal color language,
	   not in a decorative sidebar stripe. */

	.nul-scene-caption {
		display: flex;
		align-items: baseline;
		gap: 0.875rem;
		margin: 0 0 0.5rem 0;
		flex-wrap: wrap;
	}

	.nul-scene-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 600;
	}

	.nul-scene-label-bad {
		color: rgb(180, 60, 60);
	}

	.nul-scene-label-good {
		color: var(--coord-route-solid);
	}

	.nul-scene-claim {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.9375rem;
		color: var(--text-primary);
		font-weight: 500;
	}

	.nul-scene-claim em {
		color: var(--text-primary);
		font-weight: 700;
		font-style: normal;
	}

	.nul-svg {
		display: block;
		width: 100%;
		height: auto;
		max-width: 720px;
		margin: 0.5rem auto 0.75rem;
	}

	.nul-scene-note {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.875rem;
		line-height: 1.55;
		color: var(--text-secondary);
		max-width: 46rem;
		margin: 0.5rem 0 0 0;
		padding-top: 0.625rem;
		border-top: 1px dashed var(--coord-node-border);
	}

	.nul-scene-note code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: var(--text-primary);
		background: none;
		padding: 0;
	}

	/* SVG primitives specific to the nullifier scenes */
	.nul-zone {
		font-family: 'JetBrains Mono', monospace;
		font-size: 9px;
		fill: var(--text-quaternary);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.nul-fork {
		stroke: var(--text-tertiary);
		stroke-width: 1;
		fill: none;
	}

	.nul-peg-bad {
		fill: rgba(180, 60, 60, 0.06);
		stroke: rgba(180, 60, 60, 0.55);
		stroke-width: 1.25;
	}

	.nul-peg-bad-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		fill: rgb(140, 50, 50);
		font-weight: 500;
	}

	.nul-bracket-bad {
		stroke: rgba(180, 60, 60, 0.55);
		stroke-width: 1.25;
		fill: none;
	}

	.nul-annot-bad {
		font-family: 'JetBrains Mono', monospace;
		font-size: 18px;
		fill: rgb(180, 60, 60);
		font-weight: 700;
	}

	/* Formal diff header */
	.nul-evo {
		margin-top: 2rem;
	}

	.evo-header {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-quaternary);
		margin: 0 0 0.5rem 0;
	}

	/* Property card: the two inputs, side by side */
	.nul-card {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin: 1.5rem 0 0 0;
		padding: 0;
	}

	.nul-card-col {
		display: flex;
		flex-direction: column;
		padding: 0.875rem 1rem 1rem;
		border: 1px solid var(--coord-node-border);
		border-radius: 6px;
		background: var(--surface-base);
		margin: 0;
	}

	.nul-card-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		padding-bottom: 0.625rem;
		margin-bottom: 0.625rem;
		border-bottom: 1px dashed var(--coord-node-border);
	}

	.nul-card-head code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.9375rem;
		color: var(--text-primary);
		background: none;
		padding: 0;
		font-weight: 500;
	}

	.nul-card-tag {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 0.125rem 0.5rem;
		border-radius: 3px;
		font-weight: 600;
	}

	.nul-card-tag-private {
		color: var(--text-secondary);
		border: 1px dashed var(--text-tertiary);
		background: #ffffff;
	}

	.nul-card-tag-public {
		color: var(--text-primary);
		border: 1.25px solid var(--text-primary);
		background: #ffffff;
	}

	.nul-card-row {
		display: grid;
		grid-template-columns: 7rem 1fr;
		gap: 0.75rem;
		align-items: baseline;
		padding: 0.375rem 0;
		margin: 0;
		border-bottom: 1px dashed var(--coord-node-border);
	}

	.nul-card-row:last-child {
		border-bottom: none;
	}

	.nul-card-key {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.nul-card-val {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--text-secondary);
	}

	.nul-card-val code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: var(--text-primary);
		background: none;
		padding: 0;
	}

	@media (max-width: 640px) {
		.nul-card {
			grid-template-columns: 1fr;
		}
		.nul-card-row {
			grid-template-columns: 1fr;
			gap: 0.125rem;
		}
	}

	/* ───────────────────────────────────────────────────────────────────
	   TRUSTED SETUP: lede → 1-of-N wall → property card → footer
	   ─────────────────────────────────────────────────────────────────── */
	.srs-lede {
		font-family: 'Satoshi', sans-serif;
		font-size: 1.0625rem;
		line-height: 1.55;
		color: var(--text-secondary);
		max-width: 44rem;
		margin: 0 0 2rem 0;
	}

	/* The wall: dense grid of dots, one highlighted teal */
	.srs-wall {
		margin: 0 0 2rem 0;
		padding: 1.125rem 1.25rem 1.25rem;
		border: 1px solid var(--coord-node-border);
		border-radius: 6px;
		background: var(--surface-base);
	}

	.srs-wall-caption {
		font-family: 'Satoshi', sans-serif;
		line-height: 1.5;
		max-width: 50rem;
	}

	.srs-wall-caption-top {
		display: flex;
		align-items: baseline;
		gap: 0.875rem;
		flex-wrap: wrap;
		margin: 0 0 0.5rem 0;
	}

	.srs-wall-count {
		display: inline-flex;
		align-items: baseline;
		font-family: 'JetBrains Mono', monospace;
		font-weight: 600;
	}

	:global(.srs-wall-count-num) {
		font-size: 1.5rem;
		color: var(--text-primary);
		letter-spacing: -0.01em;
	}

	.srs-wall-count-plus {
		font-size: 1.25rem;
		color: var(--text-tertiary);
		margin-left: 0.0625rem;
	}

	.srs-wall-desc {
		font-size: 0.875rem;
		color: var(--text-secondary);
	}

	.srs-wall-svg {
		display: block;
		width: 100%;
		height: auto;
		max-width: 720px;
		margin: 0.5rem auto 0.625rem;
	}

	.srs-dot {
		fill: rgba(30, 30, 30, 0.18);
	}

	.srs-dot-honest {
		fill: var(--coord-route-solid);
	}

	.srs-dot-ring {
		fill: none;
		stroke: var(--coord-route-solid);
		stroke-width: 1.25;
		opacity: 0.55;
	}

	.srs-callout-line {
		stroke: var(--coord-route-solid);
		stroke-width: 1.25;
		opacity: 0.85;
	}

	.srs-callout-text {
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		fill: var(--coord-route-solid);
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.srs-wall-caption-bottom {
		margin: 0.5rem 0 0 0;
		padding-top: 0.625rem;
		border-top: 1px dashed var(--coord-node-border);
		font-size: 0.9375rem;
		color: var(--text-secondary);
	}

	.srs-wall-caption-bottom strong {
		color: var(--coord-route-solid);
		font-weight: 700;
	}

	.srs-wall-threat {
		display: block;
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
	}

	.srs-wall-threat em {
		font-style: normal;
		font-weight: 600;
		color: var(--text-secondary);
	}

	/* Property card: same idiom as .nul-card */
	.srs-card {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin: 0 0 1.5rem 0;
		padding: 0;
	}

	.srs-card-col {
		display: flex;
		flex-direction: column;
		padding: 0.875rem 1rem 1rem;
		border: 1px solid var(--coord-node-border);
		border-radius: 6px;
		background: var(--surface-base);
		margin: 0;
	}

	.srs-card-head {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary);
		letter-spacing: 0.01em;
		padding-bottom: 0.625rem;
		margin-bottom: 0.625rem;
		border-bottom: 1px dashed var(--coord-node-border);
	}

	.srs-card-row {
		display: grid;
		grid-template-columns: 8rem 1fr;
		gap: 0.75rem;
		align-items: baseline;
		padding: 0.375rem 0;
		margin: 0;
		border-bottom: 1px dashed var(--coord-node-border);
	}

	.srs-card-row:last-child {
		border-bottom: none;
	}

	.srs-card-key {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.srs-card-val {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--text-secondary);
	}

	.srs-card-val code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: var(--text-primary);
		background: none;
		padding: 0;
	}

	.srs-card-val a {
		color: inherit;
		text-decoration: none;
		border-bottom: 1px dashed var(--text-tertiary);
		transition: color 180ms ease-out, border-color 180ms ease-out;
	}

	.srs-card-val a:hover {
		color: var(--coord-route-solid);
		border-bottom-color: var(--coord-route-solid);
	}

	.srs-footer {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.875rem;
		color: var(--text-tertiary);
		font-style: italic;
		line-height: 1.55;
		max-width: 44rem;
		margin: 0;
	}

	@media (max-width: 640px) {
		.srs-card {
			grid-template-columns: 1fr;
		}
		.srs-card-row {
			grid-template-columns: 1fr;
			gap: 0.125rem;
		}
	}

	/* ───────────────────────────────────────────────────────────────────
	   KNOWN LIMITATIONS — three-band taxonomy carries its own salience.
	   No external rule, no special top-padding — §9 flows like §1–§8.
	   ─────────────────────────────────────────────────────────────────── */
	.limits {
		display: flex;
		flex-direction: column;
		gap: 2.75rem;
		margin-top: 2rem;
	}

	/* Band — the taxonomy row.  Glyph + title + side-note, no container chrome. */
	.limit-band {
		display: flex;
		flex-direction: column;
	}

	.limit-band-head {
		display: grid;
		grid-template-columns: 1.25rem auto 1fr;
		align-items: baseline;
		gap: 0.625rem;
		padding-bottom: 0.75rem;
		margin-bottom: 0.25rem;
		border-bottom: 1px solid var(--coord-node-border);
	}

	.limit-band-glyph {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.875rem;
		line-height: 1;
		text-align: center;
	}

	.limit-band-title {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-primary);
		margin: 0;
	}

	.limit-band-note {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.75rem;
		color: var(--text-quaternary);
		letter-spacing: 0.01em;
	}

	/* Heat lives in the glyph color triad — nowhere else. */
	.limit-band-gap .limit-band-glyph {
		color: rgba(180, 60, 60, 0.9);
	}
	.limit-band-tradeoff .limit-band-glyph {
		color: var(--text-tertiary);
	}
	.limit-band-planned .limit-band-glyph {
		color: var(--text-quaternary);
	}

	.limit-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
	}

	.limit {
		padding: 1.125rem 0 1.125rem 1.875rem;
		border-top: 1px solid transparent;
	}

	.limit + .limit {
		border-top: 1px dashed var(--coord-node-border);
	}

	.limit-title {
		font-family: 'Satoshi', sans-serif;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0 0 0.375rem 0;
	}

	.limit p {
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.6;
		margin: 0;
	}

	.limit code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		color: var(--text-primary);
	}

	.limit a {
		color: var(--text-primary);
		text-decoration: none;
		border-bottom: 1px dashed var(--text-quaternary);
	}

	/* ───────────────────────────────────────────────────────────────────
	   FOOTER
	   ─────────────────────────────────────────────────────────────────── */
	.spec-footer {
		margin-top: 5rem;
		padding-top: 3rem;
		border-top: 1px solid var(--coord-node-border);
	}

	.footer-manifesto {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		font-style: italic;
		line-height: 1.6;
		max-width: 40rem;
		margin: 0 0 2rem 0;
	}

	.footer-links {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		margin-bottom: 2.5rem;
	}

	.footer-links a {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		text-decoration: none;
		padding: 0.75rem 0;
		border-top: 1px dashed var(--coord-node-border);
		transition: padding-left 180ms ease-out;
	}

	.footer-links a:hover {
		padding-left: 0.5rem;
	}

	.footer-links a:last-child {
		border-bottom: 1px dashed var(--coord-node-border);
	}

	.flink-label {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-quaternary);
	}

	.flink-path {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: var(--text-primary);
	}

	.footer-meta {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		color: var(--text-quaternary);
		text-align: center;
		margin: 0;
	}
</style>
