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

// Configuration
const CONFIG = {
  CHAIN_ID: "agoricdev-25",
  RPC_ENDPOINT: "https://devnet.rpc.agoric.net:443",
  REST_ENDPOINT: "https://devnet.api.agoric.net",
  NETWORK_CONFIG_HREF: "https://devnet.agoric.net/network-config",
};

// Brands
const BLD = {
  brandKey: "BLD",
  decimals: 6,
};

// Global state
const state = {
  watcher: null,
  wallet: null,
  account: null,
  currentWalletRecord: null,
  brands: null,
  contractInstance: null,
  contractInstallation: null,
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
          // Find qstnContract instance
          state.contractInstance = instances.find(
            ([name]) => name === "qstnContract"
          )?.[1];

          console.log(
            "[Agoric Sandbox] Contract instance:",
            state.contractInstance
          );
        }
      );
    },

    watchInstallations: () => {
      watcher.watchLatest(
        [Kind.Data, "published.agoricNames.installation"],
        (installations) => {
          console.log("[Agoric Sandbox] Got installations:", installations);
          // Find qstnContract installation
          state.contractInstallation = installations.find(
            ([name]) => name === "qstnRouterV2"
          )?.[1];

          console.log(
            "[Agoric Sandbox] Contract installation:",
            state.contractInstallation
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
async function setupWatcher() {
  try {
    console.log("[Agoric Sandbox] Setting up chain storage watcher...");
    updateStatus("Initializing chain storage watcher...", "loading");

    // Initialize watcher with REST API endpoint and chain ID
    const watcher = makeAgoricChainStorageWatcher(
      CONFIG.REST_ENDPOINT,
      CONFIG.CHAIN_ID
    );

    // Store watcher - CRITICAL: Must exist before wallet connection!
    state.watcher = watcher;

    // Create and use watcher handlers
    const handlers = createWatcherHandlers(watcher);
    handlers.watchInstances();
    handlers.watchBrands();
    handlers.watchInstallations();

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
async function connectWallet() {
  try {
    console.log("[Agoric Sandbox] Connecting wallet...");
    updateStatus("Connecting to Keplr...", "loading");
    updateWalletStatus("Connecting...");

    // CRITICAL: Check if watcher exists first!
    if (!state.watcher) {
      console.log("[Agoric Sandbox] Watcher not initialized, setting up...");
      await setupWatcher();
      // Wait a bit for watcher to sync initial data
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Check if Keplr is installed
    if (!window.keplr) {
      throw new Error("KEPLR_NOT_INSTALLED");
    }

    // Suggest Agoric chain to Keplr
    console.log("[Agoric Sandbox] Suggesting chain to Keplr...");
    await suggestChain(CONFIG.NETWORK_CONFIG_HREF);

    // Make Agoric wallet connection
    // Pass watcher as first parameter, RPC endpoint as second
    console.log("[Agoric Sandbox] Creating wallet connection...");
    const wallet = await makeAgoricWalletConnection(
      state.watcher,
      CONFIG.RPC_ENDPOINT
    );

    state.wallet = wallet;

    const account = await wallet.signingClient.getAccount();

    if (!account) {
      throw new Error("Failed to retrieve account from wallet");
    }

    state.account = account;

    console.log("[Agoric Sandbox] Wallet account pubkey:", account.pubkey);

    console.log("[Agoric Sandbox] Wallet connected:", wallet.address);

    updateStatus(`Connected: ${wallet.address.slice(0, 12)}...`, "success");
    updateWalletStatus(
      `${wallet.address.slice(0, 12)}...${wallet.address.slice(-6)}`
    );

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
 * Make an offer using the smart wallet
 *
 * NOTE: This is the core function for interacting with Agoric smart contracts
 */
async function makeOffer({ invitationSpec, proposal, offerArgs = {} }) {
  console.log("[Agoric Sandbox] Making offer:", {
    invitationSpec,
    proposal,
    offerArgs,
  });
  // Validate state
  if (!state.wallet) {
    throw new Error("Wallet not connected. Call connectWallet() first.");
  }

  if (!state.contractInstallation && !state.contractInstance) {
    throw new Error(
      "Contract not found. Ensure contract instance or installation are loaded."
    );
  }

  if (!state.brands) {
    throw new Error("Brands not loaded. Wait for chain storage to sync.");
  }

  return new Promise((resolve, reject) => {
    try {
      state.wallet.makeOffer(invitationSpec, proposal, offerArgs, (update) => {
        console.log("[Agoric Sandbox] Offer status update:", update);

        switch (update.status) {
          case "error": {
            const errorMsg = `Offer error: ${JSON.stringify(update.data)}`;
            console.error("[Agoric Sandbox]", errorMsg);
            reject(new Error(errorMsg));
            break;
          }

          case "accepted":
            console.log("[Agoric Sandbox] Offer accepted!", update);
            resolve(update);
            break;

          case "refunded":
            console.warn("[Agoric Sandbox] Offer refunded");
            reject(new Error("Offer was refunded (wants not satisfied)"));
            break;

          case "seated":
            console.log("[Agoric Sandbox] Offer seated (pending)");
            break;

          default:
            console.log("[Agoric Sandbox] Offer status:", update.status);
        }
      });
    } catch (error) {
      console.error("[Agoric Sandbox] makeOffer failed:", error);
      reject(error);
    }
  });
}
async function makeADR036AminoDoc(message, signerAddr, chainId) {
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
    chainId,
    undefined,
    0,
    0
  );
}

/**
 * Sign data with wallet
 * @param {Object} params
 * @param {string} params.payload - Data to sign
 * @returns {Promise<{signedData: Object, pubKey: Object, signature: string}>} Signed data with pub key and signature
 */
async function signData({ payload }) {
  try {
    console.log("[Agoric Sandbox] Signing data:", payload);
    updateStatus("Signing data...", "loading");

    const { keplr } = window;

    if (!keplr) {
      throw new Error("Keplr wallet not found");
    }

    // Ensure wallet is connected
    if (!state.wallet) {
      await connectWallet();
      watchWallet();
    }

    const signDoc = await makeADR036AminoDoc(
      payload,
      state.wallet.address,
      CONFIG.CHAIN_ID
    );

    const signResponse = await keplr.signAmino(
      CONFIG.CHAIN_ID,
      state.wallet.address,
      signDoc
    );

    return {
      signedData: signResponse.signed,
      pubKey: state.account.pubKey,
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
      watchWallet();
    }

    // Get brand for the token
    const brandKey =
      denom.toUpperCase() === "UBLD" ? "BLD" : denom.toUpperCase();
    const brand = state.brands?.[brandKey];

    if (!brand) {
      throw new Error(
        `Brand not found for ${brandKey}. Available brands: ${Object.keys(
          state.brands || {}
        ).join(", ")}`
      );
    }

    console.log("[Agoric Sandbox] Using brand:", brandKey, brand);

    // TODO: Replace with your actual contract invitation spec
    const invitationSpec = {
      source: "contract",
      instance: state.contractInstallation || state.contractInstance,
      publicInvitationMaker: "makeSendTransactionInvitation",
    };

    // Create proposal with Amount
    const proposal = {
      give: {
        Payment: {
          brand,
          value: BigInt(totalAmount),
        },
      },
      want: {},
    };

    // Contract-specific arguments
    const offerArgs = {
      messages,
    };

    // Make the offer
    const result = await makeOffer({
      invitationSpec,
      proposal,
      offerArgs,
    });

    updateStatus(`Survey funded! Offer accepted.`, "success");

    return {
      success: true,
      txHash: result.data?.offerId || "unknown",
      height: 0,
    };
  } catch (error) {
    console.error("[Agoric Sandbox] Fund survey failed:", error);
    updateStatus(`Transaction failed: ${error.message}`, "error");

    let errorCode = "TRANSACTION_FAILED";
    if (
      error.message?.includes("rejected") ||
      error.message?.includes("refunded")
    ) {
      errorCode = "USER_REJECTED";
    } else if (error.message?.includes("insufficient")) {
      errorCode = "INSUFFICIENT_FUNDS";
    } else if (error.message?.includes("not connected")) {
      errorCode = "WALLET_NOT_CONNECTED";
    } else if (error.message?.includes("Brand not found")) {
      errorCode = "INVALID_BRAND";
    }

    throw { code: errorCode, message: error.message };
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
      watchWallet();
    }

    // Get brand for the token
    const brandKey =
      denom.toUpperCase() === "UBLD" ? "BLD" : denom.toUpperCase();
    const brand = state.brands?.[brandKey];

    if (!brand) {
      throw new Error(
        `Brand not found for ${brandKey}. Available brands: ${Object.keys(
          state.brands || {}
        ).join(", ")}`
      );
    }

    // TODO: Implement your actual claim rewards contract interaction
    const invitationSpec = {
      source: "contract",
      instance: state.contractInstallation || state.contractInstance,
      publicInvitationMaker: "makeClaimRewardsInvitation",
    };

    const proposal = {
      give: {
        Payment: {
          brand,
          value: BigInt(totalAmount),
        },
      },
      want: {},
    };

    const offerArgs = {
      messages,
    };

    const result = await makeOffer({
      invitationSpec,
      proposal,
      offerArgs,
    });

    updateStatus(`Rewards claimed!`, "success");

    return {
      success: true,
      txHash: result.data?.offerId || "unknown",
      height: 0,
    };
  } catch (error) {
    console.error("[Agoric Sandbox] Claim rewards failed:", error);
    updateStatus(`Claim failed: ${error.message}`, "error");

    let errorCode = "CLAIM_FAILED";
    if (
      error.message?.includes("rejected") ||
      error.message?.includes("refunded")
    ) {
      errorCode = "USER_REJECTED";
    }

    throw { code: errorCode, message: error.message };
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
    await setupWatcher();

    // Wait for watcher to sync initial data (brands, instances, etc.)
    console.log("[Agoric Sandbox] Waiting for initial chain data sync...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    state.isInitialized = true;

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
  // TODO: Add origin validation in production
  // const allowedOrigins = ['https://yourdomain.com', 'http://localhost:3000'];
  // if (!allowedOrigins.includes(event.origin)) {
  //   console.error('[Agoric Sandbox] Invalid origin:', event.origin);
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
        result = await connectWallet();
        watchWallet();
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
          brandsAvailable: state.brands ? Object.keys(state.brands) : [],
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
