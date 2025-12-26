/**
 * Agoric Iframe Sandbox - Entry Point
 *
 * This is a standalone bundle that runs in an isolated iframe.
 * All Agoric SDK dependencies are bundled here.
 *
 * Communication with parent window via postMessage API.
 *
 * IMPORTANT: installLockdownSES MUST be imported first to ensure
 * SES lockdown is applied before any other code runs.
 */

// CRITICAL: This import must be FIRST
import "./installLockdownSES.js";

import { Buffer } from "buffer";
import {
  suggestChain,
  makeAgoricWalletConnection,
} from "@agoric/web-components";
import {
  makeAgoricChainStorageWatcher,
  AgoricChainStoragePathKind as Kind,
} from "@agoric/rpc";
import { makeSignDoc } from "@cosmjs/amino";

// Make Buffer available globally for Agoric packages
globalThis.Buffer = Buffer;

console.log("[Agoric Sandbox] Loading v1.0.0");

// Update SES status in UI
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const sesStatus = document.getElementById("ses-status");
    if (sesStatus) {
      sesStatus.textContent = "Applied ✓";
      sesStatus.style.color = "#155724";
    }
  });
}

export const networkConfigs = {
  mainnet: {
    CHAIN_ID: "agoric-3",
    RPC_ENDPOINT: "https://main-a.rpc.agoric.net/:443",
    REST_ENDPOINT: "https://main-a.api.agoric.net",
    NETWORK_CONFIG_HREF: "https://followmain.agoric.net/network-config",
  },
  devnet: {
    CHAIN_ID: "agoricdev-25",
    RPC_ENDPOINT: "https://devnet.rpc.agoric.net:443",
    REST_ENDPOINT: "https://devnet.api.agoric.net",
    NETWORK_CONFIG_HREF: "https://devnet.agoric.net/network-config",
  },
  emerynet: {
    CHAIN_ID: "agoric-emerynet-9",
    RPC_ENDPOINT: "https://emerynet.rpc.agoric.net:443",
    NETWORK_CONFIG_HREF: "https://emerynet.agoric.net/network-config",
    REST_ENDPOINT: "https://emerynet.api.agoric.net",
  },
  local: {
    CHAIN_ID: "agoriclocal",
    RPC_ENDPOINT: "http://localhost:26657",
    NETWORK_CONFIG_HREF: "https://local.agoric.net/network-config",
    REST_ENDPOINT: "http://localhost:1317",
  },
};

/**
 * Get network configuration
 * @param {string | null | undefined} network - Network name
 * @returns {Object} Network configuration
 */
function getConfig(network) {
  // Normalize to default if undefined/null/empty
  const normalizedNetwork = network || "devnet";
  return networkConfigs[normalizedNetwork] || networkConfigs.devnet;
}

/**
 * @typedef {Object} TransactionData
 * @property {Object} txn - Transaction details
 * @property {string} txn.transactionHash - Transaction hash
 * @property {number} [txn.code] - Transaction code (0 = success)
 * @property {number} [txn.height] - Block height
 * @property {number} [txn.txIndex] - Transaction index in block
 * @property {string} [txn.rawLog] - Raw transaction log
 * @property {bigint} [txn.gasUsed] - Gas used
 * @property {bigint} [txn.gasWanted] - Gas wanted
 * @property {Array} [txn.events] - Transaction events
 * @property {Array} [txn.msgResponses] - Message responses
 * @property {number|string} offerId - Offer ID
 */

/**
 * @typedef {Object} OfferResult
 * @property {string} status - Offer status ("accepted", "seated", "error", "refunded")
 * @property {TransactionData} [data] - Transaction data (if available)
 */

// Brands
const BLD = {
  brandKey: "BLD",
  decimals: 6,
};

// Global state
const state = {
  network: null,
  watcher: null,
  wallet: null,
  currentWalletRecord: null,
  brands: null,
  contractInstance: null,
  accountInvitation: null,
  hasAccount: false,
  isInitialized: false,
};

/**
 * Update status UI
 */
function updateStatus(message, type = "loading") {
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = type;
  }
}

/**
 * Update wallet status UI
 */
function updateWalletStatus(status) {
  const walletEl = document.getElementById("wallet-status");
  if (walletEl) {
    walletEl.textContent = status;
  }
}

/**
 * Create watcher handlers for watching chain state
 */
