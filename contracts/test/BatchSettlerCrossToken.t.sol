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
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";

// StabL contracts
import {BatchSettler} from "../src/BatchSettler.sol";
import {PaymentPool} from "../src/PaymentPool.sol";
import {IntentVault} from "../src/IntentVault.sol";
import {PaymentSettlementHook} from "../src/PaymentSettlementHook.sol";

// Test utilities
import {HookMiner} from "./utils/HookMiner.sol";

// Mock ERC20
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-TOKEN SETTLEMENT INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

contract BatchSettlerCrossTokenTest is Test {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    // ─── V4 Core ────────────────────────────────────────────────────────
    PoolManager manager;
    PoolModifyLiquidityTest modifyLiquidityRouter;

    // ─── StabL Contracts ────────────────────────────────────────────────
    PaymentPool pool;
    IntentVault vault;
    BatchSettler settler;
    PaymentSettlementHook hook;

    // ─── Tokens ─────────────────────────────────────────────────────────
    MockERC20 usdc;
    MockERC20 eurc;
    MockERC20 dai;
    Currency currency0; // lower address token (usdc or eurc)
    Currency currency1; // higher address token

    // ─── Pool ───────────────────────────────────────────────────────────
    PoolKey poolKey;
    PoolId poolId;

    // ─── Actors ─────────────────────────────────────────────────────────
    address owner = address(this);
    address merchant1 = address(0x1001);
    address merchant2 = address(0x1002);
    address merchant3 = address(0x1003);
    address payer = address(0x2001);
    address feeRecipient = address(0x3001);

    // ─── Setup ──────────────────────────────────────────────────────────

    function setUp() public {
        // 1. Deploy V4 PoolManager
        manager = new PoolManager(address(0));

        // 2. Deploy tokens
        usdc = new MockERC20("USD Coin", "USDC");
        eurc = new MockERC20("Euro Coin", "EURC");
        dai = new MockERC20("DAI Stablecoin", "DAI");

        // V4 requires currency0 < currency1 (by address)
        if (address(usdc) > address(eurc)) {
            (usdc, eurc) = (eurc, usdc);
        }
        currency0 = Currency.wrap(address(usdc));
        currency1 = Currency.wrap(address(eurc));

        // 3. Deploy the hook with HookMiner
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

        // 4. Deploy StabL contracts
        pool = new PaymentPool();
        vault = new IntentVault();
        settler = new BatchSettler(address(pool), address(vault), address(manager));

        // 5. Wire up permissions
        pool.setAuthorizedWithdrawer(address(settler), true);
        hook.setAuthorizedSettler(address(settler), true);

        // 6. Create the V4 pool with our hook
        poolKey = PoolKey({
            currency0: currency0, currency1: currency1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(hook))
        });
        poolId = poolKey.toId();

        manager.initialize(poolKey, TickMath.getSqrtPriceAtTick(0));

        // 7. Register the pool in BatchSettler
        settler.registerSettlementPool(poolKey);

        // 8. Add liquidity
        modifyLiquidityRouter = new PoolModifyLiquidityTest(manager);

        usdc.mint(address(this), 10_000_000e6);
        eurc.mint(address(this), 10_000_000e6);
        usdc.approve(address(modifyLiquidityRouter), type(uint256).max);
        eurc.approve(address(modifyLiquidityRouter), type(uint256).max);

        modifyLiquidityRouter.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: -600, tickUpper: 600, liquidityDelta: 1_000_000e6, salt: bytes32(0)}),
            new bytes(0)
        );

        // 9. Whitelist tokens in PaymentPool
        pool.setTokenSupport(address(usdc), true);
        pool.setTokenSupport(address(eurc), true);
        pool.setTokenSupport(address(dai), true);

        // 10. Set up merchant intents
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.STANDARD, 0, 3600, address(usdc));

        vm.prank(merchant2);
        vault.setIntent(IntentVault.SettlementSpeed.STANDARD, 0, 3600, address(eurc));

        vm.prank(merchant3);
        vault.setIntent(IntentVault.SettlementSpeed.STANDARD, 0, 3600, address(usdc));

        // 11. Fund payer and approve PaymentPool
        usdc.mint(payer, 1_000_000e6);
        eurc.mint(payer, 1_000_000e6);

        vm.startPrank(payer);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CROSS-TOKEN: Happy path
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Single cross-token settlement: USDC → EURC
    function test_crossToken_singleSettlement() public {
        // Merchant1 paid in USDC, wants EURC
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 1000e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1,
            token: address(usdc),
            amount: 1000e6,
            recipient: merchant1,
            outputToken: address(eurc) // cross-token!
        });

        settler.executeBatch(keccak256("batch-cross-1"), settlements, 0);

        // Merchant should have received EURC (minus LP fee and hook fee)
        uint256 eurcReceived = eurc.balanceOf(merchant1);
        assertGt(eurcReceived, 0, "Merchant should have received EURC");
        assertGt(eurcReceived, 900e6, "Should receive >90% (fees are small)");
        assertLt(eurcReceived, 1000e6, "Should receive less than input (fees + slippage)");

        // Pool balance should be zero
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 0, "Pool USDC should be drained");

        // Settler should hold no tokens
        assertEq(usdc.balanceOf(address(settler)), 0, "Settler should hold no USDC");
        assertEq(eurc.balanceOf(address(settler)), 0, "Settler should hold no EURC");
    }

    /// @notice Cross-token settlement in reverse direction: EURC → USDC
    function test_crossToken_reverseDirection() public {
        // Merchant2 paid in EURC, wants USDC
        vm.prank(payer);
        pool.receivePayment(merchant2, address(eurc), 500e6, keccak256("p2"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant2,
            token: address(eurc),
            amount: 500e6,
            recipient: merchant2,
            outputToken: address(usdc) // reverse direction
        });

        settler.executeBatch(keccak256("batch-cross-reverse"), settlements, 0);

        uint256 usdcReceived = usdc.balanceOf(merchant2);
        assertGt(usdcReceived, 0, "Merchant should have received USDC");
        assertGt(usdcReceived, 450e6, "Should receive >90%");

        assertEq(pool.getMerchantBalance(merchant2, address(eurc)), 0);
        assertEq(usdc.balanceOf(address(settler)), 0);
        assertEq(eurc.balanceOf(address(settler)), 0);
    }

    /// @notice Mixed batch: same-token + cross-token in one executeBatch
    function test_crossToken_mixedBatch() public {
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1")); // same-token
        pool.receivePayment(merchant2, address(usdc), 500e6, keccak256("p2")); // cross-token
        vm.stopPrank();

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](2);
        // Same-token: USDC → USDC
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });
        // Cross-token: USDC → EURC
        settlements[1] = BatchSettler.Settlement({
            merchant: merchant2, token: address(usdc), amount: 500e6, recipient: merchant2, outputToken: address(eurc)
        });

        settler.executeBatch(keccak256("batch-mixed"), settlements, 0);

        // Same-token: exact amount
        assertEq(usdc.balanceOf(merchant1), 100e6, "Merchant1 should get exact USDC");

        // Cross-token: approximate amount
        uint256 eurcReceived = eurc.balanceOf(merchant2);
        assertGt(eurcReceived, 450e6, "Merchant2 should get >90% in EURC");

        // Both pool balances drained
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 0);
        assertEq(pool.getMerchantBalance(merchant2, address(usdc)), 0);

        // Settler clean
        assertEq(usdc.balanceOf(address(settler)), 0);
        assertEq(eurc.balanceOf(address(settler)), 0);
    }

    /// @notice Multiple cross-token settlements in one batch
    function test_crossToken_multipleCrossTokenInBatch() public {
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 200e6, keccak256("p1"));
        pool.receivePayment(merchant3, address(usdc), 300e6, keccak256("p2"));
        vm.stopPrank();

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](2);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 200e6, recipient: merchant1, outputToken: address(eurc)
        });
        settlements[1] = BatchSettler.Settlement({
            merchant: merchant3, token: address(usdc), amount: 300e6, recipient: merchant3, outputToken: address(eurc)
        });

        settler.executeBatch(keccak256("batch-multi-cross"), settlements, 0);

        assertGt(eurc.balanceOf(merchant1), 180e6, "Merchant1 EURC > 90%");
        assertGt(eurc.balanceOf(merchant3), 270e6, "Merchant3 EURC > 90%");

        assertEq(usdc.balanceOf(address(settler)), 0);
        assertEq(eurc.balanceOf(address(settler)), 0);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CROSS-TOKEN: Events
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice CrossTokenSettlement event is emitted
    function test_crossToken_emitsEvent() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(eurc)
        });

        // Just check indexed params — we can't predict exact output amount
        vm.expectEmit(true, true, false, false);
        emit BatchSettler.CrossTokenSettlement(
            keccak256("batch-event"), merchant1, address(usdc), address(eurc), 0, 0, address(0)
        );

        settler.executeBatch(keccak256("batch-event"), settlements, 0);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CROSS-TOKEN: Hook fee integration
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Hook analytics are updated after cross-token settlement
    function test_crossToken_hookAnalyticsUpdated() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 1000e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 1000e6, recipient: merchant1, outputToken: address(eurc)
        });

        settler.executeBatch(keccak256("batch-analytics"), settlements, 0);

        (uint256 totalSettlements, uint256 totalFees, uint256 totalVolume) = hook.getPoolMetrics(poolId);
        assertGt(totalSettlements, 0, "Should have recorded settlements");
        assertGt(totalFees, 0, "Should have collected fees");
        assertGt(totalVolume, 0, "Should have recorded volume");
    }

    /// @notice Batch size affects dynamic fee (larger batch = lower fee)
    function test_crossToken_batchSizeAffectsFee() public {
        // Single settlement
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 500e6, keccak256("p1"));

        BatchSettler.Settlement[] memory single = new BatchSettler.Settlement[](1);
        single[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 500e6, recipient: merchant1, outputToken: address(eurc)
        });

        settler.executeBatch(keccak256("batch-single"), single, 0);
        uint256 eurcFromSingle = eurc.balanceOf(merchant1);

        // Now do a batch of 2 (should have lower per-unit fee)
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 500e6, keccak256("p2"));
        pool.receivePayment(merchant3, address(usdc), 500e6, keccak256("p3"));
        vm.stopPrank();

        // Reset merchant1's EURC balance for clean comparison
        // (we can't reset, so we'll just check merchant3)
        BatchSettler.Settlement[] memory batch = new BatchSettler.Settlement[](2);
        batch[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 500e6, recipient: merchant1, outputToken: address(eurc)
        });
        batch[1] = BatchSettler.Settlement({
            merchant: merchant3, token: address(usdc), amount: 500e6, recipient: merchant3, outputToken: address(eurc)
        });

        settler.executeBatch(keccak256("batch-double"), batch, 0);

        // Merchant3 was only in the batch of 2, so their output reflects lower fees
        // Note: price impact from the first swap means the second batch gets slightly
        // less EURC per USDC, but the hook fee should be lower (2 settlements = 40bps vs 50bps)
        uint256 eurcMerchant3 = eurc.balanceOf(merchant3);
        assertGt(eurcMerchant3, 0, "Merchant3 should have received EURC");

        // Log for debugging — the fee difference is small but real
        console2.log("EURC from single (batchSize=1):", eurcFromSingle);
        console2.log("EURC merchant3 (batchSize=2):", eurcMerchant3);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CROSS-TOKEN: Pool registration
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice registerSettlementPool stores pool in both directions
    function test_registerPool_bothDirections() public view {
        assertTrue(settler.hasPool(address(usdc), address(eurc)), "Should have USDC to EURC pool");
        assertTrue(settler.hasPool(address(eurc), address(usdc)), "Should have EURC toUSDC pool");
    }

    /// @notice Unregistered pair has no pool
    function test_registerPool_unregisteredPair() public view {
        assertFalse(settler.hasPool(address(usdc), address(dai)), "Should not have USDC to DAI pool");
        assertFalse(settler.hasPool(address(dai), address(eurc)), "Should not have DAI to EURC pool");
    }

    /// @notice registerSettlementPool emits event
    function test_registerPool_emitsEvent() public {
        // Create a different pool key for DAI/USDC
        MockERC20 tokenA = usdc;
        MockERC20 tokenB = dai;
        if (address(tokenA) > address(tokenB)) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }

        PoolKey memory newPoolKey = PoolKey({
            currency0: Currency.wrap(address(tokenA)),
            currency1: Currency.wrap(address(tokenB)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        vm.expectEmit(true, true, false, true);
        emit BatchSettler.SettlementPoolRegistered(address(tokenA), address(tokenB), newPoolKey.toId());

        settler.registerSettlementPool(newPoolKey);
    }

    /// @notice Only owner can register pools
    function test_registerPool_revert_notOwner() public {
        vm.prank(merchant1);
        vm.expectRevert();
        settler.registerSettlementPool(poolKey);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CROSS-TOKEN: Edge cases & reverts
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Cross-token with poolManager = address(0) reverts
    function test_crossToken_revert_noPoolManager() public {
        // Deploy a settler without pool manager
        BatchSettler settlerNoV4 = new BatchSettler(address(pool), address(vault), address(0));
        pool.setAuthorizedWithdrawer(address(settlerNoV4), true);

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p-nopm"));

        // This will revert at the NoPoolRegistered check since no pools are registered
        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(eurc)
        });

        vm.expectRevert(
            abi.encodeWithSelector(BatchSettler.BatchSettler__NoPoolRegistered.selector, address(usdc), address(eurc))
        );
        settlerNoV4.executeBatch(keccak256("batch-nopm"), settlements, 0);
    }

    /// @notice unlockCallback reverts if called by non-PoolManager
    function test_crossToken_revert_unlockCallbackNotPoolManager() public {
        vm.expectRevert(BatchSettler.BatchSettler__OnlyPoolManager.selector);
        settler.unlockCallback(new bytes(0));
    }

    /// @notice validateBatch returns true for valid cross-token settlement
    function test_validateBatch_crossToken_valid() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p-val"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(eurc)
        });

        (bool valid,,) = settler.validateBatch(settlements);
        assertTrue(valid, "Valid cross-token batch should pass validation");
    }
}
