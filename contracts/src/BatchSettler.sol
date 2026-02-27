// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PaymentPool} from "./PaymentPool.sol";
import {IntentVault} from "./IntentVault.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/**
 * @title BatchSettler
 * @notice Executes optimized batch settlements by pulling funds from PaymentPool
 *         and distributing them according to merchant intents stored in IntentVault.
 *
 * @dev  Supports two settlement modes:
 *
 *       1. SAME-TOKEN: merchant paid in USDC, wants USDC
 *          → PaymentPool.withdraw() directly to recipient
 *
 *       2. CROSS-TOKEN: merchant paid in USDC, wants EURC
 *          → PaymentPool.withdraw() to BatchSettler
 *          → BatchSettler swaps via Uniswap V4 (with PaymentSettlementHook)
 *          → Output token sent to recipient
 *
 *       The cross-token path uses V4's unlock/callback pattern. BatchSettler
 *       implements IUnlockCallback and acts as the swap router. The
 *       PaymentSettlementHook validates that BatchSettler is an authorized
 *       settler and applies dynamic batch-size-dependent fees.
 *
 * @dev  Security model:
 *       - Only the owner (backend) can call executeBatch()
 *       - PaymentPool validates that BatchSettler is an authorized withdrawer
 *       - PaymentSettlementHook validates BatchSettler is an authorized settler
 *       - IntentVault ensures merchants have opted in
 *       - PoolManager.unlock() callback is restricted to only be called by PoolManager
 */
