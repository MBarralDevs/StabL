// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PaymentPool} from "./PaymentPool.sol";

/**
 * @title CCTPReceiver
 * @notice Receives cross-chain USDC via Circle's CCTP V2 and routes payments
 *         into StabL's PaymentPool for merchant settlement.
 *
 * @dev  How it fits in the architecture:
 *
 *       Source Chain:
 *         Customer calls TokenMessengerV2.depositForBurnWithHook()
 *         - mintRecipient = this contract (CCTPReceiver on Arc)
 *         - hookData = abi.encode(merchant, paymentId)
 *
 *       Circle Attestation:
 *         Iris attestation service observes burn, signs attestation
 *         (Fast Transfer for soft finality, Standard for hard finality)
 *
 *       Destination Chain (Arc):
 *         1. Our backend relayer calls MessageTransmitterV2.receiveMessage()
 *            → USDC is minted to this contract
 *         2. Our backend relayer calls processPayment() on this contract
 *            → USDC is deposited into PaymentPool for the merchant
 *
 * @dev  Why a two-step process?
 *       CCTP V2 Hooks are opaque metadata — CCTP does NOT execute hook logic.
 *       The hookData is just bytes passed along with the burn message. Execution
 *       is entirely up to the integrator. So we must explicitly call
 *       processPayment() after USDC has been minted to this contract.
 *
 *       This is actually a feature, not a limitation:
 *       - Our relayer can batch multiple processPayment() calls
 *       - We can validate/reject payments before routing
 *       - No trust assumption on CCTP executing arbitrary code
 *
 * @dev  Security model:
 *       - Only authorized relayers can call processPayment()
 *       - Contract validates it has sufficient USDC balance before routing
 *       - Duplicate payment protection via paymentId tracking
 *       - Emergency sweep for stuck tokens
 *       - Pausable for circuit-breaking
 *       - Reentrancy-guarded on all state-changing functions
 */
