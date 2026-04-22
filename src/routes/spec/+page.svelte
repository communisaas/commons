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
			use: 'User leaf: H4(user_secret, cell_id, salt, auth_level)'
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
			name: 'SONGE_24',
			hex: '0x534f4e47455f24',
			layout: [
				{ kind: 'tag', label: 'SONGE_24' },
				{ kind: 'zero' },
				{ kind: 'zero' },
				{ kind: 'zero' }
			],
			arity: '24',
			use: 'District commitment · sponge capacity seed'
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
			The canonical specification. Circuit topology, Poseidon2 construction, domain separation, nullifier scheme, trusted setup, threat model.
		</p>

		<div class="hero-facts">
			<div class="hero-fact">
				<span class="fact-label">Proof system</span>
				<span class="fact-value fact-text">UltraHonk over BN254</span>
			</div>
			<div class="hero-fact">
				<span class="fact-label">Live circuits</span>
				<Cite
					form="whisper"
					provenance={() => 'three-tree membership · position note · debate weight · bubble membership'}
				>
					<Datum value={4} class="text-base text-text-primary" />
				</Cite>
			</div>
			<div class="hero-fact">
				<span class="fact-label">Trusted setup</span>
				<span class="fact-value fact-text">Aztec universal SRS, 1-of-N</span>
			</div>
			<div class="hero-fact">
				<span class="fact-label">Canonical source</span>
				<a
					class="fact-value fact-link"
					href="https://github.com/voter-protocol/voter-protocol/blob/main/specs/CRYPTOGRAPHY-SPEC.md"
				><span class="font-mono">CRYPTOGRAPHY-SPEC.md</span> &rarr;</a>
			</div>
		</div>

		<p class="hero-audience">
			<a href="/org" class="hero-audience-link">For advocacy orgs &rarr;</a>
			<span class="hero-audience-sep" aria-hidden="true">·</span>
			<a href="https://github.com/voter-protocol/voter-protocol/blob/main/specs/CRYPTOGRAPHY-SPEC.md" class="hero-audience-link">For cryptographers &rarr;</a>
		</p>
	</header>

	<!-- ================================================================ -->
	<!-- TOC — scannable, anchor-addressable                               -->
	<!-- ================================================================ -->
	<nav class="toc" aria-label="Specification sections">
		<ol>
			<li><a href="#trust-stack">Trust stack</a></li>
			<li><a href="#primitives">Primitives</a></li>
			<li><a href="#domain-separation">Domain separation</a></li>
			<li><a href="#data-structures">Data structures</a></li>
			<li><a href="#binding">Cross-tree binding</a></li>
			<li><a href="#circuits">Circuits</a></li>
			<li><a href="#nullifier">Nullifier scheme</a></li>
			<li><a href="#trusted-setup">Trusted setup</a></li>
			<li><a href="#limitations">Known limitations</a></li>
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
				For every pair of distinct tags, <a href="https://github.com/voter-protocol/voter-protocol/blob/main/packages/crypto/test/domain-separation.test.ts"><code>packages/crypto/test/domain-separation.test.ts</code></a> asserts <code>H<sub>t&#8321;</sub>(x, y, z) &ne; H<sub>t&#8322;</sub>(x, y, z)</code> for arbitrary non-zero inputs. The test runs on every CI build.
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
	<!-- 7. NULLIFIER SCHEME — NUL-001 evolution                           -->
	<!-- ================================================================ -->
	<section id="nullifier" class="section">
		<div class="section-head">
			<span class="section-num">07</span>
			<h2>Nullifier scheme</h2>
		</div>

		<div class="evo">
			<div class="evo-row evo-old">
				<span class="evo-label">before</span>
				<code class="evo-expr">nullifier = H2(<span class="evo-varying">user_secret</span>, action_domain)</code>
				<span class="evo-verdict">Sybil via re-registration</span>
			</div>
			<div class="evo-arrow" aria-hidden="true">
				<span class="evo-arrow-label">NUL-001</span>
			</div>
			<div class="evo-row evo-new">
				<span class="evo-label">now</span>
				<code class="evo-expr">nullifier = H2(<span class="evo-stable">identity_commitment</span>, action_domain)</code>
				<span class="evo-verdict">deterministic per verified person</span>
			</div>
		</div>

		<div class="nul-explain">
			<p>
				<strong><code>identity_commitment</code></strong> is derived deterministically from a verified identity credential (mDL via W3C Digital Credentials API). It is <em>stable across re-registrations</em> &mdash; a user who registers again with new <code>user_secret</code>, new <code>registration_salt</code>, and in a new cell still produces the <strong>same</strong> <code>identity_commitment</code>.
			</p>
			<p>
				<strong><code>action_domain</code></strong> is a <em>public</em> circuit input controlled by the verifying contract &mdash; typically <code>H(epoch_id, campaign_id, authority_hash, target_type)</code>. Users cannot manipulate it to produce multiple valid proofs for the same action.
			</p>
			<p>
				The pre-NUL-001 construction used <code>user_secret</code>, allowing Sybil attacks via key rotation: register again with a new secret, generate a new nullifier for the same action. The fix anchors the nullifier to the identity, not the key.
			</p>
		</div>
	</section>

	<!-- ================================================================ -->
	<!-- 8. TRUSTED SETUP                                                  -->
	<!-- ================================================================ -->
	<section id="trusted-setup" class="section">
		<div class="section-head">
			<span class="section-num">08</span>
			<h2>Trusted setup</h2>
		</div>

		<div class="srs-body">
			<div class="srs-fact-row">
				<div class="srs-fact">
					<span class="srs-fact-label">Proving system</span>
					<span class="srs-fact-value">UltraHonk, KZG commitments</span>
				</div>
				<div class="srs-fact">
					<span class="srs-fact-label">Ceremony participants</span>
					<span class="srs-count">
						<Datum value={100000} class="text-2xl text-text-primary font-medium" /><span class="srs-fact-suffix">+</span>
					</span>
				</div>
				<div class="srs-fact">
					<span class="srs-fact-label">Security model</span>
					<span class="srs-fact-value">one honest participant sufficient</span>
				</div>
				<div class="srs-fact">
					<span class="srs-fact-label">Per-circuit ceremony</span>
					<span class="srs-fact-value">none required</span>
				</div>
			</div>

			<p class="srs-prose">
				The protocol consumes the Aztec Universal SRS &mdash; a reusable structured reference string generated by a multi-party computation with more than 100,000 participants. If <em>even one</em> participant was honest (did not reveal their toxic waste), the SRS is secure. Compromise requires collusion of all participants.
			</p>
			<p class="srs-prose">
				The SRS is shared across all protocols using Barretenberg. More eyeballs; shared risk. Transcript, participant list, and verification tooling are public at the Barretenberg repository.
			</p>
		</div>
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
			Load-bearing for the walkaway roadmap. None block shipping.
		</p>

		<ul class="limits">
			<li class="limit">
				<h3>Professional security audit</h3>
				<p class="limit-status">Planned, not complete.</p>
				<p>Three internal review waves have occurred. Findings documented in <code>docs/wave-4xR-*-review.md</code>. No external firm has audited the circuits or contracts.</p>
			</li>
			<li class="limit">
				<h3>Formal verification</h3>
				<p class="limit-status">Planned, not complete.</p>
				<p>No circuit is currently formally verified. Domain-separation non-collision is asserted by property tests, not by a formal proof.</p>
			</li>
			<li class="limit">
				<h3>Reproducible build pipeline</h3>
				<p class="limit-status">Open gap.</p>
				<p>A cryptographer cannot today reproduce the verifier contract bytecode from the nargo source without insider knowledge of toolchain versions and flags. This undermines the 14-day verifier upgrade timelock's community-verification property. Remediation: pin toolchain in Docker / Nix.</p>
			</li>
			<li class="limit">
				<h3>Immediate root registration</h3>
				<p class="limit-status">Design trade-off, acknowledged.</p>
				<p>New roots are registered without timelock (fast UX). A compromised governance key can register a poisoned root instantly; the poisoning must still pass Census-based independent verification.</p>
			</li>
			<li class="limit">
				<h3>Operator tree-construction trust</h3>
				<p class="limit-status">Core gap.</p>
				<p>The Shadow Atlas operator can poison or censor tree construction. Walkaway roadmap target. See <a href="https://github.com/voter-protocol/voter-protocol/blob/main/specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md">TRUST-MODEL-AND-OPERATOR-INTEGRITY.md</a> &sect;5.</p>
			</li>
		</ul>
	</section>

	<!-- ================================================================ -->
	<!-- FOOTER                                                            -->
	<!-- ================================================================ -->
	<footer class="spec-footer">
		<div class="footer-links">
			<a href="https://github.com/voter-protocol/voter-protocol/blob/main/specs/CRYPTOGRAPHY-SPEC.md">
				<span class="flink-label">Canonical spec</span>
				<span class="flink-path">voter-protocol/specs/CRYPTOGRAPHY-SPEC.md</span>
			</a>
			<a href="https://github.com/voter-protocol/voter-protocol/tree/main/packages/crypto/noir">
				<span class="flink-label">Circuit source</span>
				<span class="flink-path">packages/crypto/noir/</span>
			</a>
			<a href="https://github.com/voter-protocol/voter-protocol/blob/main/specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md">
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
		margin: 0 0 2.25rem 0;
	}

	.hero-facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 1.5rem 2.5rem;
		padding: 1.5rem 0;
		border-top: 1px solid var(--coord-node-border);
		border-bottom: 1px solid var(--coord-node-border);
		margin-bottom: 1.25rem;
	}

	.hero-audience {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		margin: 0 0 1.75rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.625rem;
		align-items: center;
	}
	.hero-audience-sep { opacity: 0.5; }
	.hero-audience-link {
		color: var(--text-secondary);
		text-decoration: none;
		border-bottom: 1px solid oklch(0.82 0.06 180 / 0.5);
		padding-bottom: 1px;
		transition: color 150ms ease-out, border-bottom-color 150ms ease-out;
	}
	.hero-audience-link:hover {
		color: oklch(0.32 0.11 175);
		border-bottom-color: oklch(0.45 0.1 180);
	}

	.hero-fact {
		display: flex;
		flex-direction: column;
		gap: 0.3125rem;
	}

	.fact-label {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-quaternary);
	}

	.fact-value {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.875rem;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}

	/* Interpretive phrase (proper nouns + descriptor). Satoshi, not mono. */
	.fact-text {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.9375rem;
		font-variant-numeric: normal;
	}

	.fact-link {
		text-decoration: none;
		color: var(--text-primary);
		border-bottom: 1px dashed var(--text-quaternary);
		transition: border-color 180ms ease-out, padding-left 180ms ease-out;
	}

	.fact-link:hover {
		border-bottom-color: var(--text-primary);
	}

	.hero-footnote {
		font-size: 0.875rem;
		color: var(--text-tertiary);
		font-style: italic;
		max-width: 42rem;
		margin: 0;
		line-height: 1.55;
	}

	/* ───────────────────────────────────────────────────────────────────
	   TOC
	   ─────────────────────────────────────────────────────────────────── */
	.toc {
		margin-bottom: 5rem;
		padding: 1.25rem 0;
	}

	.toc ol {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
		counter-reset: toc-counter;
	}

	.toc li {
		counter-increment: toc-counter;
	}

	.toc a {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.875rem;
		color: var(--text-secondary);
		text-decoration: none;
		transition: color 180ms ease-out;
	}

	.toc a::before {
		content: counter(toc-counter, decimal-leading-zero) '  ';
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		color: var(--text-quaternary);
		margin-right: 0.0625rem;
	}

	.toc a:hover {
		color: var(--text-primary);
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

	/* ───────────────────────────────────────────────────────────────────
	   TRUSTED SETUP
	   ─────────────────────────────────────────────────────────────────── */
	.srs-body {
		max-width: 44rem;
	}

	.srs-fact-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 1.5rem 2rem;
		padding: 1.5rem 0;
		margin-bottom: 1.75rem;
		border-top: 1px solid var(--coord-node-border);
		border-bottom: 1px solid var(--coord-node-border);
	}

	.srs-fact {
		display: flex;
		flex-direction: column;
		gap: 0.3125rem;
		align-items: baseline;
	}

	.srs-fact-label {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-quaternary);
	}

	.srs-fact-value {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.9375rem;
		color: var(--text-primary);
	}

	.srs-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0;
	}

	.srs-fact-suffix {
		font-family: 'JetBrains Mono', monospace;
		font-size: 1rem;
		color: var(--text-tertiary);
		margin-left: 0.125rem;
	}

	.srs-prose {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		line-height: 1.65;
		margin: 0 0 1rem 0;
	}

	.srs-prose em {
		color: var(--text-primary);
		font-style: italic;
	}

	.srs-prose:last-child {
		margin-bottom: 0;
	}

	/* ───────────────────────────────────────────────────────────────────
	   KNOWN LIMITATIONS — prominent
	   ─────────────────────────────────────────────────────────────────── */
	.section-limitations {
		padding-top: 3rem;
		border-top: 2px solid var(--coord-node-border);
	}

	.limits {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.limit {
		padding: 1.25rem 0 1.5rem 1.25rem;
		border-left: 2px solid rgba(0, 0, 0, 0.08);
	}

	.limit h3 {
		font-family: 'Satoshi', sans-serif;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0 0 0.25rem 0;
	}

	.limit-status {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.8125rem;
		font-style: italic;
		color: var(--text-tertiary);
		margin: 0 0 0.625rem 0;
	}

	.limit p:not(.limit-status) {
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
