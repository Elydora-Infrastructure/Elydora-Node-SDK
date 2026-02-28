# @elydora/sdk

Node.js/TypeScript SDK for the Elydora tamper-evident audit platform.

## Installation

```bash
npm install @elydora/sdk
```

Requires Node.js 18+ (uses built-in `crypto` module with Ed25519 support).

## Quick Start

```typescript
import { ElydoraClient } from '@elydora/sdk';

// 1. Authenticate
const auth = await ElydoraClient.login('https://api.elydora.com', 'user@example.com', 'password');

// 2. Create client
const client = new ElydoraClient({
  orgId: auth.user.org_id,
  agentId: 'my-agent-id',
  privateKey: '<base64url-encoded-32-byte-ed25519-seed>',
  baseUrl: 'https://api.elydora.com',
});
client.setToken(auth.token);

// 3. Create and submit an operation
const eor = client.createOperation({
  operationType: 'data.access',
  subject: { user_id: 'u-123', resource: 'patient-record' },
  action: { type: 'read', scope: 'full' },
  payload: { record_id: 'rec-456' },
});

const { receipt } = await client.submitOperation(eor);
console.log('Operation submitted:', receipt.operation_id);
```

## API Reference

### Static Methods

- `ElydoraClient.register(baseUrl, email, password, displayName?, orgName?)` — Register a new user and organization
- `ElydoraClient.login(baseUrl, email, password)` — Authenticate and receive a JWT

### Instance Methods

#### Agent Management
- `registerAgent(request)` — Register a new agent with public keys
- `getAgent(agentId)` — Retrieve agent details
- `freezeAgent(agentId, reason)` — Freeze an agent
- `revokeKey(agentId, kid, reason)` — Revoke an agent key

#### Operations
- `createOperation(params)` — Construct and sign an EOR locally (synchronous)
- `submitOperation(eor)` — Submit a signed EOR to the API
- `getOperation(operationId)` — Retrieve an operation
- `verifyOperation(operationId)` — Verify operation integrity

#### Audit
- `queryAudit(params)` — Query the audit log

#### Epochs
- `listEpochs()` — List all epochs
- `getEpoch(epochId)` — Retrieve an epoch

#### Exports
- `createExport(params)` — Create a compliance export
- `listExports()` — List all exports
- `getExport(exportId)` — Retrieve export status

#### JWKS
- `getJWKS()` — Retrieve platform public keys

## Cryptographic Details

- **Ed25519**: Signs operations using Node.js built-in `crypto` module
- **Chain hashing**: `SHA-256(prev_chain_hash | payload_hash | operation_id | issued_at)`
- **JCS**: RFC 8785 JSON Canonicalization Scheme for deterministic serialization
- **Base64url**: RFC 4648 section 5, no padding

## License

MIT
