// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {SafeCast} from "v4-core/src/libraries/SafeCast.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";

/**
 * @title PaymentSettlementHook
 * @notice A Uniswap V4 hook that enables trustless cross-token settlement
 *         with dynamic batch-size-dependent fees for StabL Gateway.
 *
 * @dev  How it fits in the architecture:
 *
 *       1. Customer pays merchant in USDC (lands in PaymentPool on Arc)
 *       2. Merchant's intent says they want EURC
 *       3. BatchSettler calls PoolManager.swap() on the USDC/EURC pool
 *       4. This hook intercepts the swap:
 *          - beforeSwap: validates the caller is an authorized settler
 *          - afterSwap: collects a dynamic fee from the output amount
 *       5. The fee decreases as batch size increases (carpool incentive)
 *
 *       Same-token settlements (USDC→USDC) bypass the pool entirely
 *       and go through BatchSettler's direct transfer path.
 *
 * @dev  Dynamic Fee Model:
 *       The fee is NOT a fixed percentage. It decreases with batch size:
 *
 *       - 1 settlement  → baseFee (e.g. 50bp = 0.50%)
 *       - 5 settlements → ~30bp
 *       - 10 settlements → ~20bp
 *       - 20+ settlements → minFee (e.g. 10bp = 0.10%)
 *
 *       Formula: fee = max(minFee, baseFee - (batchSize * decayRate))
 *
 *       This incentivizes merchants to batch together, which is the
 *       core "carpool" value proposition of StabL.
 *
 * @dev  Security:
 *       - Only authorized settlers can trigger swaps through this hook
 *       - Fee parameters are owner-configurable with hard caps
 *       - Hook validates batch context via hookData parameter
 *       - All fees go to a configurable feeRecipient address
 */
