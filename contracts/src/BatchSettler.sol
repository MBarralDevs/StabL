// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "./PaymentPool.sol";
import "./IntentVault.sol";

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
contract BatchSettler is Ownable {
    using SafeERC20 for IERC20;

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

    // ─── State ───────────────────────────────────────────────────────────────

    PaymentPool public immutable paymentPool;
    IntentVault public immutable intentVault;

    // ─── Constructor ─────────────────────────────────────────────────────────

    /**
     * @notice Links this BatchSettler to the PaymentPool and IntentVault contracts.
     *
     * @dev These addresses are immutable — once set at deployment, they can't change.
     *      This is a security feature: we don't want the owner to be able to redirect
     *      settlements to a malicious pool.
     */
    constructor(address _paymentPool, address _intentVault) Ownable(msg.sender) {
        require(_paymentPool != address(0), "BatchSettler: paymentPool is zero address");
        require(_intentVault != address(0), "BatchSettler: intentVault is zero address");

        paymentPool = PaymentPool(_paymentPool);
        intentVault = IntentVault(_intentVault);
    }
}
