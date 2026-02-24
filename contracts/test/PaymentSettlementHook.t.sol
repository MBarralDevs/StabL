// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";

// V4 Core
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";

// Our hook
import {PaymentSettlementHook} from "../src/PaymentSettlementHook.sol";

// Test utilities
import {HookMiner} from "./utils/HookMiner.sol";

// Mock ERC20 for test tokens
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Simple mock ERC20 for testing
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════

contract PaymentSettlementHookTest is Test {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    // ─── Core V4 contracts ──────────────────────────────────────────────
    PoolManager manager;
    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest modifyLiquidityRouter;

    // ─── Our hook ───────────────────────────────────────────────────────
    PaymentSettlementHook hook;

    // ─── Test tokens ────────────────────────────────────────────────────
    MockERC20 usdc;
    MockERC20 eurc;
    Currency currency0;
    Currency currency1;

    // ─── Pool ───────────────────────────────────────────────────────────
    PoolKey poolKey;
    PoolId poolId;

    // ─── Actors ─────────────────────────────────────────────────────────
    address batchSettler = address(0x02);
    address randomUser = address(0x03);
    address feeRecipient = address(0x04);

    // ─── Setup ──────────────────────────────────────────────────────────

    function setUp() public {
        // 1. Deploy PoolManager
        manager = new PoolManager(address(0));

        // 2. Deploy test tokens (ensure currency0 < currency1 for V4 ordering)
        usdc = new MockERC20("USD Coin", "USDC");
        eurc = new MockERC20("Euro Coin", "EURC");

        // V4 requires currency0 < currency1 (by address)
        if (address(usdc) > address(eurc)) {
            (usdc, eurc) = (eurc, usdc);
        }
        currency0 = Currency.wrap(address(usdc));
        currency1 = Currency.wrap(address(eurc));

        // 3. Deploy the hook at an address with the correct permission flags
        //    Our hook needs: BEFORE_SWAP | AFTER_SWAP | AFTER_SWAP_RETURNS_DELTA
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG);

        bytes memory constructorArgs = abi.encode(manager, 50, 10, 5, feeRecipient);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(address(this), flags, 0, type(PaymentSettlementHook).creationCode, constructorArgs);

        hook = new PaymentSettlementHook{salt: salt}(
            IPoolManager(address(manager)),
            50, // baseFee (50 bps)
            10, // minFee (10 bps)
            5, // decayRate
            feeRecipient
        );
        require(address(hook) == hookAddress, "Hook address mismatch");

        // 4. Authorize the batchSettler
        hook.setAuthorizedSettler(batchSettler, true);

        // 5. Deploy test routers
        swapRouter = new PoolSwapTest(manager);
        modifyLiquidityRouter = new PoolModifyLiquidityTest(manager);

        // Authorize the swap router as a settler (in V4, sender = router address)
        hook.setAuthorizedSettler(address(swapRouter), true);

        // 6. Create the pool with our hook
        poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3000, // 0.30% LP fee
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        poolId = poolKey.toId();

        // Initialize pool at 1:1 price (sqrtPriceX96 for 1:1)
        manager.initialize(poolKey, TickMath.getSqrtPriceAtTick(0));

        // 7. Mint tokens and provide liquidity
        usdc.mint(address(this), 1_000_000e6);
        eurc.mint(address(this), 1_000_000e6);
        usdc.approve(address(modifyLiquidityRouter), type(uint256).max);
        eurc.approve(address(modifyLiquidityRouter), type(uint256).max);
        usdc.approve(address(swapRouter), type(uint256).max);
        eurc.approve(address(swapRouter), type(uint256).max);

        // Add liquidity across a wide range
        modifyLiquidityRouter.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: -600, tickUpper: 600, liquidityDelta: 100_000e6, salt: bytes32(0)}),
            new bytes(0)
        );
    }

    // ═════════════════════════════════════════════════════════════════════
    // UNIT TESTS: Fee Calculation (calculateDynamicFee)
    // ═════════════════════════════════════════════════════════════════════

    /// @notice Single settlement should pay the full base fee (50 bps)
    function test_fee_singleSettlement_paysBaseFee() public view {
        (uint256 feeBps,) = hook.getExpectedFee(1);
        assertEq(feeBps, 50, "Single settlement should pay 50 bps");
    }

    /// @notice Fee should decrease as batch size grows
    function test_fee_decreasesWithBatchSize() public view {
        (uint256 fee1,) = hook.getExpectedFee(1);
        (uint256 fee5,) = hook.getExpectedFee(5);
        (uint256 fee10,) = hook.getExpectedFee(10);

        assertGt(fee1, fee5, "Fee for 1 should be > fee for 5");
        assertGt(fee5, fee10, "Fee for 5 should be > fee for 10");
    }

    /// @notice Large batch should hit the minimum fee floor
    function test_fee_largeBatch_hitsMinFee() public view {
        (uint256 fee100,) = hook.getExpectedFee(100);
        // Default minFee is 10 bps
        assertEq(fee100, 10, "Large batch should hit 10 bps floor");
    }

    /// @notice Batch size of 0 reverts (underflow — 0 settlements is invalid)
    function test_fee_zeroBatchSize() public {
        // batchSize=0 causes underflow in (batchSize - 1), which is correct
        // behavior since a batch of 0 settlements is invalid
        vm.expectRevert();
        hook.getExpectedFee(0);
    }

    // ═════════════════════════════════════════════════════════════════════
    // UNIT TESTS: Access Control
    // ═════════════════════════════════════════════════════════════════════

    /// @notice Only owner can authorize settlers
    function test_access_onlyOwnerCanAuthorizeSettler() public {
        vm.prank(randomUser);
        vm.expectRevert();
        hook.setAuthorizedSettler(randomUser, true);
    }

    /// @notice Owner can revoke settler authorization
    function test_access_ownerCanRevokeSettler() public {
        hook.setAuthorizedSettler(batchSettler, false);
        assertFalse(hook.authorizedSettlers(batchSettler));
    }

    /// @notice Only owner can update fee config
    function test_access_onlyOwnerCanUpdateFeeConfig() public {
        vm.prank(randomUser);
        vm.expectRevert();
        hook.setFeeConfig(40, 8, 4, feeRecipient);
    }

    /// @notice Fee config rejects base fee exceeding cap
    function test_access_feeConfigRejectsExcessiveBaseFee() public {
        vm.expectRevert();
        hook.setFeeConfig(600, 10, 5, feeRecipient); // 600 > MAX_BASE_FEE (500)
    }

    /// @notice Fee config rejects minFee > baseFee
    function test_access_feeConfigRejectsMinAboveBase() public {
        vm.expectRevert();
        hook.setFeeConfig(30, 40, 5, feeRecipient); // min(40) > base(30)
    }

    // ═════════════════════════════════════════════════════════════════════
    // UNIT TESTS: Fee Configuration
    // ═════════════════════════════════════════════════════════════════════

    /// @notice Owner can update fee config successfully
    function test_config_ownerCanUpdateFees() public {
        hook.setFeeConfig(40, 8, 4, feeRecipient);

        (uint256 fee1,) = hook.getExpectedFee(1);
        assertEq(fee1, 40, "Base fee should now be 40 bps");
    }

    /// @notice Fee config emits event
    function test_config_emitsFeeConfigEvent() public {
        vm.expectEmit(false, false, false, true);
        emit PaymentSettlementHook.FeeConfigUpdated(40, 8, 4, feeRecipient);
        hook.setFeeConfig(40, 8, 4, feeRecipient);
    }

    // ═════════════════════════════════════════════════════════════════════
    // INTEGRATION TEST: Swap through hook (authorized settler)
    // ═════════════════════════════════════════════════════════════════════

    /// @notice Authorized settler (swap router) can swap through the hook
    function test_swap_authorizedSettlerCanSwap() public {
        bytes memory hookData = abi.encode(uint256(5), keccak256("batch-1"));

        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -100e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );
    }

    /// @notice Swap through an unauthorized router gets reverted
    function test_swap_unauthorizedUserReverts() public {
        // Deploy a SEPARATE router that is NOT authorized
        PoolSwapTest unauthorizedRouter = new PoolSwapTest(manager);

        usdc.approve(address(unauthorizedRouter), type(uint256).max);

        bytes memory hookData = abi.encode(uint256(1), keccak256("batch-x"));

        vm.expectRevert();
        unauthorizedRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -100e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );
    }

    // ═════════════════════════════════════════════════════════════════════
    // INTEGRATION TEST: Analytics tracking
    // ═════════════════════════════════════════════════════════════════════

    /// @notice Settlement metrics update after a swap
    function test_analytics_metricsUpdateAfterSwap() public {
        (uint256 settlementsBefore,,) = hook.getPoolMetrics(poolId);
        assertEq(settlementsBefore, 0, "Should start at 0 settlements");

        bytes memory hookData = abi.encode(uint256(3), keccak256("batch-metrics"));

        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -500e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );

        (uint256 settlementsAfter, uint256 feesAfter, uint256 volumeAfter) = hook.getPoolMetrics(poolId);
        assertEq(settlementsAfter, 3, "Should record 3 settlements from batchSize=3");
        assertGt(feesAfter, 0, "Should have collected some fees");
        assertGt(volumeAfter, 0, "Should have recorded swap volume");
    }

    // ═════════════════════════════════════════════════════════════════════
    // NEW INTEGRATION TESTS: _afterSwap branch coverage
    // ═════════════════════════════════════════════════════════════════════

    /// @notice Swap with empty hookData → early return, no fee, no revert
    function test_swap_emptyHookData_earlyReturn() public {
        // Empty hookData triggers the `hookData.length == 0` early return
        bytes memory hookData = new bytes(0);

        (uint256 settlementsBefore,,) = hook.getPoolMetrics(poolId);

        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -100e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );

        // Analytics should NOT update (early return skips everything)
        (uint256 settlementsAfter,,) = hook.getPoolMetrics(poolId);
        assertEq(settlementsAfter, settlementsBefore, "No settlements should be recorded with empty hookData");
    }

    /// @notice Swap with batchSize=0 in hookData → revert with Hook__InvalidBatchSize
    function test_swap_batchSizeZero_reverts() public {
        bytes memory hookData = abi.encode(uint256(0), keccak256("batch-zero"));

        vm.expectRevert(); // PoolManager wraps hook reverts in WrappedError
        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -100e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );
    }

    /// @notice Swap in the oneForZero direction (EURC→USDC) covers the else branch
    function test_swap_oneForZero_direction() public {
        bytes memory hookData = abi.encode(uint256(3), keccak256("batch-reverse"));

        // Swap EURC → USDC (oneForZero = false means currency1 → currency0)
        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: false, amountSpecified: -100e6, sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );

        // Verify analytics tracked the swap
        (uint256 settlements, uint256 fees, uint256 volume) = hook.getPoolMetrics(poolId);
        assertEq(settlements, 3, "Should record 3 settlements");
        assertGt(fees, 0, "Should have collected fees");
        assertGt(volume, 0, "Should have recorded volume");
    }

    /// @notice Swap with feeBps=0 config → no fee collected
    function test_swap_zeroFeeConfig_noFeeCollected() public {
        // Set baseFee=0, which means calculateDynamicFee returns 0
        hook.setFeeConfig(0, 0, 0, feeRecipient);

        bytes memory hookData = abi.encode(uint256(5), keccak256("batch-nofee"));

        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -100e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );

        // Settlements should update but fees should be 0
        (uint256 settlements, uint256 fees,) = hook.getPoolMetrics(poolId);
        assertEq(settlements, 5, "Should record 5 settlements");
        assertEq(fees, 0, "Should have zero fees with baseFee=0");
    }

    /// @notice Multiple swaps accumulate analytics correctly
    function test_swap_multipleSwaps_accumulateAnalytics() public {
        bytes memory hookData1 = abi.encode(uint256(3), keccak256("batch-1"));
        bytes memory hookData2 = abi.encode(uint256(5), keccak256("batch-2"));
        bytes memory hookData3 = abi.encode(uint256(2), keccak256("batch-3"));

        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -100e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData1
        );

        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -200e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData2
        );

        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -50e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData3
        );

        (uint256 settlements, uint256 fees, uint256 volume) = hook.getPoolMetrics(poolId);
        assertEq(settlements, 10, "Should accumulate 3+5+2 = 10 settlements");
        assertGt(fees, 0, "Should have accumulated fees across swaps");
        assertGt(volume, 0, "Should have accumulated volume across swaps");
    }

    // ═════════════════════════════════════════════════════════════════════
    // NEW TESTS: Event emissions during swaps
    // ═════════════════════════════════════════════════════════════════════

    /// @notice SettlementSwapExecuted is emitted on every swap
    function test_swap_emitsSettlementSwapExecutedEvent() public {
        bytes memory hookData = abi.encode(uint256(3), keccak256("batch-event"));

        // We expect the event with the correct poolId and settler
        // Can't predict exact outputAmount, so we check indexed params only
        vm.expectEmit(true, true, false, false);
        emit PaymentSettlementHook.SettlementSwapExecuted(
            poolId,
            address(swapRouter),
            0, // not checked (checkData = false)
            0, // not checked
            0 // not checked
        );

        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -100e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );
    }

    /// @notice SettlementFeeCollected is emitted when fee > 0
    function test_swap_emitsSettlementFeeCollectedEvent() public {
        bytes memory hookData = abi.encode(uint256(1), keccak256("batch-fee-event"));

        // With baseFee=50 and batchSize=1, feeBps=50, so fee > 0
        vm.expectEmit(true, true, false, false);
        emit PaymentSettlementHook.SettlementFeeCollected(
            poolId,
            feeRecipient,
            0, // not checked
            0, // not checked
            0 // not checked
        );

        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -100e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );
    }

    /// @notice Fee math is correct: fee = |output| * feeBps / 10000
    function test_swap_feeAmountMathematicallyCorrect() public {
        bytes memory hookData = abi.encode(uint256(1), keccak256("batch-math"));

        // Record balances before
        (, uint256 feesBefore, uint256 volumeBefore) = hook.getPoolMetrics(poolId);

        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -10_000e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );

        (, uint256 feesAfter, uint256 volumeAfter) = hook.getPoolMetrics(poolId);
        uint256 actualFee = feesAfter - feesBefore;
        uint256 actualVolume = volumeAfter - volumeBefore;

        // With batchSize=1, feeBps=50
        // Expected fee = volume * 50 / 10000 = volume * 0.005
        uint256 expectedFee = (actualVolume * 50) / 10_000;

        assertEq(actualFee, expectedFee, "Fee should be exactly volume * 50 / 10000");
    }

    // ═════════════════════════════════════════════════════════════════════
    // NEW TESTS: Constructor & config edge cases
    // ═════════════════════════════════════════════════════════════════════

    /// @notice Constructor with zero feeRecipient and non-zero baseFee reverts
    function test_constructor_zeroFeeRecipient_reverts() public {
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG);

        bytes memory constructorArgs = abi.encode(manager, 50, 10, 5, address(0));
        (, bytes32 salt) =
            HookMiner.find(address(this), flags, 1000, type(PaymentSettlementHook).creationCode, constructorArgs);

        vm.expectRevert(PaymentSettlementHook.Hook__FeeRecipientNotSet.selector);
        new PaymentSettlementHook{salt: salt}(IPoolManager(address(manager)), 50, 10, 5, address(0));
    }

    /// @notice setFeeConfig with zero feeRecipient and non-zero baseFee reverts
    function test_config_setFeeConfig_zeroRecipient_reverts() public {
        vm.expectRevert(PaymentSettlementHook.Hook__FeeRecipientNotSet.selector);
        hook.setFeeConfig(50, 10, 5, address(0));
    }

    /// @notice setAuthorizedSettler emits SettlerAuthorizationUpdated event
    function test_config_setAuthorizedSettler_emitsEvent() public {
        address newSettler = address(0xDEAD);

        vm.expectEmit(true, false, false, true);
        emit PaymentSettlementHook.SettlerAuthorizationUpdated(newSettler, true);

        hook.setAuthorizedSettler(newSettler, true);
    }

    /// @notice getPoolMetrics on untouched pool returns all zeros
    function test_analytics_untouchedPool_returnsZeros() public view {
        // Create a different poolId that was never swapped through
        PoolKey memory fakeKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 500, // different fee tier
            tickSpacing: 10,
            hooks: IHooks(address(hook))
        });
        PoolId fakePoolId = fakeKey.toId();

        (uint256 settlements, uint256 fees, uint256 volume) = hook.getPoolMetrics(fakePoolId);
        assertEq(settlements, 0, "Untouched pool should have 0 settlements");
        assertEq(fees, 0, "Untouched pool should have 0 fees");
        assertEq(volume, 0, "Untouched pool should have 0 volume");
    }

    // ═════════════════════════════════════════════════════════════════════
    // FUZZ TESTS
    // ═════════════════════════════════════════════════════════════════════

    /// @notice Fee should always be between minFee and baseFee for any batch size
    function testFuzz_fee_alwaysBoundedByMinAndBase(uint256 batchSize) public view {
        batchSize = bound(batchSize, 1, 10_000);
        (uint256 feeBps,) = hook.getExpectedFee(batchSize);

        // Fee must be >= minFee (default 10)
        assertGe(feeBps, hook.minFee(), "Fee must be >= minFee");
        // Fee must be <= baseFee (default 50)
        assertLe(feeBps, hook.baseFee(), "Fee must be <= baseFee");
    }

    /// @notice Fee should be monotonically non-increasing as batch size grows
    function testFuzz_fee_monotonicallyDecreasing(uint256 batchSizeA, uint256 batchSizeB) public view {
        batchSizeA = bound(batchSizeA, 1, 10_000);
        batchSizeB = bound(batchSizeB, batchSizeA, 10_000);

        (uint256 feeA,) = hook.getExpectedFee(batchSizeA);
        (uint256 feeB,) = hook.getExpectedFee(batchSizeB);

        assertGe(feeA, feeB, "Fee should not increase with larger batch size");
    }

    /// @notice Any fee config within valid bounds should produce bounded fees
    function testFuzz_feeConfig_validConfigProducesBoundedFees(uint256 baseFee, uint256 minFee, uint256 decayRate)
        public
    {
        baseFee = bound(baseFee, 1, 500); // MAX_BASE_FEE cap
        minFee = bound(minFee, 0, baseFee);
        decayRate = bound(decayRate, 0, baseFee);

        hook.setFeeConfig(baseFee, minFee, decayRate, feeRecipient);

        for (uint256 batch = 1; batch <= 20; batch++) {
            (uint256 fee,) = hook.getExpectedFee(batch);
            assertGe(fee, minFee, "Fee below minFee");
            assertLe(fee, baseFee, "Fee above baseFee");
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    // NEW FUZZ TESTS: Through actual swaps
    // ═════════════════════════════════════════════════════════════════════

    /// @notice Fuzz: fee collected via swap is always proportional to output
    function testFuzz_swap_feeAlwaysProportionalToOutput(uint256 swapAmount) public {
        // Bound to reasonable amounts that won't drain the pool
        swapAmount = bound(swapAmount, 1e6, 50_000e6);

        bytes memory hookData = abi.encode(uint256(1), keccak256("fuzz-swap"));

        (, uint256 feesBefore, uint256 volumeBefore) = hook.getPoolMetrics(poolId);

        swapRouter.swap(
            poolKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(swapAmount), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );

        (, uint256 feesAfter, uint256 volumeAfter) = hook.getPoolMetrics(poolId);
        uint256 fee = feesAfter - feesBefore;
        uint256 volume = volumeAfter - volumeBefore;

        if (volume > 0) {
            // Fee should be exactly volume * 50 / 10000 (batchSize=1 → 50 bps)
            uint256 expectedFee = (volume * 50) / 10_000;
            assertEq(fee, expectedFee, "Fee must be proportional to output");
        }
    }

    /// @notice Fuzz: batch sizes through actual swaps produce bounded fees
    function testFuzz_swap_batchSizesThroughSwaps(uint256 batchSize) public {
        batchSize = bound(batchSize, 1, 100);

        bytes memory hookData = abi.encode(batchSize, keccak256("fuzz-batch"));

        (, uint256 feesBefore, uint256 volumeBefore) = hook.getPoolMetrics(poolId);

        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -1000e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );

        (uint256 settlementsAfter, uint256 feesAfter, uint256 volumeAfter) = hook.getPoolMetrics(poolId);
        uint256 fee = feesAfter - feesBefore;
        uint256 volume = volumeAfter - volumeBefore;
        uint256 settlements = settlementsAfter;

        // Settlements recorded should equal batchSize
        assertEq(settlements, batchSize, "Settlements should match batchSize");

        if (volume > 0 && fee > 0) {
            // fee = volume * feeBps / 10000 (truncated)
            // So feeBps = fee * 10000 / volume may be off by 1 due to rounding
            uint256 impliedBps = (fee * 10_000) / volume;

            // Allow +1 tolerance for integer division rounding
            assertGe(impliedBps + 1, hook.minFee(), "Implied fee bps must be ~>= minFee");
            assertLe(impliedBps, hook.baseFee(), "Implied fee bps must be <= baseFee");
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    // INVARIANT TESTS
    // ═════════════════════════════════════════════════════════════════════

    /// @notice Fee recipient address should never be zero after construction
    function test_invariant_feeRecipientNeverZero() public view {
        assertTrue(hook.feeRecipient() != address(0), "feeRecipient must not be zero");
    }

    /// @notice baseFee should always be <= MAX_BASE_FEE
    function test_invariant_baseFeeNeverExceedsCap() public view {
        assertLe(hook.baseFee(), hook.MAX_BASE_FEE(), "baseFee must be <= MAX_BASE_FEE");
    }

    /// @notice minFee should always be <= baseFee
    function test_invariant_minFeeNeverExceedsBase() public view {
        assertLe(hook.minFee(), hook.baseFee(), "minFee must be <= baseFee");
    }
}
