import { createTrustedPagesReleaseEdge } from './trusted-pages-release-edge';

declare const TRUSTED_RELEASE_SOURCE_SHA: string;

export default createTrustedPagesReleaseEdge({ sourceSha: TRUSTED_RELEASE_SOURCE_SHA });