contract PaymentSettlementHook is BaseHook, Ownable {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeCast for uint256;

    // ─── Custom Errors ──────────────────────────────────────────────────

    error Hook__UnauthorizedSettler(address caller);
    error Hook__InvalidBatchSize();
    error Hook__InvalidFeeConfig();
    error Hook__FeeRecipientNotSet();
    error Hook__BaseFeeExceedsCap(uint256 baseFee, uint256 cap);
    error Hook__MinFeeExceedsBaseFee(uint256 minFee, uint256 baseFee);

    // ─── Events ─────────────────────────────────────────────────────────

    /// @notice Emitted when a settlement swap is executed through the hook.
    event SettlementSwapExecuted(
        PoolId indexed poolId, address indexed settler, uint256 batchSize, uint256 feeBps, int256 outputAmount
    );

    /// @notice Emitted when the dynamic fee is collected after a swap.
    event SettlementFeeCollected(
        PoolId indexed poolId, address indexed feeRecipient, uint256 feeAmount, uint256 batchSize, uint256 appliedFeeBps
    );

    /// @notice Emitted when fee configuration is updated.
    event FeeConfigUpdated(uint256 baseFee, uint256 minFee, uint256 decayRate, address feeRecipient);

    /// @notice Emitted when a settler is authorized or revoked.
    event SettlerAuthorizationUpdated(address indexed settler, bool authorized);

    // ─── Constants ──────────────────────────────────────────────────────

    /// @notice Maximum allowed base fee: 5% (500 basis points).
    ///         This is a hard cap that cannot be exceeded even by the owner.
    uint256 public constant MAX_BASE_FEE = 500;

    /// @notice Basis points denominator (10000 = 100%).
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ─── State ──────────────────────────────────────────────────────────

    /// @notice Addresses authorized to execute settlements through this hook.
    ///         Typically only the BatchSettler contract.
    mapping(address => bool) public authorizedSettlers;

    /// @notice Base fee in basis points for a single settlement (highest fee).
    uint256 public baseFee;

    /// @notice Minimum fee in basis points (floor, even for huge batches).
    uint256 public minFee;

    /// @notice How many basis points the fee decreases per additional settlement.
    uint256 public decayRate;

    /// @notice Address that receives collected fees.
    address public feeRecipient;

    // ─── Per-Pool Metrics (for analytics/frontend) ──────────────────────

    /// @notice Total settlements processed through each pool.
    mapping(PoolId => uint256) public totalSettlements;

    /// @notice Total fees collected per pool (in output token units).
    mapping(PoolId => uint256) public totalFeesCollected;

    /// @notice Total volume swapped through each pool.
    mapping(PoolId => uint256) public totalVolumeSwapped;

    // ─── Constructor ────────────────────────────────────────────────────

    /**
     * @notice Deploys the hook and sets initial fee configuration.
     *
     * @param _poolManager  Uniswap V4 PoolManager address.
     * @param _baseFee      Starting fee in bps for a batch of 1 (e.g. 50 = 0.50%).
     * @param _minFee       Floor fee in bps (e.g. 10 = 0.10%).
     * @param _decayRate    Bps reduction per additional settlement (e.g. 5).
     * @param _feeRecipient Address that receives fees.
     */
    constructor(IPoolManager _poolManager, uint256 _baseFee, uint256 _minFee, uint256 _decayRate, address _feeRecipient)
        BaseHook(_poolManager)
        Ownable(msg.sender)
    {
        // Validate fee config at construction
        if (_baseFee > MAX_BASE_FEE) revert Hook__BaseFeeExceedsCap(_baseFee, MAX_BASE_FEE);
        if (_minFee > _baseFee) revert Hook__MinFeeExceedsBaseFee(_minFee, _baseFee);
        if (_baseFee > 0 && _feeRecipient == address(0)) revert Hook__FeeRecipientNotSet();

        baseFee = _baseFee;
        minFee = _minFee;
        decayRate = _decayRate;
        feeRecipient = _feeRecipient;

        emit FeeConfigUpdated(_baseFee, _minFee, _decayRate, _feeRecipient);
    }

    // ─── Hook Permissions ───────────────────────────────────────────────

    /**
     * @notice Declares which hook callbacks this contract implements.
     *
     * @dev We use:
     *      - beforeSwap: to validate that only authorized settlers trigger swaps
     *      - afterSwap: to collect the dynamic fee from swap output
     *
     *      We enable afterSwapReturnDelta so the hook can "take" a portion
     *      of the swap output as a fee, modifying what the swapper receives.
     */
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: true, // We take a cut of swap output
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ─── Core Hook Callbacks ────────────────────────────────────────────

    /**
     * @notice Called before every swap on pools using this hook.
     *
     * @dev  Validates that the caller (sender) is an authorized settler.
     *       This prevents random users from swapping through our settlement
     *       pools and getting the batch fee discount.
     *
     *       The `sender` parameter is the address that called PoolManager.swap(),
     *       which in our case is the BatchSettler (or a router acting on its behalf).
     *
     * @param sender   The address that initiated the swap (BatchSettler).
     * @return bytes4           The function selector (required by V4).
     * @return BeforeSwapDelta  Zero delta — we don't modify input amounts.
     * @return uint24           Zero — we don't override the LP fee here.
     */
    function _beforeSwap(address sender, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        // Only authorized settlers can swap through settlement pools
        if (!authorizedSettlers[sender]) {
            revert Hook__UnauthorizedSettler(sender);
        }

        return (
            BaseHook.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            0 // no LP fee override
        );
    }

    /**
     * @notice Called after every swap on pools using this hook.
     *
     * @dev  This is where the magic happens:
     *       1. Decode the batch size from hookData
     *       2. Calculate the dynamic fee based on batch size
     *       3. Take the fee from the swap output
     *       4. Update analytics metrics
     *       5. Emit events for backend tracking
     *
     *       The hookData is ABI-encoded by the BatchSettler when calling swap:
     *       hookData = abi.encode(batchSize, batchId)
     *
     *       The return value (int128) is the amount the hook "takes" from
     *       the output. Positive = hook takes from output (reduces what swapper gets).
     *
     * @param sender    The settler address that initiated the swap.
     * @param key       The pool key (token pair, fee, hook).
     * @param params    Swap parameters (direction, amount, etc.).
     * @param delta     The balance delta from the swap (how much in/out).
     * @param hookData  ABI-encoded (uint256 batchSize, bytes32 batchId).
     * @return bytes4   The function selector.
     * @return int128   The amount taken from output (fee).
     */
    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        // ─── Step 1: Decode batch context from hookData ─────────────

        // If no hookData provided, no fee (shouldn't happen with authorized settlers)
        if (hookData.length == 0) {
            return (BaseHook.afterSwap.selector, 0);
        }

        (uint256 batchSize,) = abi.decode(hookData, (uint256, bytes32));

        if (batchSize == 0) revert Hook__InvalidBatchSize();

        // ─── Step 2: Calculate dynamic fee ──────────────────────────

        uint256 feeBps = calculateDynamicFee(batchSize);

        // ─── Step 3: Determine output amount and take fee ───────────

        // The output is the token the swapper receives.
        // For zeroForOne=true: output is token1 (delta.amount1() is negative = output)
        // For zeroForOne=false: output is token0 (delta.amount0() is negative = output)
        //
        // In BalanceDelta:
        //   - Positive = tokens owed TO the pool (input)
        //   - Negative = tokens owed FROM the pool to the swapper (output)

        int128 outputAmount;
        if (params.zeroForOne) {
            outputAmount = delta.amount1(); // negative (output to swapper)
        } else {
            outputAmount = delta.amount0(); // negative (output to swapper)
        }

        // Only take fee if there's actual output (outputAmount is negative)
        int128 feeAmount = int128(0);
        if (outputAmount < 0 && feeBps > 0) {
            // Calculate fee: |outputAmount| * feeBps / BPS_DENOMINATOR
            // outputAmount is negative, so we negate to get the absolute value
            uint256 absOutput = uint256(uint128(-outputAmount));
            uint256 fee = (absOutput * feeBps) / BPS_DENOMINATOR;

            if (fee > 0) {
                feeAmount = int128(int256(fee));

                // Mint the fee amount as ERC-6909 claim tokens to the feeRecipient
                // The hook takes these tokens from the swap output
                Currency outputCurrency = params.zeroForOne ? key.currency1 : key.currency0;
                poolManager.mint(feeRecipient, CurrencyLibrary.toId(outputCurrency), fee);
            }
        }

        // ─── Step 4: Update analytics ───────────────────────────────

        PoolId poolId = key.toId();
        totalSettlements[poolId] += batchSize;
        if (feeAmount > 0) {
            totalFeesCollected[poolId] += uint256(uint128(feeAmount));
        }
        if (outputAmount < 0) {
            totalVolumeSwapped[poolId] += uint256(uint128(-outputAmount));
        }

        // ─── Step 5: Emit events ────────────────────────────────────

        emit SettlementSwapExecuted(poolId, sender, batchSize, feeBps, outputAmount);

        if (feeAmount > 0) {
            emit SettlementFeeCollected(poolId, feeRecipient, uint256(uint128(feeAmount)), batchSize, feeBps);
        }

        // Return the fee amount — positive means hook takes from output
        return (BaseHook.afterSwap.selector, feeAmount);
    }

    // ─── Dynamic Fee Calculation ────────────────────────────────────────

    /**
     * @notice Calculates the fee in basis points based on batch size.
     *
     * @dev  Formula: fee = max(minFee, baseFee - ((batchSize - 1) * decayRate))
     *
     *       We subtract 1 from batchSize because a single settlement pays
     *       the full baseFee. The discount starts from the 2nd settlement onward.
     *
     *       Examples with baseFee=50, minFee=10, decayRate=5:
     *         batchSize=1  → max(10, 50 - 0)  = 50bp (0.50%)
     *         batchSize=2  → max(10, 50 - 5)  = 45bp (0.45%)
     *         batchSize=5  → max(10, 50 - 20) = 30bp (0.30%)
     *         batchSize=9  → max(10, 50 - 40) = 10bp (0.10%)
     *         batchSize=20 → max(10, 50 - 95) = 10bp (0.10%) — clamped to min
     *
     * @param batchSize  Number of settlements in the current batch.
     * @return feeBps    The fee in basis points to apply.
     */
    function calculateDynamicFee(uint256 batchSize) public view returns (uint256 feeBps) {
        // Edge case: if baseFee is 0, no fee regardless of batch size
        if (baseFee == 0) return 0;

        // Decay amount = (batchSize - 1) * decayRate
        // The -1 means a single settlement pays full baseFee
        uint256 decay = (batchSize - 1) * decayRate;

        // Avoid underflow: if decay exceeds baseFee, clamp to minFee
        if (decay >= baseFee) {
            return minFee;
        }

        uint256 calculatedFee = baseFee - decay;

        // Clamp to minimum
        return calculatedFee < minFee ? minFee : calculatedFee;
    }

    // ─── Admin Functions ────────────────────────────────────────────────

    /**
     * @notice Owner updates the dynamic fee parameters.
     *
     * @param _baseFee      New base fee in bps (max 500 = 5%).
     * @param _minFee       New minimum fee in bps.
     * @param _decayRate    New decay rate per settlement in bps.
     * @param _feeRecipient New fee recipient address.
     */
    function setFeeConfig(uint256 _baseFee, uint256 _minFee, uint256 _decayRate, address _feeRecipient)
        external
        onlyOwner
    {
        if (_baseFee > MAX_BASE_FEE) revert Hook__BaseFeeExceedsCap(_baseFee, MAX_BASE_FEE);
        if (_minFee > _baseFee) revert Hook__MinFeeExceedsBaseFee(_minFee, _baseFee);
        if (_baseFee > 0 && _feeRecipient == address(0)) revert Hook__FeeRecipientNotSet();

        baseFee = _baseFee;
        minFee = _minFee;
        decayRate = _decayRate;
        feeRecipient = _feeRecipient;

        emit FeeConfigUpdated(_baseFee, _minFee, _decayRate, _feeRecipient);
    }

    /**
     * @notice Owner authorizes or revokes a settler address.
     *
     * @dev In production, this would be the BatchSettler contract.
     *      The mapping allows upgrading to a new BatchSettler without
     *      redeploying the hook.
     *
     * @param settler    Address to authorize or revoke.
     * @param authorized Whether the address is authorized.
     */
    function setAuthorizedSettler(address settler, bool authorized) external onlyOwner {
        authorizedSettlers[settler] = authorized;
        emit SettlerAuthorizationUpdated(settler, authorized);
    }

    // ─── View Functions ─────────────────────────────────────────────────

    /**
     * @notice Returns the fee that would be charged for a given batch size.
     *         Useful for the frontend to show merchants their expected fee.
     *
     * @param batchSize  Number of settlements in the batch.
     * @return feeBps    Fee in basis points.
     * @return feePercent100 Fee as a human-readable string denominator (x100 for %).
     */
    function getExpectedFee(uint256 batchSize) external view returns (uint256 feeBps, uint256 feePercent100) {
        feeBps = calculateDynamicFee(batchSize);
        feePercent100 = feeBps; // feeBps / 100 = percent, caller divides
    }

    /**
     * @notice Returns analytics for a specific pool.
     *
     * @param poolId  The pool to query.
     * @return settlements  Total number of individual settlements.
     * @return fees         Total fees collected (in output token units).
     * @return volume       Total swap volume.
     */
    function getPoolMetrics(PoolId poolId) external view returns (uint256 settlements, uint256 fees, uint256 volume) {
        return (totalSettlements[poolId], totalFeesCollected[poolId], totalVolumeSwapped[poolId]);
    }
}