function createWatcherHandlers(watcher) {
  return {
    watchInstances: () => {
      watcher.watchLatest(
        [Kind.Data, "published.agoricNames.instance"],
        (instances) => {
          console.log("[Agoric Sandbox] Got instances:", instances);
          // Find qstnRouterV1 instance
          state.contractInstance = instances.find(
            ([name]) => name === "QstnContract"
          )?.[1];

          console.log(
            "[Agoric Sandbox] Contract instance:",
            state.contractInstance
          );
        }
      );
    },

    watchBrands: () => {
      watcher.watchLatest(
        [Kind.Data, "published.agoricNames.brand"],
        (brands) => {
          console.log("[Agoric Sandbox] Got brands:", brands);
          // Convert array of tuples to object
          state.brands = Object.fromEntries(brands);
        }
      );
    },
  };
}

/**
 * Setup Chain Storage Watcher
 *
 * This must be called BEFORE connecting the wallet!
 * The watcher monitors chain state and provides data to the wallet connection.
 */

/**
 * Sign data with wallet
 * @param {Object} params
 * @param {string | null | undefined} params.network - Network to connect to
 */
async function setupWatcher({ network } = {}) {
  try {
    // Normalize network at entry point
    const targetNetwork = network || "devnet";

    console.log("[Agoric Sandbox] Setting up chain storage watcher...");
    updateStatus("Initializing chain storage watcher...", "loading");

    const config = getConfig(targetNetwork);

    // Initialize watcher with REST API endpoint and chain ID
    const watcher = makeAgoricChainStorageWatcher(
      config.REST_ENDPOINT,
      config.CHAIN_ID
    );

    // Store watcher - CRITICAL: Must exist before wallet connection!
    state.watcher = watcher;

    state.network = targetNetwork;

    // Create and use watcher handlers
    const handlers = createWatcherHandlers(watcher);
    handlers.watchInstances();
    handlers.watchBrands();

    console.log("[Agoric Sandbox] Watcher setup complete");
    return watcher;
  } catch (error) {
    console.error("[Agoric Sandbox] Watcher setup failed:", error);
    updateStatus(`Watcher setup failed: ${error.message}`, "error");
    throw error;
  }
}

/**
 * Connect to Keplr Wallet
 *
 * IMPORTANT: Watcher must be initialized before calling this!
 */
/**
 * Sign data with wallet
 * @param {Object} params
 * @param {string | null | undefined} params.network - Network to connect to
 */
