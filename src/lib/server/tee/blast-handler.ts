/**
 * Enclave blast handler — calls the Nitro Enclave parent instance
 * to trigger a TEE-mediated email blast.
 *
 * The parent instance:
 * 1. Receives the request via HTTPS
 * 2. Forwards sealedOrgKey + encrypted supporters to the enclave via vsock
 * 3. Enclave unseals org key via KMS (PCR0-gated)
 * 4. Enclave decrypts supporter emails in enclave memory
 * 5. Enclave sends via SES through vsock-proxy
 * 6. Returns results via vsock → parent → caller
 */

export interface EnclaveBlastRequest {
  sealedOrgKey: string;
  supporters: Array<{
    encryptedEmail: string;
    emailHash: string;
  }>;
  blast: {
    subject: string;
    bodyHtml: string;
    fromEmail: string;
    fromName: string;
    blastId: string;
  };
}

export interface EnclaveBlastResult {
  totalSent: number;
  totalFailed: number;
  results: Array<{
    emailHash: string;
    status: 'sent' | 'failed';
    error?: string;
  }>;
}

/**
 * Call the enclave parent instance to trigger a blast.
 * The enclave is the only place where the org decryption key and
 * plaintext supporter emails exist — both are purged after the send.
 */
export async function triggerEnclaveBlast(
  request: EnclaveBlastRequest
): Promise<EnclaveBlastResult> {
  const enclaveHost = process.env.ENCLAVE_PARENT_HOST;

  if (!enclaveHost) {
    console.warn('[TEE Blast] ENCLAVE_PARENT_HOST not set — blast send unavailable');
    throw new Error('TEE blast infrastructure not configured');
  }

  const response = await fetch(`https://${enclaveHost}/enclave/blast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Enclave blast failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}