contract BatchSettler is Ownable, Pausable, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    // ─── Structs ─────────────────────────────────────────────────────────────

    /**
     * @notice Describes a single settlement within a batch.
     *
     * @param merchant     The merchant receiving funds.
     * @param token        The input token (what's in PaymentPool).
     * @param amount       How much to settle (in input token's smallest unit).
     * @param recipient    Where to send the output tokens.
     * @param outputToken  The desired output token. If same as `token`, it's a
     *                     direct transfer. If different, it routes through V4.
     */
    struct Settlement {
        address merchant;
        address token;
        uint256 amount;
        address recipient;
        address outputToken;
    }

    /**
     * @dev Internal struct passed through PoolManager.unlock() callback.
     *      Contains everything needed to execute cross-token settlements.
     */
    struct CrossTokenSwapData {
        Settlement[] settlements;
        uint256[] crossTokenIndices;
        bytes32 batchId;
        uint256 batchSize;
    }

    // ─── Custom Errors ───────────────────────────────────────────────────────

    error BatchSettler__EmptyBatch();
    error BatchSettler__BatchTooLarge(uint256 size, uint256 max);
    error BatchSettler__MerchantHasNoIntent(address merchant);
    error BatchSettler__ZeroAddress();
    error BatchSettler__ZeroAmount();
    error BatchSettler__InvalidMaxBatchSize();
    error BatchSettler__InvalidFee();
    error BatchSettler__FeeRecipientNotSet();
    error BatchSettler__NoPoolRegistered(address tokenIn, address tokenOut);
    error BatchSettler__OnlyPoolManager();
    error BatchSettler__PoolManagerNotSet();
    error BatchSettler__SwapOutputInsufficient(uint256 received, uint256 minExpected);

    // ─── Events ──────────────────────────────────────────────────────────────

    event BatchExecuted(bytes32 indexed batchId, uint256 settlementCount, uint256 totalGasSaved);
    event SettlementExecuted(
        bytes32 indexed batchId, address indexed merchant, address indexed token, uint256 amount, address recipient
    );
    event CrossTokenSettlement(
        bytes32 indexed batchId,
        address indexed merchant,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    );
    event MaxBatchSizeUpdated(uint256 oldSize, uint256 newSize);
    event FeeConfigUpdated(address indexed feeRecipient, uint256 feeBasisPoints);
    event FeeCollected(bytes32 indexed batchId, address indexed merchant, address indexed token, uint256 fee);
    event SettlementPoolRegistered(address indexed tokenA, address indexed tokenB, PoolId poolId);

    // ─── State ───────────────────────────────────────────────────────────────

    PaymentPool public immutable paymentPool;
    IntentVault public immutable intentVault;
    IPoolManager public immutable poolManager;

    uint256 public maxBatchSize;
    address public feeRecipient;
    uint256 public feeBasisPoints;

    /// @notice Registered V4 pool keys for cross-token settlements.
    ///         settlementPools[tokenA][tokenB] = PoolKey for that pair.
    ///         Stored both directions: [USDC][EURC] and [EURC][USDC] point to same pool.
    mapping(address => mapping(address => PoolKey)) public settlementPools;

    /// @notice Tracks whether a pool has been registered for a token pair.
    mapping(address => mapping(address => bool)) public hasPool;

    // ─── Constructor ─────────────────────────────────────────────────────────

    /**
     * @notice Links this BatchSettler to PaymentPool, IntentVault, and PoolManager.
     *
     * @param _paymentPool   The PaymentPool holding merchant funds.
     * @param _intentVault   The IntentVault storing merchant preferences.
     * @param _poolManager   The Uniswap V4 PoolManager for cross-token swaps.
     *                       Pass address(0) if cross-token is not needed yet.
     */
    constructor(address _paymentPool, address _intentVault, address _poolManager) Ownable(msg.sender) {
        if (_paymentPool == address(0)) revert BatchSettler__ZeroAddress();
        if (_intentVault == address(0)) revert BatchSettler__ZeroAddress();

        paymentPool = PaymentPool(_paymentPool);
        intentVault = IntentVault(_intentVault);
        poolManager = IPoolManager(_poolManager);
        maxBatchSize = 50;
    }

    // ─── Core: Execute Batch ─────────────────────────────────────────────────

    /**
     * @notice Executes a batch of settlements atomically.
     *         Handles both same-token (direct transfer) and cross-token (V4 swap).
     *
     * @param batchId         Unique ID from the backend.
     * @param settlements     Array of Settlement structs.
     * @param totalGasSaved   Estimated gas savings (for analytics).
     */
    function executeBatch(bytes32 batchId, Settlement[] calldata settlements, uint256 totalGasSaved)
        external
        onlyOwner
        whenNotPaused
    {
        if (settlements.length == 0) revert BatchSettler__EmptyBatch();
        if (settlements.length > maxBatchSize) revert BatchSettler__BatchTooLarge(settlements.length, maxBatchSize);

        // ─── Phase 1: Validate all settlements and separate by type ─────

        uint256 len = settlements.length;
        uint256 crossTokenCount;

        // First pass: validate + count cross-token settlements
        for (uint256 i; i < len;) {
            Settlement calldata s = settlements[i];
            if (!intentVault.hasIntent(s.merchant)) revert BatchSettler__MerchantHasNoIntent(s.merchant);
            if (s.recipient == address(0)) revert BatchSettler__ZeroAddress();
            if (s.amount == 0) revert BatchSettler__ZeroAmount();

            if (s.outputToken != s.token && s.outputToken != address(0)) {
                if (!hasPool[s.token][s.outputToken]) {
                    revert BatchSettler__NoPoolRegistered(s.token, s.outputToken);
                }
                crossTokenCount++;
            }

            unchecked {
                ++i;
            }
        }

        // ─── Phase 2: Execute same-token settlements directly ───────────

        for (uint256 i; i < len;) {
            Settlement calldata s = settlements[i];

            // Same-token: direct transfer from pool to recipient
            if (s.outputToken == s.token || s.outputToken == address(0)) {
                _executeSameTokenSettlement(batchId, s);
            }

            unchecked {
                ++i;
            }
        }

        // ─── Phase 3: Execute cross-token settlements via V4 ────────────

        if (crossTokenCount > 0) {
            if (address(poolManager) == address(0)) revert BatchSettler__PoolManagerNotSet();

            // Collect indices of cross-token settlements
            uint256[] memory crossIndices = new uint256[](crossTokenCount);
            uint256 idx;
            for (uint256 i; i < len;) {
                Settlement calldata s = settlements[i];
                if (s.outputToken != s.token && s.outputToken != address(0)) {
                    crossIndices[idx] = i;
                    unchecked {
                        ++idx;
                    }
                }
                unchecked {
                    ++i;
                }
            }

            // We need to copy settlements to memory for the callback
            Settlement[] memory settlementsMemory = new Settlement[](len);
            for (uint256 i; i < len;) {
                settlementsMemory[i] = settlements[i];
                unchecked {
                    ++i;
                }
            }

            // Encode data for the unlock callback
            bytes memory callbackData = abi.encode(
                CrossTokenSwapData({
                    settlements: settlementsMemory,
                    crossTokenIndices: crossIndices,
                    batchId: batchId,
                    batchSize: crossTokenCount
                })
            );

            // Enter V4's unlock context — our unlockCallback will execute the swaps
            poolManager.unlock(callbackData);
        }

        emit BatchExecuted(batchId, settlements.length, totalGasSaved);
    }

    // ─── V4 Unlock Callback ─────────────────────────────────────────────────

    /**
     * @notice Called by PoolManager during unlock(). Executes all cross-token swaps.
     *
     * @dev  Inside this callback we have access to PoolManager's transient accounting.
     *       For each cross-token settlement:
     *       1. Withdraw input tokens from PaymentPool to BatchSettler
     *       2. Transfer input tokens to PoolManager (settle the debt)
     *       3. Execute the swap with hookData containing batchSize
     *       4. Take output tokens from PoolManager
     *       5. Transfer output tokens to the merchant's recipient
     */
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert BatchSettler__OnlyPoolManager();

        CrossTokenSwapData memory swapData = abi.decode(data, (CrossTokenSwapData));

        for (uint256 i; i < swapData.crossTokenIndices.length;) {
            uint256 settlementIdx = swapData.crossTokenIndices[i];
            Settlement memory s = swapData.settlements[settlementIdx];

            _executeCrossTokenSwap(swapData.batchId, s, swapData.batchSize);

            unchecked {
                ++i;
            }
        }

        return "";
    }

    // ─── Internal: Same-Token Settlement ────────────────────────────────────

    /**
     * @dev Executes a direct same-token settlement via PaymentPool.withdraw().
     */
    function _executeSameTokenSettlement(bytes32 batchId, Settlement calldata s) internal {
        uint256 fee;
        uint256 netAmount = s.amount;

        if (feeBasisPoints > 0) {
            fee = (s.amount * feeBasisPoints) / 10000;
            netAmount = s.amount - fee;
        }

        // Direct withdrawal to recipient
        paymentPool.withdraw(s.merchant, s.token, netAmount, s.recipient);

        if (fee > 0) {
            paymentPool.withdraw(s.merchant, s.token, fee, feeRecipient);
            emit FeeCollected(batchId, s.merchant, s.token, fee);
        }

        emit SettlementExecuted(batchId, s.merchant, s.token, s.amount, s.recipient);
    }

    // ─── Internal: Cross-Token Swap ─────────────────────────────────────────

    /**
     * @dev Executes a single cross-token settlement inside the unlock callback.
     *
     *      Flow:
     *      1. Withdraw input tokens from PaymentPool → BatchSettler
     *      2. Execute the swap (creates input debt + output credit)
     *      3. Sync + transfer + settle input tokens into PoolManager
     *      4. Take output tokens from PoolManager → recipient
     */
    function _executeCrossTokenSwap(bytes32 batchId, Settlement memory s, uint256 batchSize) internal {
        PoolKey memory pool = settlementPools[s.token][s.outputToken];

        // Step 1: Pull input tokens from PaymentPool to this contract
        paymentPool.withdraw(s.merchant, s.token, s.amount, address(this));

        // Step 2: Determine swap direction
        bool zeroForOne = (Currency.unwrap(pool.currency0) == s.token);
        Currency inputCurrency = zeroForOne ? pool.currency0 : pool.currency1;
        Currency outputCurrency = zeroForOne ? pool.currency1 : pool.currency0;

        // Step 3: Execute the swap (creates delta: we owe input, we're owed output)
        bytes memory hookData = abi.encode(batchSize, keccak256(abi.encode(batchId, s.merchant)));

        BalanceDelta delta = poolManager.swap(
            pool,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(s.amount),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            hookData
        );

        // Step 4: Settle input — sync, transfer, settle
        poolManager.sync(inputCurrency);
        IERC20(s.token).safeTransfer(address(poolManager), s.amount);
        poolManager.settle();

        // Step 5: Determine output amount from delta and take output
        uint256 outputAmount;
        {
            int128 outputDelta = zeroForOne ? delta.amount1() : delta.amount0();
            if (outputDelta < 0) {
                outputAmount = uint256(uint128(-outputDelta));
            } else {
                outputAmount = uint256(uint128(outputDelta));
            }

            // Step 6: Take output tokens directly to recipient
            poolManager.take(outputCurrency, s.recipient, outputAmount);
        }

        emit CrossTokenSettlement(batchId, s.merchant, s.token, s.outputToken, s.amount, outputAmount, s.recipient);
    }

    // ─── Admin: Pool Registration ───────────────────────────────────────────

    /**
     * @notice Registers a V4 pool for cross-token settlements.
     *         The pool must already be initialized in PoolManager with our hook.
     *
     * @dev  Stores the pool key in both directions so lookups work regardless
     *       of which token is input vs output.
     *
     * @param pool  The PoolKey for the V4 pool (with our hook attached).
     */
    function registerSettlementPool(PoolKey calldata pool) external onlyOwner {
        address token0 = Currency.unwrap(pool.currency0);
        address token1 = Currency.unwrap(pool.currency1);

        settlementPools[token0][token1] = pool;
        settlementPools[token1][token0] = pool;
        hasPool[token0][token1] = true;
        hasPool[token1][token0] = true;

        emit SettlementPoolRegistered(token0, token1, pool.toId());
    }

    // ─── View: Validate Batch ───────────────────────────────────────────────

    /**
     * @notice Checks if a batch would succeed without executing it.
     *         Validates both same-token and cross-token settlements.
     */
    function validateBatch(Settlement[] calldata settlements)
        external
        view
        returns (bool valid, uint256 errorIndex, string memory reason)
    {
        if (settlements.length == 0) return (false, 0, "Empty batch");

        for (uint256 i = 0; i < settlements.length; i++) {
            Settlement calldata s = settlements[i];

            if (!intentVault.hasIntent(s.merchant)) return (false, i, "Merchant has no intent");
            if (s.recipient == address(0)) return (false, i, "Recipient is zero address");
            if (s.amount == 0) return (false, i, "Amount is zero");

            uint256 balance = paymentPool.getMerchantBalance(s.merchant, s.token);
            if (balance < s.amount) return (false, i, "Insufficient balance");

            // Validate pool exists for cross-token settlements
            if (s.outputToken != s.token && s.outputToken != address(0)) {
                if (!hasPool[s.token][s.outputToken]) return (false, i, "No pool for token pair");
            }
        }

        return (true, 0, "");
    }

    // ─── Admin Functions ────────────────────────────────────────────────────

    function setMaxBatchSize(uint256 newMaxBatchSize) external onlyOwner {
        if (newMaxBatchSize == 0) revert BatchSettler__InvalidMaxBatchSize();
        uint256 oldSize = maxBatchSize;
        maxBatchSize = newMaxBatchSize;
        emit MaxBatchSizeUpdated(oldSize, newMaxBatchSize);
    }

    function setFeeConfig(address _feeRecipient, uint256 _feeBasisPoints) external onlyOwner {
        if (_feeBasisPoints > 1000) revert BatchSettler__InvalidFee();
        if (_feeBasisPoints > 0 && _feeRecipient == address(0)) revert BatchSettler__FeeRecipientNotSet();
        feeRecipient = _feeRecipient;
        feeBasisPoints = _feeBasisPoints;
        emit FeeConfigUpdated(_feeRecipient, _feeBasisPoints);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
