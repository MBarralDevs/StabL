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

    /// @notice Unauthorized user gets reverted
    function test_swap_unauthorizedUserReverts() public {
        usdc.mint(randomUser, 10_000e6);
        vm.startPrank(randomUser);
        usdc.approve(address(swapRouter), type(uint256).max);

        bytes memory hookData = abi.encode(uint256(1), keccak256("batch-x"));

        vm.expectRevert();
        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -100e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );
        vm.stopPrank();
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
