// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PaymentPool
 * @notice Central vault on Arc that receives cross-chain payments routed by Li.Fi
 *         and tracks per-merchant balances.
 *
 * @dev  How it fits in the architecture:
 *       1. A customer wants to pay a merchant with any stablecoin on any chain.
 *       2. The backend gets a Li.Fi route that ends with a transfer INTO this contract.
 *       3. Li.Fi lands tokens here → PaymentReceived event fires.
 *       4. The backend picks up that event, credits the merchant instantly via Yellow
 *          state channels (off-chain), and later the BatchSettler pulls funds out of
 *          this pool to do the actual on-chain settlement.
 *
 *       So this contract is the single source of truth for "how much does each
 *       merchant have sitting on-chain, waiting to be settled".
 *
 * @dev  Design decisions:
 *       - We use OpenZeppelin's SafeERC20 for all token transfers to handle
 *         non-standard tokens (some stablecoins don't return bool on transfer).
 *       - The owner can register authorized routers. For the MVP this is just
 *         us (the backend), but the pattern lets us add Li.Fi's own contract
 *         as an authorized sender if needed.
 *       - We support multiple token types (USDC, EURC) because the gateway's
 *         whole value prop is "accept anything". Each merchant balance is tracked
 *         per-token.
 */
contract PaymentPool is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Custom Errors ───────────────────────────────────────────────────────
    error PaymentPool__NotAuthorized();
    error PaymentPool__ZeroAddress();
    error PaymentPool__ZeroAmount();
    error PaymentPool__InsufficientBalance(address merchant, address token, uint256 requested, uint256 available);
    error PaymentPool__TokenNotSupported(address token);
    error PaymentPool__DuplicatePayment(bytes32 paymentId);

    // ─── Events ──────────────────────────────────────────────────────────────

    /// @notice Emitted when a payment lands in the pool.
    /// @param merchant   The merchant being paid.
    /// @param payer      The original customer address (on the source chain this
    ///                   won't match, but on Arc it's the Li.Fi relay address —
    ///                   we track it for audit trail).
    /// @param token      The ERC20 token that was deposited.
    /// @param amount     How much was deposited (in token's smallest unit).
    /// @param paymentId  A unique ID the backend assigned to this payment before
    ///                   routing it — lets us correlate on-chain events with our DB.
    event PaymentReceived(
        address indexed merchant, address indexed payer, address indexed token, uint256 amount, bytes32 paymentId
    );

    /// @notice Emitted when funds are withdrawn from the pool (by BatchSettler).
    event FundsWithdrawn(
        address indexed merchant, address indexed token, uint256 amount, address recipient, address indexed withdrawer
    );

    /// @notice Emitted when a token's whitelist status changes.
    event TokenSupportUpdated(address indexed token, bool supported);

    /// @notice Emitted when owner performs an emergency withdrawal.
    event EmergencyWithdraw(address indexed token, uint256 amount);

    // ─── State ───────────────────────────────────────────────────────────────

    /// @notice Per-merchant, per-token balances.
    /// balances[merchant][token] = total amount in pool
    mapping(address => mapping(address => uint256)) private balances;

    /// @notice Addresses authorized to call withdraw (i.e. the BatchSettler contract).
    /// We use a mapping for O(1) lookup.
    mapping(address => bool) private authorizedWithdrawers;

    /// @notice Tokens that are allowed to be deposited into the pool.
    /// Only owner-whitelisted tokens can be used in receivePayment().
    mapping(address => bool) private supportedTokens;

    /// @notice Tracks which payment IDs have already been processed.
    /// Prevents the same payment from being deposited twice.
    mapping(bytes32 => bool) private processedPayments;

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─── Admin: Register Authorized Withdrawers ──────────────────────────────

    /**
     * @notice Owner registers an address that is allowed to withdraw funds.
     *         In production this would be the BatchSettler contract address,
     *         set after deployment.
     */
    function setAuthorizedWithdrawer(address withdrawer, bool authorized) external onlyOwner {
        if (withdrawer == address(0)) revert PaymentPool__ZeroAddress();
        authorizedWithdrawers[withdrawer] = authorized;
    }

    /// @notice Owner adds or removes a token from the whitelist.
    /// @param token   The ERC20 token address.
    /// @param supported  True to allow, false to block.
    function setTokenSupport(address token, bool supported) external onlyOwner {
        if (token == address(0)) revert PaymentPool__ZeroAddress();
        supportedTokens[token] = supported;
        emit TokenSupportUpdated(token, supported);
    }

    // ─── Core: Receive Payment ───────────────────────────────────────────────

    /**
     * @notice Anyone can call this to deposit tokens on behalf of a merchant.
     *         In practice, Li.Fi's destination call or the backend wallet calls this.
     *
     * @param merchant   The merchant address receiving the payment.
     * @param token      The ERC20 token being deposited.
     * @param amount     How much to deposit. Caller must have approved this contract.
     * @param paymentId  Opaque ID from the backend — stored in the event for correlation.
     */
    function receivePayment(address merchant, address token, uint256 amount, bytes32 paymentId)
        external
        whenNotPaused
        nonReentrant
    {
        if (merchant == address(0)) revert PaymentPool__ZeroAddress();
        if (token == address(0)) revert PaymentPool__ZeroAddress();
        if (amount == 0) revert PaymentPool__ZeroAmount();
        if (!supportedTokens[token]) revert PaymentPool__TokenNotSupported(token);
        if (processedPayments[paymentId]) revert PaymentPool__DuplicatePayment(paymentId);

        processedPayments[paymentId] = true;

        // Pull tokens from the caller into this contract.
        // SafeERC20 handles tokens that don't return bool (like some USDC versions).
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Update the merchant's balance.
        balances[merchant][token] += amount;

        emit PaymentReceived(merchant, msg.sender, token, amount, paymentId);
    }

    // ─── Core: Withdraw Funds (called by BatchSettler) ──────────────────────

    /**
     * @notice Withdraws funds from a merchant's balance. Only callable by
     *         an authorized withdrawer (the BatchSettler contract).
     *
     * @param merchant   Which merchant's balance to deduct from.
     * @param token      Which token to withdraw.
     * @param amount     How much to withdraw.
     * @param recipient  Where to send the tokens (could be the merchant directly,
     *                   or another contract for further routing).
     */
    function withdraw(address merchant, address token, uint256 amount, address recipient)
        external
        whenNotPaused
        nonReentrant
    {
        if (!authorizedWithdrawers[msg.sender]) revert PaymentPool__NotAuthorized();
        if (recipient == address(0)) revert PaymentPool__ZeroAddress();
        uint256 balance = balances[merchant][token];
        if (balance < amount) revert PaymentPool__InsufficientBalance(merchant, token, amount, balance);

        balances[merchant][token] -= amount;

        IERC20(token).safeTransfer(recipient, amount);

        emit FundsWithdrawn(merchant, token, amount, recipient, msg.sender);
    }

    /// @notice Emergency: withdraw all of a specific token to the owner.
    ///         Used for migration to a new PaymentPool contract.
    ///         Only callable when paused — forces deliberate action.
    /// @param token  The ERC20 token to sweep.
    function emergencyWithdraw(address token) external onlyOwner whenPaused {
        if (token == address(0)) revert PaymentPool__ZeroAddress();
        uint256 contractBalance = IERC20(token).balanceOf(address(this));
        if (contractBalance == 0) revert PaymentPool__ZeroAmount();
        IERC20(token).safeTransfer(owner(), contractBalance);
        emit EmergencyWithdraw(token, contractBalance);
    }

    // ─── View: Check Balances ────────────────────────────────────────────────

    /**
     * @notice Returns how much of a specific token a merchant has in the pool.
     */
    function getMerchantBalance(address merchant, address token) external view returns (uint256) {
        return balances[merchant][token];
    }

    /// @notice Check if a token is whitelisted for deposits.
    function isTokenSupported(address token) external view returns (bool) {
        return supportedTokens[token];
    }

    /// @notice Check if a payment ID has already been processed.
    function isPaymentProcessed(bytes32 paymentId) external view returns (bool) {
        return processedPayments[paymentId];
    }

    // ─── Admin: Pause / Unpause ─────────────────────────────────────────────

    /// @notice Owner can pause the contract in case of emergency.
    ///         Pausing blocks all deposits and withdrawals.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Owner can unpause to resume normal operations.
    function unpause() external onlyOwner {
        _unpause();
    }
}
