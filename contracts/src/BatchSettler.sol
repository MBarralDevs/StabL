// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PaymentPool} from "./PaymentPool.sol";
import {IntentVault} from "./IntentVault.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title BatchSettler
 * @notice Executes optimized batch settlements by pulling funds from PaymentPool
 *         and distributing them according to merchant intents stored in IntentVault.
 *
 * @dev  This is the "brain" of the optimization system. The backend analyzes all
 *       pending settlements off-chain, groups compatible merchants into batches,
 *       then calls executeBatch() to settle them all in one transaction.
 *
 *       Gas savings come from:
 *       1. Amortizing fixed transaction overhead across multiple settlements
 *       2. Reducing the number of total on-chain transactions
 *       3. Enabling merchants to choose speed vs cost tradeoffs
 *
 * @dev  Why the backend does the matching:
 *       Computing optimal batches on-chain would require iterating through all
 *       merchants and all intents — prohibitively expensive. We do the heavy
 *       computation off-chain and use the contract just for execution + validation.
 *
 * @dev  Security model:
 *       - Only the owner (backend) can call executeBatch()
 *       - The contract validates that each merchant has sufficient balance
 *       - The contract reads intents from IntentVault to verify settlement params
 *       - Merchants can't be included in a batch without their explicit intent
 */