async function connectWallet({ network } = {}) {
  try {
    // Normalize network at entry point
    const targetNetwork = network || "devnet";

    console.log("[Agoric Sandbox] Connecting wallet...");
    updateStatus("Connecting to Keplr...", "loading");
    updateWalletStatus("Connecting...");

    // CRITICAL: Check if watcher exists first!
    if (!state.watcher || targetNetwork !== state.network) {
      console.log(
        "[Agoric Sandbox] Watcher not initialized or network changed, setting up..."
      );
      await setupWatcher({ network: targetNetwork });
      // Wait a bit for watcher to sync initial data
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Check if Keplr is installed
    if (!window.keplr) {
      throw new Error("KEPLR_NOT_INSTALLED");
    }

    // Suggest Agoric chain to Keplr
    console.log("[Agoric Sandbox] Suggesting chain to Keplr...");

    const config = getConfig(targetNetwork);
    await suggestChain(config.NETWORK_CONFIG_HREF);

    // Make Agoric wallet connection
    // Pass watcher as first parameter, RPC endpoint as second
    console.log("[Agoric Sandbox] Creating wallet connection...");
    const wallet = await makeAgoricWalletConnection(
      state.watcher,
      config.RPC_ENDPOINT
    );

    state.wallet = wallet;

    console.log("[Agoric Sandbox] Wallet connected:", wallet.address);

    updateStatus(`Connected: ${wallet.address.slice(0, 12)}...`, "success");
    updateWalletStatus(
      `${wallet.address.slice(0, 12)}...${wallet.address.slice(-6)}`
    );

    // Start watching wallet to get currentWalletRecord
    watchWallet();

    // Wait for wallet record to be available
    console.log("[Agoric Sandbox] Waiting for wallet record...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if account already exists and store in state
    const existingAccount = getAccountInvitation();
    if (existingAccount) {
      console.log(
        "[Agoric Sandbox] Found existing account:",
        existingAccount.id
      );
      state.accountInvitation = existingAccount;
      state.hasAccount = true;
    } else {
      console.log(
        "[Agoric Sandbox] No existing account found - will be created on first action"
      );
    }

    return { address: wallet.address };
  } catch (error) {
    console.error("[Agoric Sandbox] Connection failed:", error);
    updateStatus(`Connection failed: ${error.message}`, "error");
    updateWalletStatus("Connection failed");

    // Normalize error
    if (error.message === "KEPLR_NOT_INSTALLED") {
      throw {
        code: "KEPLR_NOT_INSTALLED",
        message: "Keplr wallet extension not found",
      };
    }
    throw { code: "CONNECTION_FAILED", message: error.message };
  }
}

/**
 * Watch Wallet State
 *
 * NOTE: Requires watcher to be set up
 */
function watchWallet() {
  try {
    console.log("[Agoric Sandbox] Setting up wallet state watcher...");

    if (!state.watcher || !state.wallet) {
      console.warn(
        "[Agoric Sandbox] Watcher or wallet not initialized, skipping wallet watch"
      );
      return;
    }

    // Watch wallet state for offer updates using Kind.Data prefix
    state.watcher.watchLatest(
      [Kind.Data, `published.wallet.${state.wallet.address}.current`],
      (currentWalletRecord) => {
        if (!currentWalletRecord) {
          return;
        }
        console.log(
          "[Agoric Sandbox] Wallet state updated:",
          currentWalletRecord
        );
        state.currentWalletRecord = currentWalletRecord;
      }
    );

    console.log("[Agoric Sandbox] Wallet state watcher active");
  } catch (error) {
    console.error("[Agoric Sandbox] Failed to watch wallet:", error);
  }
}

/**
 * Get the QSTN account invitation from wallet records
 * Checks if user has already created a QSTN account
 *
 * @returns {{ id: string, invitation: any } | null} Account invitation details or null
 */
function getAccountInvitation() {
  if (!state.currentWalletRecord) {
    console.log("[Agoric Sandbox] No wallet record available");
    watchWallet();
  }

  console.log("[Agoric Sandbox] Checking for existing account invitation...");

  const invitation = state.currentWalletRecord.offerToUsedInvitation
    .filter((inv) => {
      const value = inv[1]?.value;
      if (Array.isArray(value) && value[0]) {
        const description = value[0].description;
        console.log(
          "[Agoric Sandbox] Found invitation with description:",
          description
        );
        return description === "qstnAccountKitInvitation";
      }
      return false;
    })
    .sort((a, b) => b[0].localeCompare(a[0])) // Sort descending to get latest
    .at(0); // Get the most recent one

  if (invitation) {
    console.log(
      "[Agoric Sandbox] Found existing account invitation:",
      invitation[0]
    );
    return {
      id: invitation[0],
      invitation: invitation[1],
    };
  }

  console.log("[Agoric Sandbox] No account invitation found");
  return null;
}

/**
 * Extract error message from various error formats
 */
function getErrorMessage(error) {
  // Handle Error objects
  if (error instanceof Error) {
    return error.message;
  }

  // Handle error objects with message property
  if (error && typeof error === "object" && "message" in error) {
    return error.message;
  }

  // Handle string errors
  if (typeof error === "string") {
    return error;
  }

  // Try to stringify as last resort, but handle circular references
  try {
    const stringified = JSON.stringify(error);
    // Don't return empty object or null
    if (stringified === "{}" || stringified === "null") {
      return String(error);
    }
    return stringified;
  } catch (e) {
    return String(error);
  }
}

/**
 * Get the last transaction for the current wallet address from Cosmos API
 * This is used as a fallback when offer status updates don't include transaction data
 *
 * @returns {Promise<TransactionData|null>} Transaction data or null if not found
 */
async function getLastTransaction() {
  try {
    if (!state.wallet || !state.network) {
      console.warn(
        "[Agoric Sandbox] Cannot fetch transaction: wallet or network not initialized"
      );
      return null;
    }

    const config = getConfig(state.network);
    const address = state.wallet.address;

    const eventsQuery = `message.sender='${address}'`;
    const url = `${
      config.REST_ENDPOINT
    }/cosmos/tx/v1beta1/txs?events=${encodeURIComponent(
      eventsQuery
    )}&order_by=ORDER_BY_DESC&limit=1`;

    console.log("[Agoric Sandbox] Fetching last transaction from:", url);

    const response = await fetch(url);
    if (!response.ok) {
      console.error(
        "[Agoric Sandbox] Failed to fetch transaction:",
        response.status
      );
      return null;
    }

    const data = await response.json();

    if (!data.tx_responses || data.tx_responses.length === 0) {
      console.log("[Agoric Sandbox] No transactions found for address");
      return null;
    }

    const txResponse = data.tx_responses[0];

    // Extract only the essential data: txHash and offerId
    const txData = {
      txn: {
        transactionHash: txResponse.txhash || "",
      },
      offerId: Date.now(), // Fallback offerId since we can't determine it from the transaction
    };

    console.log(
      "[Agoric Sandbox] Fetched last transaction:",
      txData.txn.transactionHash
    );
    return txData;
  } catch (error) {
    console.error("[Agoric Sandbox] Error fetching last transaction:", error);
    return null;
  }
}

/**
 * Make an offer using the smart wallet
 *
 * NOTE: This is the core function for interacting with Agoric smart contracts
 * Automatically handles proposal creation, account routing, and state management
 *
 * @param {Object} params
 * @param {Array} params.messages - Transaction messages
 * @param {string} params.totalAmount - Total amount to send
 * @param {string} params.denom - Token denomination (e.g., "ubld")
 * @returns {Promise<OfferResult>} Offer result with status and transaction data
 */
async function makeOffer({ messages, totalAmount, denom }) {
  // Validate state
  if (!state.wallet) {
    throw new Error("Wallet not connected. Call connectWallet() first.");
  }

  if (!state.contractInstance) {
    throw new Error(
      "Contract not found. Ensure contract instance or installation are loaded."
    );
  }

  if (!state.brands) {
    throw new Error("Brands not loaded. Wait for chain storage to sync.");
  }

  // Get brand and create proposal
  const brandKey = denom.toUpperCase() === "UBLD" ? "BLD" : denom.toUpperCase();
  const brand = state.brands?.[brandKey];

  if (!brand) {
    throw new Error(
      `Brand not found for ${brandKey}. Available brands: ${Object.keys(
        state.brands || {}
      ).join(", ")}`
    );
  }

  console.log("here");

  console.log("[Agoric Sandbox] Using brand:", brandKey, brand);

  const proposal = {
    give: {
      Deposit: {
        brand,
        value: BigInt(totalAmount),
      },
    },
    want: {},
  };

  console.log("[Agoric Sandbox]", proposal);

  // Handle automatic account routing
  let invitationSpec;
  let offerArgs;
  let accountWasCreated = false;

  // Check if account exists - get fresh invitation each time
  const accountInvitation = getAccountInvitation();

  if (accountInvitation) {
    // ROUTE A: Account exists - use continuing invitation
    console.log(
      "[Agoric Sandbox] Using existing account:",
      accountInvitation.id
    );

    invitationSpec = {
      source: "continuing",
      previousOffer: accountInvitation.id,
      invitationMakerName: "makeTransactionInvitation",
      invitationArgs: harden(["sendTransactions", [{ messages }]]),
    };
    offerArgs = {}; // Args are in invitationArgs
  } else {
    // ROUTE B: No account - use public invitation (creates account + performs action)
    console.log(
      "[Agoric Sandbox] No account found - will create account and perform action in one transaction"
    );

    invitationSpec = {
      source: "contract",
      instance: state.contractInstance,
      publicInvitationMaker: "createQstnAccountKit",
    };
    offerArgs = { messages }; // Pass messages in offerArgs
    accountWasCreated = true;
  }

  console.log("[Agoric Sandbox] Making offer:", {
    invitationSpec,
    proposal,
    offerArgs,
  });

  return new Promise((resolve, reject) => {
    // Store transaction data from seated status
    let seatedData = null;

    try {
      state.wallet.makeOffer(
        invitationSpec,
        proposal,
        offerArgs,
        async (update) => {
          console.log("[Agoric Sandbox] Offer status update:", update);

          switch (update.status) {
            case "error": {
              const errorMsg = getErrorMessage(update.data);
              console.error("[Agoric Sandbox] Offer error:", errorMsg);
              reject(new Error(errorMsg));
              break;
            }
            case "seated":
              console.log("[Agoric Sandbox] Offer seated (pending)");
              seatedData = update.data;
              break;

            case "accepted":
              console.log("[Agoric Sandbox] Offer accepted!");

              if (accountWasCreated) {
                console.log(
                  "[Agoric Sandbox] Account created, fetching invitation..."
                );

                await new Promise((res) => setTimeout(res, 2000));

                const newAccountInvitation = getAccountInvitation();
                if (newAccountInvitation) {
                  state.accountInvitation = newAccountInvitation;
                  state.hasAccount = true;
                  console.log(
                    "[Agoric Sandbox] Account invitation stored:",
                    newAccountInvitation.id
                  );
                }
              }

              // Use seatedData if available, otherwise try update.data, otherwise fetch from API
              let finalData = seatedData || update.data;

              // If no transaction data available, fetch last transaction from API
              if (!finalData || !finalData.txn) {
                console.log(
                  "[Agoric Sandbox] No transaction data in status updates, fetching from API..."
                );
                const apiTxData = await getLastTransaction();
                if (apiTxData) {
                  finalData = apiTxData;
                  console.log(
                    "[Agoric Sandbox] Using transaction data from API:",
                    apiTxData.txn.transactionHash
                  );
                } else {
                  console.warn(
                    "[Agoric Sandbox] Could not fetch transaction data from API"
                  );
                }
              }

              resolve({
                status: "accepted",
                data: finalData,
              });
              break;

            case "refunded":
              console.warn("[Agoric Sandbox] Offer refunded");
              reject(new Error("Offer was refunded (wants not satisfied)"));
              break;

            default:
              console.log("[Agoric Sandbox] Offer status:", update.status);
          }
        }
      );
    } catch (error) {
      console.error("[Agoric Sandbox] makeOffer failed:", error);
      reject(error);
    }
  });
}
async function makeADR036AminoDoc(message, signerAddr) {
  return makeSignDoc(
    [
      {
        type: "sign/MsgSignData",
        value: {
          signer: signerAddr,
          data: Buffer.from(message).toString("base64"),
        },
      },
    ],
    { gas: "0", amount: [] },
    "",
    undefined,
    0,
    0
  );
}

/**
 * Sign data with wallet
 * @param {Object} params
 * @param {string} params.payload - Data to sign
 * @returns {Promise<{signedData: Object, signature: Object}>} Signed data with pub key and signature
 */
async function signData({ data }) {
  try {
    console.log("[Agoric Sandbox] Signing data:", data);
    updateStatus("Signing data...", "loading");

    const { keplr } = window;

    if (!keplr) {
      throw new Error("Keplr wallet not found");
    }

    // Ensure wallet is connected
    if (!state.wallet) {
      await connectWallet({ network: state.network });
    }

    const signDoc = await makeADR036AminoDoc(data, state.wallet.address);

    const config = getConfig(state.network);

    const signResponse = await keplr.signAmino(
      config.CHAIN_ID,
      state.wallet.address,
      signDoc
    );

    return {
      signedData: signResponse.signed,
      signature: signResponse.signature,
    };
  } catch (error) {
    console.error("[Agoric Sandbox] Data signing failed:", error);
    updateStatus(`Signing failed: ${error.message}`, "error");
    throw { code: "SIGNING_FAILED", message: error.message };
  }
}

/**
 * Fund a survey
 *
 * TODO: Replace with your actual contract interaction
 */
async function fundSurvey({ surveyId, messages, denom, totalAmount }) {
  try {
    console.log("[Agoric Sandbox] Funding survey:", {
      surveyId,
      totalAmount,
      denom,
    });
    updateStatus(`Funding survey ${surveyId}...`, "loading");

    // Ensure wallet is connected
    if (!state.wallet) {
      await connectWallet();
    }

    // Make the offer - makeOffer handles everything (brand, proposal, account routing)
    const result = await makeOffer({
      messages,
      totalAmount,
      denom,
    });

    updateStatus(`Survey funded! Offer accepted.`, "success");

    return {
      success: true,
      offerId: result.data?.offerId || "unknown",
      txHash: result.data?.txn?.transactionHash || "unknown",
      height: 0,
    };
  } catch (error) {
    console.error("[Agoric Sandbox] Fund survey failed:", error);
    const errorMsg = getErrorMessage(error);
    updateStatus(`Transaction failed: ${errorMsg}`, "error");

    throw { code: "TRANSACTION_FAILED", message: errorMsg };
  }
}

/**
 * Claim rewards
 *
 * TODO: Replace with your actual contract interaction
 */
async function claimRewards({ surveyId, messages, denom, totalAmount }) {
  try {
    console.log("[Agoric Sandbox] Claiming rewards:", {
      surveyId,
      totalAmount,
    });
    updateStatus(`Claiming rewards for survey ${surveyId}...`, "loading");

    // Ensure wallet is connected
    if (!state.wallet) {
      await connectWallet();
    }

    // Make the offer - makeOffer handles everything (brand, proposal, account routing)
    const result = await makeOffer({
      messages,
      totalAmount,
      denom,
    });

    updateStatus(`Rewards claimed!`, "success");

    return {
      success: true,
      offerId: result.data?.offerId || "unknown",
      txHash: result.data?.txn?.transactionHash || "unknown",
      height: 0,
    };
  } catch (error) {
    console.error("[Agoric Sandbox] Claim rewards failed:", error);
    const errorMsg = getErrorMessage(error);
    updateStatus(`Claim failed: ${errorMsg}`, "error");

    throw { code: "CLAIM_FAILED", message: errorMsg };
  }
}

/**
 * Initialize the sandbox
 */
async function initialize() {
  try {
    console.log("[Agoric Sandbox] Initializing...");
    updateStatus("Initializing sandbox...", "loading");

    // Setup chain storage watcher
    // This initializes the watcher that will be used by wallet connection
    console.log("[Agoric Sandbox] Setting up watcher...");
    await setupWatcher({ network: "mainnet" });

    // Wait for watcher to sync initial data (brands, instances, etc.)
    console.log("[Agoric Sandbox] Waiting for initial chain data sync...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    state.isInitialized = true;
    state.network = "mainnet";

    updateStatus("Sandbox ready - waiting for commands", "success");
    console.log("[Agoric Sandbox] Ready to receive messages");

    // Notify parent that sandbox is ready
    window.parent.postMessage(
      {
        type: "AGORIC_READY",
      },
      "*"
    );
  } catch (error) {
    console.error("[Agoric Sandbox] Initialization failed:", error);
    updateStatus(`Initialization failed: ${error.message}`, "error");
    throw error;
  }
}

/**
 * Message handler for parent window communication
 */
window.addEventListener("message", async (event) => {
  // const allowedOrigins = ["https://yourdomain.com", "http://localhost:3000"];

  // if (!allowedOrigins.includes(event.origin)) {
  //   console.error("[Agoric Sandbox] Invalid origin:", event.origin);
  //   return;
  // }

  const { type, data, id } = event.data;

  // Ignore our own response messages
  if (type === "AGORIC_RESPONSE" || type === "AGORIC_READY") {
    return;
  }

  console.log("[Agoric Sandbox] Received message:", type, data);

  try {
    let result;

    switch (type) {
      case "CONNECT_WALLET":
        result = await connectWallet(data);
        break;

      case "SIGN_DATA":
        result = await signData(data);
        break;

      case "FUND_SURVEY":
        result = await fundSurvey(data);
        break;

      case "CLAIM_REWARDS":
        result = await claimRewards(data);
        break;

      case "GET_STATUS":
        result = {
          initialized: state.isInitialized,
          connected: !!state.wallet,
          address: state.wallet?.address || null,
          hasBrands: !!state.brands,
          hasInstance: !!state.contractInstance,
          hasAccount: state.hasAccount,
          accountInvitationId: state.accountInvitation?.id || null,
          brandsAvailable: state.brands ? Object.keys(state.brands) : [],
          network: state.network,
        };
        break;

      default:
        console.warn("[Agoric Sandbox] Unknown message type:", type);
        return; // Don't throw, just ignore unknown messages
    }

    // Send success response
    window.parent.postMessage(
      {
        type: "AGORIC_RESPONSE",
        id,
        success: true,
        data: result,
      },
      "*"
    );
  } catch (error) {
    console.error("[Agoric Sandbox] Message handler error:", error);

    // Send error response
    window.parent.postMessage(
      {
        type: "AGORIC_RESPONSE",
        id,
        success: false,
        error: {
          code: error.code || "UNKNOWN_ERROR",
          message: error.message || "An unknown error occurred",
        },
      },
      "*"
    );
  }
});

// Initialize on load
initialize().catch(console.error);
