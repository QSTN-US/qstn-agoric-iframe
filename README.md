# Agoric Iframe Sandbox

An isolated iframe component for the QSTN application that handles all Agoric blockchain interactions. This sandbox runs in a separate domain to prevent SES (Secure EcmaScript) lockdown conflicts with the main QSTN frontend.

## Purpose

The QSTN main application requires interaction with the Agoric blockchain for survey funding and reward distribution. However, the Agoric SDK applies SES lockdown, which hardens JavaScript built-ins and conflicts with React and other dependencies in the main app. This sandbox solves that problem by isolating all Agoric code in a cross-origin iframe.

## Architecture

The sandbox is deployed to Vercel as a separate application and loaded by the QSTN frontend via iframe. Communication between the main app and sandbox occurs through the PostMessage API.

**Main App**: `https://qstn.us` (or localhost:3000)
**Sandbox**: `https://agoric-sandbox.vercel.app` (separate deployment)

This cross-origin isolation ensures:

- SES lockdown only affects the iframe environment
- React and other dependencies in the main app remain unaffected
- Secure message passing between contexts

## Deployment

The sandbox is deployed to Vercel:

```bash
npm run build
vercel --prod
```

Build output in `dist/`:

- `agoric-sandbox.html` - Entry point
- `agoric-sandbox.[hash].js` - Bundled JavaScript

The QSTN main app references the deployed URL in its environment configuration:

```bash
# qstn-v1-frontend/.env
REACT_APP_AGORIC_IFRAME_URL=https://agoric-sandbox.vercel.app/agoric-sandbox.html
```

## Network Configuration

The sandbox connects to the Agoric devnet:

```javascript
const CONFIG = {
  CHAIN_ID: "agoricdev-25",
  RPC_ENDPOINT: "https://devnet.rpc.agoric.net:443",
  REST_ENDPOINT: "https://devnet.api.agoric.net",
  NETWORK_CONFIG_HREF: "https://devnet.agoric.net/network-config",
};
```

## Contract Integration

The sandbox watches for the `qstnRouterV1` contract instance from published chain state and uses the `makeSendTransactionInvitation` public invitation maker for all contract interactions.

## API

The QSTN main app sends messages to the iframe using these message types:

### CONNECT_WALLET

Establishes connection to the user's Keplr wallet.

```javascript
// Main app sends
{ type: 'CONNECT_WALLET', id: 'request-id' }

// Sandbox responds
{
  type: 'AGORIC_RESPONSE',
  id: 'request-id',
  success: true,
  data: { address: 'agoric1...' }
}
```

### SIGN_DATA

Signs arbitrary data using ADR-036 Amino format.

```javascript
// Main app sends
{
  type: 'SIGN_DATA',
  id: 'request-id',
  data: { data: 'message-to-sign' }
}

// Sandbox responds
{
  type: 'AGORIC_RESPONSE',
  id: 'request-id',
  success: true,
  data: {
    signedData: { /* SignDoc */ },
    signature: { /* Signature */ }
  }
}
```

### FUND_SURVEY

Creates a smart wallet offer to fund a survey contract.

```javascript
// Main app sends
{
  type: 'FUND_SURVEY',
  id: 'request-id',
  data: {
    surveyId: 'survey-123',
    messages: [/* cosmos messages */],
    denom: 'ubld',
    totalAmount: '1000000'
  }
}

// Sandbox responds
{
  type: 'AGORIC_RESPONSE',
  id: 'request-id',
  success: true,
  data: {
    success: true,
    offerId: 'offer-id',
    txHash: '0x...',
    height: 0
  }
}
```

### CLAIM_REWARDS

Creates a smart wallet offer to claim survey rewards.

```javascript
// Main app sends
{
  type: 'CLAIM_REWARDS',
  id: 'request-id',
  data: {
    surveyId: 'survey-123',
    messages: [/* cosmos messages */],
    denom: 'ubld',
    totalAmount: '1000000'
  }
}

// Sandbox responds
{
  type: 'AGORIC_RESPONSE',
  id: 'request-id',
  success: true,
  data: {
    success: true,
    offerId: 'offer-id',
    txHash: '0x...',
    height: 0
  }
}
```

### GET_STATUS

Returns the current state of the sandbox.

```javascript
// Main app sends
{ type: 'GET_STATUS', id: 'request-id' }

// Sandbox responds
{
  type: 'AGORIC_RESPONSE',
  id: 'request-id',
  success: true,
  data: {
    initialized: true,
    connected: true,
    address: 'agoric1...',
    hasBrands: true,
    hasInstance: true,
    brandsAvailable: ['BLD', 'IST']
  }
}
```

### Error Responses

Failed operations return error responses:

```javascript
{
  type: 'AGORIC_RESPONSE',
  id: 'request-id',
  success: false,
  error: {
    code: 'ERROR_CODE',
    message: 'Human-readable error message'
  }
}
```

**Error Codes:**

- `KEPLR_NOT_INSTALLED` - Keplr extension not found
- `CONNECTION_FAILED` - Wallet connection failed
- `WALLET_NOT_CONNECTED` - Operation requires connected wallet
- `SIGNING_FAILED` - Data signing failed
- `TRANSACTION_FAILED` - Contract interaction failed
- `USER_REJECTED` - User rejected the transaction
- `INSUFFICIENT_FUNDS` - Insufficient balance for transaction
- `INVALID_BRAND` - Token brand not found in chain state

## Initialization Sequence

When loaded, the sandbox:

1. Applies SES lockdown before any other code executes
2. Initializes the chain storage watcher and connects to Agoric REST API
3. Watches for contract instances and token brands in published chain state
4. Sends `AGORIC_READY` message to the parent window
5. Waits for `CONNECT_WALLET` message from the QSTN main app
6. After wallet connection, monitors wallet state for offer updates

## Security

The sandbox currently accepts messages from any origin. For production, origin validation is implemented in the main app's iframe handler to ensure only the QSTN frontend can communicate with the sandbox.

The parent application's Content Security Policy allows the sandbox iframe:

```
Content-Security-Policy: frame-src https://agoric-sandbox.vercel.app;
```

## Development

**Production Build:**

```bash
npm run build
```

**Watch Mode:**

```bash
npm run watch
```

**Development Server:**

```bash
npm run dev  # Opens localhost:8080
```

## Dependencies

**Runtime:**

- `@agoric/web-components` - Wallet connection utilities
- `@agoric/rpc` - Chain storage watcher
- `ses` - Secure EcmaScript lockdown
- `@cosmjs/amino` - Transaction signing
- `buffer` - Node.js Buffer polyfill

**Build:**

- `webpack` - Module bundler
- `babel-loader` - JavaScript transpilation
- `html-webpack-plugin` - HTML generation

## Bundle Size

- Uncompressed: ~3-4 MB
- Gzipped: ~800 KB

The bundle is large due to the Agoric SDK. The QSTN main app lazy-loads the iframe only when blockchain interactions are needed.

## Browser Compatibility

- Chrome/Edge: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Version 12+
- Mobile: Limited (requires Keplr extension)

## License

MIT