contract BatchSettler is Ownable, Pausable {
    // ─── Structs ─────────────────────────────────────────────────────────────

    /**
     * @notice Describes a single settlement within a batch.
     *
     * @param merchant   The merchant receiving funds.
     * @param token      The token being settled (must match what's in PaymentPool).
     * @param amount     How much to settle (in token's smallest unit).
     * @param recipient  Where to send the tokens (usually merchant's wallet, but
     *                   could be a cross-chain bridge contract if settling to
     *                   another chain).
     */
    struct Settlement {
        address merchant;
        address token;
        uint256 amount;
        address recipient;
    }

    // ─── Custom Errors ───────────────────────────────────────────────────────
    error BatchSettler__EmptyBatch();
    error BatchSettler__BatchTooLarge(uint256 size, uint256 max);
    error BatchSettler__MerchantHasNoIntent(address merchant);
    error BatchSettler__ZeroAddress();
    error BatchSettler__ZeroAmount();
    error BatchSettler__InvalidMaxBatchSize();

    // ─── Events ──────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when a batch of settlements is executed.
     * @param batchId        Unique identifier assigned by the backend.
     * @param settlements    Array of all settlements in this batch.
     * @param totalGasSaved  Estimated gas saved vs individual settlements (in wei).
     *                       Computed off-chain by the backend, included for analytics.
     */
    event BatchExecuted(bytes32 indexed batchId, Settlement[] settlements, uint256 totalGasSaved);

    /**
     * @notice Emitted for each individual settlement within a batch.
     *         This gives us granular per-merchant event tracking.
     */
    event SettlementExecuted(
        bytes32 indexed batchId, address indexed merchant, address indexed token, uint256 amount, address recipient
    );

    /// @notice Emitted when the max batch size is updated.
    event MaxBatchSizeUpdated(uint256 oldSize, uint256 newSize);

    // ─── State ───────────────────────────────────────────────────────────────

    PaymentPool public immutable paymentPool;
    IntentVault public immutable intentVault;
    /// @notice Maximum number of settlements allowed in a single batch.
    /// Prevents gas limit issues from oversized batches.
    uint256 public maxBatchSize;

    // ─── Constructor ─────────────────────────────────────────────────────────

    /**
     * @notice Links this BatchSettler to the PaymentPool and IntentVault contracts.
     *
     * @dev These addresses are immutable — once set at deployment, they can't change.
     *      This is a security feature: we don't want the owner to be able to redirect
     *      settlements to a malicious pool.
     */
    constructor(address _paymentPool, address _intentVault) Ownable(msg.sender) {
        if (_paymentPool == address(0)) revert BatchSettler__ZeroAddress();
        if (_intentVault == address(0)) revert BatchSettler__ZeroAddress();

        paymentPool = PaymentPool(_paymentPool);
        intentVault = IntentVault(_intentVault);
        maxBatchSize = 50; // sensible default
    }

    // ─── Core: Execute Batch ─────────────────────────────────────────────────

    /**
     * @notice Executes a batch of settlements atomically.
     *
     * @dev  Only the owner (backend) can call this. The backend has already done
     *       the intent matching off-chain and determined this is an optimal batch.
     *
     * @dev  Validation:
     *       - Each merchant must have an intent set in IntentVault
     *       - Each merchant must have sufficient balance in PaymentPool
     *       - The token must match what's in the pool
     *
     * @dev  Atomicity:
     *       All settlements succeed or all fail. If any merchant has insufficient
     *       balance, the entire batch reverts. This prevents partial settlements.
     *
     * @param batchId         Unique ID from the backend (for tracking/analytics).
     * @param settlements     Array of Settlement structs describing who gets what.
     * @param totalGasSaved   Estimated gas savings vs individual settlements.
     */
    function executeBatch(bytes32 batchId, Settlement[] calldata settlements, uint256 totalGasSaved)
        external
        onlyOwner
        whenNotPaused
    {
        if (settlements.length == 0) revert BatchSettler__EmptyBatch();
        if (settlements.length > maxBatchSize) revert BatchSettler__BatchTooLarge(settlements.length, maxBatchSize);

        // Process each settlement in the batch
        for (uint256 i = 0; i < settlements.length; i++) {
            Settlement calldata s = settlements[i];

            if (!intentVault.hasIntent(s.merchant)) revert BatchSettler__MerchantHasNoIntent(s.merchant);
            if (s.recipient == address(0)) revert BatchSettler__ZeroAddress();
            if (s.amount == 0) revert BatchSettler__ZeroAmount();

            // Pull funds from PaymentPool directly to recipient (this will revert if insufficient balance)
            paymentPool.withdraw(s.merchant, s.token, s.amount, s.recipient);

            emit SettlementExecuted(batchId, s.merchant, s.token, s.amount, s.recipient);
        }

        emit BatchExecuted(batchId, settlements, totalGasSaved);
    }

    // ─── View: Validate Batch (for testing/simulation) ──────────────────────

    /**
     * @notice Checks if a batch would succeed without actually executing it.
     *         Useful for the backend to validate batches before submitting.
     *
     * @dev  This is a view function — doesn't modify state, just reads and returns.
     *
     * @return valid       True if the batch would execute successfully.
     * @return errorIndex  If invalid, which settlement in the batch failed (0-indexed).
     *                     If valid, this is 0 (ignored).
     * @return reason      Human-readable error message if invalid.
     */
    function validateBatch(Settlement[] calldata settlements)
        external
        view
        returns (bool valid, uint256 errorIndex, string memory reason)
    {
        if (settlements.length == 0) {
            return (false, 0, "Empty batch");
        }

        for (uint256 i = 0; i < settlements.length; i++) {
            Settlement calldata s = settlements[i];

            if (!intentVault.hasIntent(s.merchant)) {
                return (false, i, "Merchant has no intent");
            }

            if (s.recipient == address(0)) {
                return (false, i, "Recipient is zero address");
            }

            if (s.amount == 0) {
                return (false, i, "Amount is zero");
            }

            uint256 balance = paymentPool.getMerchantBalance(s.merchant, s.token);
            if (balance < s.amount) {
                return (false, i, "Insufficient balance");
            }
        }

        return (true, 0, "");
    }

    /// @notice Owner can update the max batch size.
    /// @param newMaxBatchSize  Must be > 0.
    function setMaxBatchSize(uint256 newMaxBatchSize) external onlyOwner {
        if (newMaxBatchSize == 0) revert BatchSettler__InvalidMaxBatchSize();
        uint256 oldSize = maxBatchSize;
        maxBatchSize = newMaxBatchSize;
        emit MaxBatchSizeUpdated(oldSize, newMaxBatchSize);
    }

    // ─── Admin: Pause / Unpause ─────────────────────────────────────────────

    /// @notice Owner can pause batch settlements in case of emergency.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Owner can unpause to resume settlements.
    function unpause() external onlyOwner {
        _unpause();
    }
}
