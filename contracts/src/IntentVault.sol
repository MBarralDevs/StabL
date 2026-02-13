// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title IntentVault
 * @notice Stores merchant settlement preferences (intents) on-chain.
 *
 * @dev  Why on-chain?
 *       The BatchSettler contract needs to read intents when deciding how to
 *       group payments. Storing intents here means BatchSettler can verify them
 *       directly — no trust in the backend needed.
 *
 * @dev  Who calls what:
 *       - Merchants (or the backend on their behalf) call setIntent() to
 *         configure their preferences.
 *       - BatchSettler calls getIntent() to read preferences when building batches.
 *       - The backend polls getIntent() too, to make matching decisions off-chain
 *         before triggering on-chain settlement.
 */
contract IntentVault is Ownable {
    // ─── Enums ───────────────────────────────────────────────────────────────

    /**
     * @notice How fast the merchant wants their funds settled.
     *
     * IMMEDIATE — settle this payment right now, standalone transaction.
     *             Costs more gas but merchant gets funds on their target chain fast.
     *
     * STANDARD  — wait up to `maxWaitTimeSeconds` for other payments to batch with.
     *             Good balance of speed and cost savings.
     *
     * DEFERRED  — don't settle until the pool accumulates at least `minBatchAmount`
     *             for this merchant. Maximum savings, but settlement timing is
     *             unpredictable (depends on payment volume).
     */
    enum SettlementSpeed {
        IMMEDIATE,
        STANDARD,
        DEFERRED
    }

    // ─── Structs ─────────────────────────────────────────────────────────────

    /**
     * @notice A merchant's full settlement configuration.
     *
     * @param speed              How urgently they want settlement (see enum above).
     * @param minBatchAmount     For DEFERRED: minimum total amount (in token smallest
     *                           unit) before a batch is triggered. Ignored for other speeds.
     * @param maxWaitTimeSeconds For STANDARD: maximum seconds to wait for batch
     *                           partners before settling alone. Ignored for other speeds.
     * @param targetToken        The token the merchant ultimately wants to receive
     *                           (e.g. USDC address). Used by BatchSettler to know if
     *                           a cross-currency swap is needed before settling.
     * @param exists             Tracks whether an intent has been set. Without this,
     *                           we can't distinguish "intent with all zero values" from
     *                           "no intent set at all".
     */
    struct MerchantIntent {
        SettlementSpeed speed;
        uint256 minBatchAmount;
        uint256 maxWaitTimeSeconds;
        address targetToken;
        bool exists;
    }

    // ─── Custom Errors ───────────────────────────────────────────────────────
    error IntentVault__ZeroAddress();
    error IntentVault__DeferredRequiresMinBatchAmount();
    error IntentVault__StandardRequiresMaxWaitTime();
    error IntentVault__NoIntentToDelete();

    // ─── Events ──────────────────────────────────────────────────────────────

    /// @notice Emitted whenever a merchant sets or updates their intent.
    event IntentUpdated(
        address indexed merchant,
        SettlementSpeed speed,
        uint256 minBatchAmount,
        uint256 maxWaitTimeSeconds,
        address targetToken
    );

    // ─── State ───────────────────────────────────────────────────────────────

    /// @notice intent per merchant address.
    mapping(address => MerchantIntent) private intents;

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─── Core: Set Intent ────────────────────────────────────────────────────

    /**
     * @notice Merchant sets (or updates) their settlement preferences.
     *         Can be called by the merchant directly or by the backend on their
     *         behalf (if we add a role-based system later).
     *
     * @param speed              Desired settlement speed.
     * @param minBatchAmount     Threshold for DEFERRED mode (ignored otherwise).
     * @param maxWaitTimeSeconds Max wait for STANDARD mode (ignored otherwise).
     * @param targetToken        Token address the merchant wants to receive.
     */
    function setIntent(SettlementSpeed speed, uint256 minBatchAmount, uint256 maxWaitTimeSeconds, address targetToken)
        external
    {
        if (targetToken == address(0)) revert IntentVault__ZeroAddress();

        // Validate that DEFERRED has a meaningful threshold
        if (speed == SettlementSpeed.DEFERRED) {
            if (minBatchAmount == 0) revert IntentVault__DeferredRequiresMinBatchAmount();
        }

        // Validate that STANDARD has a meaningful wait time
        if (speed == SettlementSpeed.STANDARD) {
            if (maxWaitTimeSeconds == 0) revert IntentVault__StandardRequiresMaxWaitTime();
        }

        intents[msg.sender] = MerchantIntent({
            speed: speed,
            minBatchAmount: minBatchAmount,
            maxWaitTimeSeconds: maxWaitTimeSeconds,
            targetToken: targetToken,
            exists: true
        });

        emit IntentUpdated(msg.sender, speed, minBatchAmount, maxWaitTimeSeconds, targetToken);
    }

    // ─── View: Read Intent ───────────────────────────────────────────────────

    /**
     * @notice Returns a merchant's current intent.
     *         The `exists` field tells you if the merchant has ever set an intent.
     */
    function getIntent(address merchant) external view returns (MerchantIntent memory) {
        return intents[merchant];
    }

    /**
     * @notice Convenience: check if a merchant has set an intent at all.
     */
    function hasIntent(address merchant) external view returns (bool) {
        return intents[merchant].exists;
    }
}