contract CCTPReceiver is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Custom Errors ──────────────────────────────────────────────────

    error CCTPReceiver__ZeroAddress();
    error CCTPReceiver__ZeroAmount();
    error CCTPReceiver__DuplicatePayment(bytes32 paymentId);
    error CCTPReceiver__UnauthorizedRelayer(address caller);
    error CCTPReceiver__InsufficientBalance(address token, uint256 required, uint256 available);
    error CCTPReceiver__UnsupportedToken(address token);
    error CCTPReceiver__UnsupportedDomain(uint32 domain);

    // ─── Events ─────────────────────────────────────────────────────────

    /// @notice Emitted when a cross-chain payment is processed and routed to PaymentPool.
    event CrossChainPaymentProcessed(
        bytes32 indexed paymentId,
        address indexed merchant,
        address token,
        uint256 amount,
        uint32 sourceDomain,
        address relayer
    );

    /// @notice Emitted when a relayer is authorized or revoked.
    event RelayerUpdated(address indexed relayer, bool authorized);

    /// @notice Emitted when a supported token is added or removed.
    event SupportedTokenUpdated(address indexed token, bool supported);

    /// @notice Emitted when a supported source domain is added or removed.
    event SupportedDomainUpdated(uint32 indexed domain, bool supported);

    /// @notice Emitted when the PaymentPool address is updated.
    event PaymentPoolUpdated(address indexed oldPool, address indexed newPool);

    /// @notice Emitted when stuck tokens are swept by the owner.
    event TokensSwept(address indexed token, address indexed recipient, uint256 amount);

    // ─── State ──────────────────────────────────────────────────────────

    /// @notice The PaymentPool contract where payments are routed.
    PaymentPool public paymentPool;

    /// @notice Addresses authorized to call processPayment().
    ///         Typically our backend relayer service.
    mapping(address => bool) public authorizedRelayers;

    /// @notice Tokens accepted by this receiver (e.g., USDC, EURC on Arc).
    mapping(address => bool) public supportedTokens;

    /// @notice Source chain domains accepted (CCTP domain identifiers).
    ///         e.g., 0 = Ethereum, 1 = Avalanche, 6 = Base, etc.
    mapping(uint32 => bool) public supportedDomains;

    /// @notice Tracks processed payment IDs to prevent double-processing.
    mapping(bytes32 => bool) public processedPayments;

    /// @notice Total payments processed through this receiver.
    uint256 public totalPaymentsProcessed;

    /// @notice Total volume processed per token (for analytics).
    mapping(address => uint256) public totalVolumeByToken;

    /// @notice Total volume processed per source domain (for analytics).
    mapping(uint32 => uint256) public totalVolumeByDomain;

    // ─── Constructor ────────────────────────────────────────────────────

    /**
     * @param _paymentPool  Address of the PaymentPool contract.
     * @param _owner        Address of the contract owner (multisig or deployer).
     */
    constructor(address _paymentPool, address _owner) Ownable(_owner) {
        if (_paymentPool == address(0)) revert CCTPReceiver__ZeroAddress();
        paymentPool = PaymentPool(_paymentPool);
    }

    // ─── Core: Process Payment ──────────────────────────────────────────

    /**
     * @notice Routes a received CCTP payment into PaymentPool for a merchant.
     *
     * @dev  Called by our backend relayer AFTER:
     *       1. MessageTransmitterV2.receiveMessage() has minted USDC to this contract
     *       2. The relayer has decoded the hookData from the original burn tx
     *
     *       The relayer extracts (merchant, paymentId) from the CCTP hookData
     *       and passes them here along with the token/amount/sourceDomain.
     *
     * @param merchant      The merchant who should receive credit in PaymentPool.
     * @param token         The token that was minted (USDC address on Arc).
     * @param amount        The amount of tokens to route to PaymentPool.
     * @param paymentId     Unique payment identifier (derived from source tx hash + nonce).
     * @param sourceDomain  The CCTP domain where the burn originated.
     */
    function processPayment(address merchant, address token, uint256 amount, bytes32 paymentId, uint32 sourceDomain)
        external
        whenNotPaused
        nonReentrant
    {
        // ─── Validation ─────────────────────────────────────────

        if (!authorizedRelayers[msg.sender]) {
            revert CCTPReceiver__UnauthorizedRelayer(msg.sender);
        }
        if (merchant == address(0)) revert CCTPReceiver__ZeroAddress();
        if (amount == 0) revert CCTPReceiver__ZeroAmount();
        if (!supportedTokens[token]) revert CCTPReceiver__UnsupportedToken(token);
        if (!supportedDomains[sourceDomain]) revert CCTPReceiver__UnsupportedDomain(sourceDomain);
        if (processedPayments[paymentId]) {
            revert CCTPReceiver__DuplicatePayment(paymentId);
        }

        // Check that CCTP actually minted the tokens to us
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < amount) {
            revert CCTPReceiver__InsufficientBalance(token, amount, balance);
        }

        // ─── State updates ──────────────────────────────────────

        processedPayments[paymentId] = true;
        totalPaymentsProcessed++;
        totalVolumeByToken[token] += amount;
        totalVolumeByDomain[sourceDomain] += amount;

        // ─── Route to PaymentPool ───────────────────────────────

        // Approve PaymentPool to pull the tokens
        IERC20(token).forceApprove(address(paymentPool), amount);

        // Deposit into PaymentPool — this credits the merchant's balance
        paymentPool.receivePayment(merchant, token, amount, paymentId);

        // ─── Emit event ─────────────────────────────────────────

        emit CrossChainPaymentProcessed(paymentId, merchant, token, amount, sourceDomain, msg.sender);
    }

    // ─── Batch Processing ───────────────────────────────────────────────

    /**
     * @notice Process multiple CCTP payments in a single transaction.
     *
     * @dev  Gas-efficient batch processing for when our relayer has
     *       accumulated multiple minted payments to route.
     *       If any single payment fails, the entire batch reverts (atomic).
     *
     * @param merchants      Array of merchant addresses.
     * @param tokens         Array of token addresses.
     * @param amounts        Array of amounts.
     * @param paymentIds     Array of unique payment identifiers.
     * @param sourceDomains  Array of CCTP source domains.
     */
    function processPaymentBatch(
        address[] calldata merchants,
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes32[] calldata paymentIds,
        uint32[] calldata sourceDomains
    ) external whenNotPaused nonReentrant {
        uint256 len = merchants.length;
        if (len == 0) revert CCTPReceiver__ZeroAmount();
        if (len != tokens.length || len != amounts.length || len != paymentIds.length || len != sourceDomains.length) {
            // Reuse ZeroAmount for array length mismatch — could add a custom error
            revert CCTPReceiver__ZeroAmount();
        }

        if (!authorizedRelayers[msg.sender]) {
            revert CCTPReceiver__UnauthorizedRelayer(msg.sender);
        }

        for (uint256 i; i < len;) {
            _processPaymentInternal(merchants[i], tokens[i], amounts[i], paymentIds[i], sourceDomains[i]);
            unchecked {
                ++i;
            }
        }
    }

    // ─── Admin: Relayer Management ──────────────────────────────────────

    /**
     * @notice Authorize or revoke a relayer address.
     * @param relayer   The address to update.
     * @param authorized Whether to authorize (true) or revoke (false).
     */
    function setRelayer(address relayer, bool authorized) external onlyOwner {
        if (relayer == address(0)) revert CCTPReceiver__ZeroAddress();
        authorizedRelayers[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    // ─── Admin: Token Management ────────────────────────────────────────

    /**
     * @notice Add or remove a supported token.
     * @param token     The token address (e.g., USDC on Arc).
     * @param supported Whether to support (true) or unsupport (false).
     */
    function setSupportedToken(address token, bool supported) external onlyOwner {
        if (token == address(0)) revert CCTPReceiver__ZeroAddress();
        supportedTokens[token] = supported;
        emit SupportedTokenUpdated(token, supported);
    }

    // ─── Admin: Domain Management ───────────────────────────────────────

    /**
     * @notice Add or remove a supported source domain.
     * @param domain    The CCTP domain identifier.
     * @param supported Whether to support (true) or unsupport (false).
     */
    function setSupportedDomain(uint32 domain, bool supported) external onlyOwner {
        supportedDomains[domain] = supported;
        emit SupportedDomainUpdated(domain, supported);
    }

    // ─── Admin: PaymentPool Update ──────────────────────────────────────

    /**
     * @notice Update the PaymentPool address.
     * @dev    Only callable by owner. For contract migration scenarios.
     */
    function setPaymentPool(address _paymentPool) external onlyOwner {
        if (_paymentPool == address(0)) revert CCTPReceiver__ZeroAddress();
        address old = address(paymentPool);
        paymentPool = PaymentPool(_paymentPool);
        emit PaymentPoolUpdated(old, _paymentPool);
    }

    // ─── Admin: Pause / Unpause ─────────────────────────────────────────

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── Admin: Emergency Sweep ─────────────────────────────────────────

    /**
     * @notice Sweep stuck tokens from this contract.
     *
     * @dev  Safety mechanism in case tokens are sent directly to this contract
     *       without going through processPayment(), or if a payment processing
     *       fails and tokens need to be recovered.
     *
     * @param token     The token to sweep.
     * @param recipient Where to send the tokens.
     * @param amount    How many tokens to sweep.
     */
    function sweep(address token, address recipient, uint256 amount) external onlyOwner {
        if (token == address(0)) revert CCTPReceiver__ZeroAddress();
        if (recipient == address(0)) revert CCTPReceiver__ZeroAddress();
        if (amount == 0) revert CCTPReceiver__ZeroAmount();

        IERC20(token).safeTransfer(recipient, amount);
        emit TokensSwept(token, recipient, amount);
    }

    // ─── View: Check Payment Status ─────────────────────────────────────

    /**
     * @notice Check if a payment has been processed.
     * @param paymentId The payment identifier to check.
     * @return True if the payment has been processed.
     */
    function isPaymentProcessed(bytes32 paymentId) external view returns (bool) {
        return processedPayments[paymentId];
    }

    /**
     * @notice Get the current balance of a token held by this contract.
     * @dev    Useful for the relayer to verify USDC was minted before calling processPayment.
     * @param token The token address to check.
     * @return The token balance held by this contract.
     */
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ─── Internal ───────────────────────────────────────────────────────

    /**
     * @dev  Internal implementation of processPayment for use in batch processing.
     *       Shares all validation logic with the single processPayment function.
     */
    function _processPaymentInternal(
        address merchant,
        address token,
        uint256 amount,
        bytes32 paymentId,
        uint32 sourceDomain
    ) internal {
        if (merchant == address(0)) revert CCTPReceiver__ZeroAddress();
        if (amount == 0) revert CCTPReceiver__ZeroAmount();
        if (!supportedTokens[token]) revert CCTPReceiver__UnsupportedToken(token);
        if (!supportedDomains[sourceDomain]) revert CCTPReceiver__UnsupportedDomain(sourceDomain);
        if (processedPayments[paymentId]) {
            revert CCTPReceiver__DuplicatePayment(paymentId);
        }

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < amount) {
            revert CCTPReceiver__InsufficientBalance(token, amount, balance);
        }

        processedPayments[paymentId] = true;
        totalPaymentsProcessed++;
        totalVolumeByToken[token] += amount;
        totalVolumeByDomain[sourceDomain] += amount;

        IERC20(token).forceApprove(address(paymentPool), amount);
        paymentPool.receivePayment(merchant, token, amount, paymentId);

        emit CrossChainPaymentProcessed(paymentId, merchant, token, amount, sourceDomain, msg.sender);
    }
}
